/**
 * htptyd — HyperTerm PTY daemon
 *
 * Long-lived background process that holds PTYs across HyperTerm app restarts.
 * Communicates via unix domain socket with line-delimited JSON.
 *
 * Usage (direct node):
 *   ELECTRON_RUN_AS_NODE=1 node dist/daemon/htptyd.js
 *
 * Env overrides:
 *   HTPTYD_IDLE_MS   — idle timeout in ms before auto-shutdown (default 300000 = 5 min)
 *   HTPTYD_DIR       — override daemon directory (for testing)
 *   HTPTYD_LOG       — set to "0" to disable file logging
 */

import * as net from "net";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as pty from "node-pty";
import type { DaemonRequest, DaemonResponse, PtyInfo } from "./protocol";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const IDLE_MS = parseInt(process.env.HTPTYD_IDLE_MS ?? "300000", 10);

const DAEMON_DIR =
  process.env.HTPTYD_DIR ??
  path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "HyperTerm",
    "daemon"
  );

const SOCK_PATH = path.join(DAEMON_DIR, "htptyd.sock");
const PID_PATH = path.join(DAEMON_DIR, "htptyd.pid");
const LOG_PATH = path.join(DAEMON_DIR, "htptyd.log");

const LOG_ENABLED = process.env.HTPTYD_LOG !== "0";

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  process.stdout.write(line);
  if (LOG_ENABLED) {
    try {
      fs.appendFileSync(LOG_PATH, line);
    } catch {
      // ignore log write errors
    }
  }
}

// ---------------------------------------------------------------------------
// PTY registry
// ---------------------------------------------------------------------------

interface PtyEntry {
  id: string;
  proc: pty.IPty;
  cwd: string;
  pid: number;
}

let nextId = 1;
const ptyMap = new Map<string, PtyEntry>();

function generateId(): string {
  return `pty-${Date.now()}-${nextId++}`;
}

function getDefaultShell(): string {
  return process.env.SHELL || "/bin/zsh";
}

function createPty(cwd: string, cmd?: string): PtyEntry {
  const resolvedCwd =
    typeof cwd === "string" && path.isAbsolute(cwd) && fs.existsSync(cwd)
      ? cwd
      : os.homedir();

  const shell = cmd || getDefaultShell();

  const proc = pty.spawn(shell, [], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: resolvedCwd,
    env: {
      ...(process.env as Record<string, string>),
      LANG: process.env.LANG || "en_US.UTF-8",
      LC_ALL: process.env.LC_ALL || "en_US.UTF-8",
      HTPTYD: "1",
    },
  });

  const id = generateId();
  const entry: PtyEntry = { id, proc, cwd: resolvedCwd, pid: proc.pid };

  proc.onExit(() => {
    ptyMap.delete(id);
    log(`PTY exited: ${id}`);
    resetIdleTimer();
  });

  ptyMap.set(id, entry);
  log(`PTY created: ${id} pid=${proc.pid} cwd=${resolvedCwd}`);
  return entry;
}

function killPty(id: string): boolean {
  const entry = ptyMap.get(id);
  if (!entry) return false;
  try {
    entry.proc.kill();
  } catch {
    // already dead
  }
  ptyMap.delete(id);
  log(`PTY killed: ${id}`);
  resetIdleTimer();
  return true;
}

function listPtys(): PtyInfo[] {
  return Array.from(ptyMap.values()).map((e) => ({
    id: e.id,
    cwd: e.cwd,
    pid: e.pid,
  }));
}

// ---------------------------------------------------------------------------
// Idle timer
// ---------------------------------------------------------------------------

let idleTimer: NodeJS.Timeout | null = null;

function resetIdleTimer(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }

  if (ptyMap.size === 0) {
    log(`Idle timer started: ${IDLE_MS}ms`);
    idleTimer = setTimeout(() => {
      log("Idle timeout reached with 0 PTYs — shutting down");
      shutdown(0);
    }, IDLE_MS);
    // Do not prevent Node from exiting if this is the only pending op
    idleTimer.unref();
  }
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

