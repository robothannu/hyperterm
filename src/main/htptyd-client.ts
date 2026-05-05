/**
 * htptyd-client — HyperTerm main process → daemon IPC client.
 *
 * Responsibilities:
 *  1. Detect and clean up stale daemon socket/PID files.
 *  2. Spawn a new daemon process when needed (detached, survives app exit).
 *  3. Send line-delimited JSON requests to the daemon and return responses.
 *
 * Sprint 2: connect / ensureDaemon / ping / create / list / kill / shutdown
 * Sprint 3 will add: adopt / attach / detach helpers
 */

import * as net from "net";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { spawn } from "child_process";
import type {
  DaemonRequest,
  DaemonResponse,
  PtyInfo,
} from "../daemon/protocol";

// ---------------------------------------------------------------------------
// Paths — mirrors daemon config
// ---------------------------------------------------------------------------

export const DAEMON_DIR = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "HyperTerm",
  "daemon"
);

export const SOCK_PATH = path.join(DAEMON_DIR, "htptyd.sock");
export const PID_PATH = path.join(DAEMON_DIR, "htptyd.pid");

// ---------------------------------------------------------------------------
// Stale detection helpers
// ---------------------------------------------------------------------------

/** Returns true if the PID in htptyd.pid is alive. */
function isDaemonAlive(): boolean {
  try {
    const raw = fs.readFileSync(PID_PATH, "utf8").trim();
    const pid = parseInt(raw, 10);
    if (isNaN(pid) || pid <= 0) return false;
    // Signal 0 — just checks if process exists
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Try to connect to the socket; resolves true if successful. */
async function canConnect(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!fs.existsSync(SOCK_PATH)) {
      resolve(false);
      return;
    }
    const sock = net.connect(SOCK_PATH, () => {
      sock.destroy();
      resolve(true);
    });
    sock.on("error", () => {
      resolve(false);
    });
    // Short timeout to avoid hanging
    sock.setTimeout(1000, () => {
      sock.destroy();
      resolve(false);
    });
  });
}

