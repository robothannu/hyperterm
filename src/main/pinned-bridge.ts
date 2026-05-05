/**
 * pinned-bridge — Pinned group PTY lifecycle manager (Sprint 3)
 *
 * Pinned groups use daemon-owned PTYs. This module manages the IPC bridge
 * between the main process and the daemon for streaming PTY data.
 *
 * Architecture:
 *   - createPinnedPty(): daemon spawns the PTY (SPAWN_OWNED). Main connects
 *     a long-lived streaming socket (ATTACH) and proxies data to renderer.
 *   - On app quit: DETACH (proxy socket closed, PTY stays alive in daemon).
 *   - On app restart: ensureDaemon → LIST → find matching daemonPtyId → ATTACH.
 *   - On unpin/delete: KILL the daemon PTY immediately (orphan prevention).
 *   - On daemon crash: LIST fails → fallback to Sprint 1 (snapshot + new PTY).
 */

import * as net from "net";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { spawn } from "child_process";
import type { DaemonRequest, DaemonResponse, PtyInfo } from "../daemon/protocol";

// ---------------------------------------------------------------------------
// Paths (mirrors htptyd-client.ts)
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
// State: active streaming connections per daemonPtyId
// ---------------------------------------------------------------------------

interface StreamEntry {
  socket: net.Socket;
  ptyId: string;
  /** Renderer data callback (base64 → decoded string) */
  onData: (data: string) => void;
  /** Called when daemon PTY exits */
  onExit: (exitCode: number) => void;
}

const streamMap = new Map<string, StreamEntry>();

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

function isDaemonAlive(): boolean {
  try {
    const raw = fs.readFileSync(PID_PATH, "utf8").trim();
    const pid = parseInt(raw, 10);
    if (isNaN(pid) || pid <= 0) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function canConnectSync(): boolean {
  return fs.existsSync(SOCK_PATH);
}

async function canConnect(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!fs.existsSync(SOCK_PATH)) { resolve(false); return; }
    const sock = net.connect(SOCK_PATH, () => { sock.destroy(); resolve(true); });
    sock.on("error", () => resolve(false));
    sock.setTimeout(1000, () => { sock.destroy(); resolve(false); });
  });
}

function cleanupStale(): void {
  try { fs.unlinkSync(SOCK_PATH); } catch { /* ok */ }
  try { fs.unlinkSync(PID_PATH); } catch { /* ok */ }
}

function getDaemonJsPath(): string {
  return path.resolve(__dirname, "..", "daemon", "htptyd.js");
}

function spawnDaemon(idleMs?: number): void {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
  };
  if (idleMs !== undefined) env["HTPTYD_IDLE_MS"] = String(idleMs);

  const child = spawn(process.execPath, [getDaemonJsPath()], {
    detached: true,
    stdio: "ignore",
    env: env as Record<string, string>,
  });
  child.unref();
  console.log(`[pinned-bridge] Spawned daemon PID ${child.pid}`);
}

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

/** Send one request, read one response line. Short-lived connection. */
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
        sock.destroy();
        try { resolve(JSON.parse(buf.slice(0, idx)) as DaemonResponse); }
        catch (e) { reject(new Error(`Invalid JSON: ${buf.slice(0, idx)}`)); }
      }
    });
    sock.on("error", reject);
    sock.setTimeout(5000, () => { sock.destroy(); reject(new Error("Timeout")); });
  });
}

// ---------------------------------------------------------------------------
// Public: ensure daemon running
// ---------------------------------------------------------------------------

export async function ensureDaemon(idleMs?: number): Promise<void> {
  if (await canConnect()) return;

  const pidExists = fs.existsSync(PID_PATH);
  const sockExists = fs.existsSync(SOCK_PATH);
  if (pidExists || sockExists) {
    if (!isDaemonAlive()) {
      console.log("[pinned-bridge] Stale daemon files — cleaning up");
      cleanupStale();
    }
  }

  const daemonJs = getDaemonJsPath();
  if (!fs.existsSync(daemonJs)) {
    throw new Error(`Daemon JS not found: ${daemonJs}`);
  }

  console.log("[pinned-bridge] Spawning daemon...");
  spawnDaemon(idleMs);

  const ready = await waitForSocket(5000);
  if (!ready) throw new Error("Daemon did not start within 5 seconds");
  console.log("[pinned-bridge] Daemon ready");
}