function cleanup(): void {
  // Kill all held PTYs
  for (const [id, entry] of ptyMap) {
    try {
      entry.proc.kill();
    } catch {
      // ignore
    }
    log(`PTY force-killed on shutdown: ${id}`);
  }
  ptyMap.clear();

  // Remove socket + PID files
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

function shutdown(code = 0): never {
  log("Daemon shutting down");
  cleanup();
  process.exit(code);
}

// ---------------------------------------------------------------------------
// IPC request handler
// ---------------------------------------------------------------------------

function handleRequest(req: DaemonRequest): DaemonResponse {
  switch (req.type) {
    case "PING":
      return { type: "PONG" };

    case "CREATE": {
      const entry = createPty(req.cwd ?? os.homedir(), req.cmd);
      // A new PTY was added — cancel idle timer
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
      return {
        type: "CREATED",
        id: entry.id,
        cwd: entry.cwd,
        pid: entry.pid,
      };
    }

    case "LIST":
      return { type: "LIST", ptys: listPtys() };

    case "KILL": {
      const ok = killPty(req.id);
      if (!ok) {
        return { type: "ERROR", message: `PTY not found: ${req.id}` };
      }
      return { type: "KILLED", id: req.id };
    }

    case "SHUTDOWN":
      log("SHUTDOWN requested via IPC");
      // Respond OK then exit asynchronously
      setImmediate(() => shutdown(0));
      return { type: "OK" };

    default:
      return { type: "ERROR", message: `Unknown message type` };
  }
}

// ---------------------------------------------------------------------------
// Unix socket server
// ---------------------------------------------------------------------------

function startServer(): void {
  const server = net.createServer((socket) => {
    log("Client connected");
    let buf = "";

    socket.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let req: DaemonRequest;
        try {
          req = JSON.parse(trimmed) as DaemonRequest;
        } catch {
          const errResp: DaemonResponse = {
            type: "ERROR",
            message: "Invalid JSON",
          };
          socket.write(JSON.stringify(errResp) + "\n");
          continue;
        }

        const resp = handleRequest(req);
        socket.write(JSON.stringify(resp) + "\n");
      }
    });

    socket.on("error", (err) => {
      log(`Client socket error: ${err.message}`);
    });

    socket.on("close", () => {
      log("Client disconnected");
    });
  });

  server.on("error", (err) => {
    log(`Server error: ${err.message}`);
    process.exit(1);
  });

  server.listen(SOCK_PATH, () => {
    log(`Listening on ${SOCK_PATH}`);
  });
}

// ---------------------------------------------------------------------------
// Process setup
// ---------------------------------------------------------------------------

// Handle signals gracefully
process.on("SIGTERM", () => {
  log("SIGTERM received");
  shutdown(0);
});

process.on("SIGINT", () => {
  log("SIGINT received");
  shutdown(0);
});

process.on("uncaughtException", (err) => {
  log(`Uncaught exception: ${err.message}\n${err.stack ?? ""}`);
  cleanup();
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  log(`Unhandled rejection: ${String(reason)}`);
});

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main(): void {
  // Ensure daemon directory exists
  try {
    fs.mkdirSync(DAEMON_DIR, { recursive: true });
  } catch (err) {
    process.stderr.write(`Failed to create daemon dir: ${err}\n`);
    process.exit(1);
  }

  log(`htptyd starting — PID ${process.pid}, IDLE_MS=${IDLE_MS}`);

  // Write PID file
  try {
    fs.writeFileSync(PID_PATH, String(process.pid), "utf8");
  } catch (err) {
    log(`Failed to write PID file: ${err}`);
    process.exit(1);
  }

  // Start unix socket server
  startServer();

  // Start idle timer immediately (0 PTYs at startup)
  resetIdleTimer();

  log("Daemon ready");
}

main();