/** Remove stale socket / PID files. */
function cleanupStale(): void {
  try {
    fs.unlinkSync(SOCK_PATH);
  } catch {
    // ignore
  }
  try {
    fs.unlinkSync(PID_PATH);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Daemon spawn
// ---------------------------------------------------------------------------

/**
 * Spawn the daemon as a detached process that survives HyperTerm exit.
 *
 * In Electron, process.execPath is the Electron binary. Setting
 * ELECTRON_RUN_AS_NODE=1 makes it run as Node, so we can pass the compiled
 * daemon JS file as the entry.
 */
function spawnDaemon(daemonJsPath: string, idleMs?: number): void {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
  };
  if (idleMs !== undefined) {
    env["HTPTYD_IDLE_MS"] = String(idleMs);
  }

  const child = spawn(process.execPath, [daemonJsPath], {
    detached: true,
    stdio: "ignore",
    env: env as Record<string, string>,
  });

  child.unref();
  console.log(`[htptyd-client] Spawned daemon PID ${child.pid}`);
}

// ---------------------------------------------------------------------------
// Socket ready polling
// ---------------------------------------------------------------------------

/** Poll until socket is connectable or timeout. */
async function waitForSocket(timeoutMs = 5000): Promise<boolean> {
  const interval = 100;
  let elapsed = 0;
  while (elapsed < timeoutMs) {
    if (await canConnect()) return true;
    await new Promise((r) => setTimeout(r, interval));
    elapsed += interval;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Low-level request/response
// ---------------------------------------------------------------------------

/**
 * Send a single request to the daemon and read the first response line.
 * Opens a new connection per call (stateless — fine for infrequent ops).
 */
async function sendRequest(req: DaemonRequest): Promise<DaemonResponse> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(SOCK_PATH, () => {
      sock.write(JSON.stringify(req) + "\n");
    });

    let buf = "";
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      const idx = buf.indexOf("\n");
      if (idx !== -1) {
        const line = buf.slice(0, idx);
        sock.destroy();
        try {
          resolve(JSON.parse(line) as DaemonResponse);
        } catch (e) {
          reject(new Error(`Invalid JSON from daemon: ${line}`));
        }
      }
    });

    sock.on("error", (err) => {
      reject(err);
    });

    sock.setTimeout(5000, () => {
      sock.destroy();
      reject(new Error("Daemon request timed out"));
    });
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve the path to dist/daemon/htptyd.js relative to this module.
 * Works for both dev (dist/main/) and packaged environments.
 */
function getDaemonJsPath(): string {
  // __dirname is dist/main/ at runtime
  return path.resolve(__dirname, "..", "daemon", "htptyd.js");
}

/**
 * Ensure the daemon is running and connectable. Handles stale detection and
 * auto-spawn. Throws if daemon cannot be brought up.
 *
 * @param idleMs  Optional idle timeout override (useful for testing).
 */
export async function ensureDaemon(idleMs?: number): Promise<void> {
  // Fast path: already connectable
  if (await canConnect()) {
    console.log("[htptyd-client] Daemon already running");
    return;
  }

  // Stale detection: PID file exists but process is gone, or socket stale
  const pidFileExists = fs.existsSync(PID_PATH);
  const sockFileExists = fs.existsSync(SOCK_PATH);

  if (pidFileExists || sockFileExists) {
    const alive = isDaemonAlive();
    if (!alive) {
      console.log("[htptyd-client] Stale daemon files detected — cleaning up");
      cleanupStale();
    }
  }

  // Spawn new daemon
  const daemonJs = getDaemonJsPath();
  if (!fs.existsSync(daemonJs)) {
    throw new Error(`Daemon JS not found: ${daemonJs}. Run npm run build first.`);
  }

  console.log("[htptyd-client] Spawning daemon...");
  spawnDaemon(daemonJs, idleMs);

  // Wait for socket to appear
  const ready = await waitForSocket(5000);
  if (!ready) {
    throw new Error("Daemon did not come up within 5 seconds");
  }
  console.log("[htptyd-client] Daemon ready");
}

/** Ping the daemon. Returns true if responsive. */
export async function ping(): Promise<boolean> {
  try {
    const resp = await sendRequest({ type: "PING" });
    return resp.type === "PONG";
  } catch {
    return false;
  }
}

/** Create a new PTY inside the daemon. */
export async function createPty(
  cwd?: string,
  cmd?: string
): Promise<{ id: string; cwd: string; pid: number }> {
  const resp = await sendRequest({ type: "CREATE", cwd, cmd });
  if (resp.type !== "CREATED") {
    throw new Error(
      `Unexpected CREATE response: ${JSON.stringify(resp)}`
    );
  }
  return { id: resp.id, cwd: resp.cwd, pid: resp.pid };
}

/** List all PTYs held by the daemon. */
export async function listPtys(): Promise<PtyInfo[]> {
  const resp = await sendRequest({ type: "LIST" });
  if (resp.type !== "LIST") {
    throw new Error(`Unexpected LIST response: ${JSON.stringify(resp)}`);
  }
  return resp.ptys;
}

/** Kill a daemon-held PTY by id. */
export async function killPty(id: string): Promise<void> {
  const resp = await sendRequest({ type: "KILL", id });
  if (resp.type !== "KILLED" && resp.type !== "ERROR") {
    throw new Error(`Unexpected KILL response: ${JSON.stringify(resp)}`);
  }
  if (resp.type === "ERROR") {
    throw new Error(`KILL error: ${resp.message}`);
  }
}

/** Request the daemon to shut itself down. */
export async function shutdownDaemon(): Promise<void> {
  try {
    await sendRequest({ type: "SHUTDOWN" });
  } catch {
    // Daemon may close connection before responding — that's OK
  }
}