/** Check if daemon is currently connectable (non-throwing). */
export async function isDaemonConnectable(): Promise<boolean> {
  return canConnect();
}

// ---------------------------------------------------------------------------
// Public: LIST daemon PTYs
// ---------------------------------------------------------------------------

export async function listDaemonPtys(): Promise<PtyInfo[]> {
  try {
    const resp = await sendRequest({ type: "LIST" });
    if (resp.type === "LIST") return resp.ptys;
  } catch (err) {
    console.warn("[pinned-bridge] LIST failed:", err);
  }
  return [];
}

// ---------------------------------------------------------------------------
// Public: spawn a new daemon-owned PTY (pinned group creation)
// ---------------------------------------------------------------------------

export async function spawnOwnedPty(opts: {
  cwd?: string;
  cols?: number;
  rows?: number;
  groupLabel?: string;
}): Promise<{ id: string; cwd: string; pid: number }> {
  const resp = await sendRequest({
    type: "SPAWN_OWNED",
    cwd: opts.cwd,
    cols: opts.cols,
    rows: opts.rows,
    groupLabel: opts.groupLabel,
  });
  if (resp.type !== "SPAWNED") {
    throw new Error(`SPAWN_OWNED failed: ${JSON.stringify(resp)}`);
  }
  return { id: resp.id, cwd: resp.cwd, pid: resp.pid };
}

// ---------------------------------------------------------------------------
// Public: attach streaming connection to a daemon-owned PTY
// ---------------------------------------------------------------------------

/**
 * Open a long-lived streaming socket connection to a daemon-owned PTY.
 * Returns a PinnedStream handle used to send input/resize/detach.
 *
 * @param daemonPtyId  PTY id returned by SPAWN_OWNED or LIST
 * @param onData       Called with decoded output string (UTF-8)
 * @param onExit       Called when PTY exits
 */
export function attachPinnedPty(
  daemonPtyId: string,
  onData: (data: string) => void,
  onExit: (exitCode: number) => void
): Promise<PinnedStream> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(SOCK_PATH);
    let buf = "";
    let attached = false;

    socket.on("connect", () => {
      socket.write(JSON.stringify({ type: "ATTACH", id: daemonPtyId }) + "\n");
    });

    socket.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let msg: DaemonResponse;
        try { msg = JSON.parse(trimmed) as DaemonResponse; }
        catch { continue; }

        if (msg.type === "ATTACHED") {
          attached = true;
          const entry: StreamEntry = { socket, ptyId: daemonPtyId, onData, onExit };
          streamMap.set(daemonPtyId, entry);
          const stream = new PinnedStream(socket, daemonPtyId, () => streamMap.delete(daemonPtyId));
          console.log(`[pinned-bridge] ATTACHED to daemon PTY ${daemonPtyId}`);
          resolve(stream);
        } else if (msg.type === "DATA") {
          if (msg.id === daemonPtyId) {
            try {
              const decoded = Buffer.from(msg.b64, "base64").toString("utf8");
              onData(decoded);
            } catch { /* ignore */ }
          }
        } else if (msg.type === "PTY_EXIT") {
          onExit(msg.exitCode ?? 0);
          socket.destroy();
          streamMap.delete(daemonPtyId);
        } else if (msg.type === "ERROR" && !attached) {
          reject(new Error(`ATTACH error: ${msg.message}`));
          socket.destroy();
        }
      }
    });

    socket.on("error", (err) => {
      if (!attached) reject(err);
      else {
        console.warn(`[pinned-bridge] Stream error for PTY ${daemonPtyId}:`, err.message);
      }
    });

    socket.on("close", () => {
      streamMap.delete(daemonPtyId);
      console.log(`[pinned-bridge] Stream closed for PTY ${daemonPtyId}`);
    });

    socket.setTimeout(5000, () => {
      if (!attached) {
        socket.destroy();
        reject(new Error("ATTACH timed out"));
      }
    });
  });
}

/**
 * PinnedStream — handle for an active streaming connection to a daemon PTY.
 */
export class PinnedStream {
  private socket: net.Socket;
  private ptyId: string;
  private cleanup: () => void;
  private closed = false;

  constructor(socket: net.Socket, ptyId: string, cleanup: () => void) {
    this.socket = socket;
    this.ptyId = ptyId;
    this.cleanup = cleanup;
  }

  /** Send keystroke data to the daemon PTY. */
  write(data: string): void {
    if (this.closed) return;
    try {
      this.socket.write(JSON.stringify({ type: "INPUT", id: this.ptyId, data }) + "\n");
    } catch { /* ignore */ }
  }

  /** Resize the daemon PTY. */
  resize(cols: number, rows: number): void {
    if (this.closed) return;
    try {
      this.socket.write(JSON.stringify({ type: "RESIZE", id: this.ptyId, cols, rows }) + "\n");
    } catch { /* ignore */ }
  }

  /**
   * Detach from the PTY (daemon keeps it alive). Socket is closed.
   * Call this on app quit for pinned groups.
   */
  detach(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.socket.write(JSON.stringify({ type: "DETACH", id: this.ptyId }) + "\n");
      // Small delay to let DETACH be sent before socket closes
      setTimeout(() => { try { this.socket.destroy(); } catch { /* ok */ } }, 50);
    } catch {
      this.socket.destroy();
    }
    this.cleanup();
    console.log(`[pinned-bridge] Detached from PTY ${this.ptyId}`);
  }

  get isAlive(): boolean {
    return !this.closed && !this.socket.destroyed;
  }
}

// ---------------------------------------------------------------------------
// Public: kill a daemon-owned PTY (unpin / group delete)
// ---------------------------------------------------------------------------

export async function killDaemonPty(id: string): Promise<void> {
  try {
    const resp = await sendRequest({ type: "KILL", id });
    if (resp.type === "ERROR") {
      console.warn(`[pinned-bridge] KILL ${id}: ${resp.message}`);
    }
  } catch (err) {
    console.warn(`[pinned-bridge] KILL ${id} failed:`, err);
  }
  streamMap.delete(id);
}

// ---------------------------------------------------------------------------
// Public: detach all active streams (call on app quit)
// ---------------------------------------------------------------------------

export function detachAll(): void {
  for (const [id, entry] of streamMap.entries()) {
    try {
      entry.socket.write(JSON.stringify({ type: "DETACH", id }) + "\n");
      setTimeout(() => { try { entry.socket.destroy(); } catch { /* ok */ } }, 50);
    } catch {
      try { entry.socket.destroy(); } catch { /* ok */ }
    }
    console.log(`[pinned-bridge] detachAll: detached PTY ${id}`);
  }
  streamMap.clear();
}

// ---------------------------------------------------------------------------
// Public: reconcile sessions.json pinned tabs with daemon LIST
// ---------------------------------------------------------------------------

export interface ReconcileResult {
  canReattach: string[];   // daemonPtyIds that are alive in daemon
  needFallback: string[];  // daemonPtyIds that are NOT in daemon (use Sprint 1)
}

/**
 * Compare a list of expected daemonPtyIds with what the daemon actually holds.
 * Returns which can be reattached and which need Sprint 1 fallback.
 *
 * Called on app startup before restoring sessions.
 */
export async function reconcilePinnedSessions(
  expectedIds: string[]
): Promise<ReconcileResult> {
  if (expectedIds.length === 0) {
    return { canReattach: [], needFallback: [] };
  }

  let livePtys: PtyInfo[] = [];
  try {
    await ensureDaemon();
    livePtys = await listDaemonPtys();
  } catch (err) {
    console.warn("[pinned-bridge] reconcile: daemon unavailable:", err);
    // All need fallback
    return { canReattach: [], needFallback: [...expectedIds] };
  }

  const liveIds = new Set(livePtys.filter((p) => p.owned).map((p) => p.id));
  const canReattach: string[] = [];
  const needFallback: string[] = [];

  for (const id of expectedIds) {
    if (liveIds.has(id)) {
      canReattach.push(id);
    } else {
      needFallback.push(id);
    }
  }

  console.log(
    `[pinned-bridge] reconcile: ${canReattach.length} reattach, ${needFallback.length} fallback`
  );
  return { canReattach, needFallback };
}
