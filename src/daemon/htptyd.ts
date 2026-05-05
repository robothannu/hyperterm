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
  /** true = daemon-owned (pinned group), false = legacy CREATE */
  owned: boolean;
  /** group label for pinned entries */
  groupLabel?: string;
  /** currently attached streaming sockets */
  attachedSockets: Set<net.Socket>;
}

let nextId = 1;
const ptyMap = new Map<string, PtyEntry>();

function generateId(): string {
  return `pty-${Date.now()}-${nextId++}`;
}

function getDefaultShell(): string {
  return process.env.SHELL || "/bin/zsh";
}

function createPty(cwd: string, cmd?: string, cols?: number, rows?: number): PtyEntry {
  const resolvedCwd =
    typeof cwd === "string" && path.isAbsolute(cwd) && fs.existsSync(cwd)
      ? cwd
      : os.homedir();

  const shell = cmd || getDefaultShell();

  const proc = pty.spawn(shell, [], {
    name: "xterm-256color",
    cols: cols ?? 80,
    rows: rows ?? 24,
    cwd: resolvedCwd,
    env: {
      ...(process.env as Record<string, string>),
      LANG: process.env.LANG || "en_US.UTF-8",
      LC_ALL: process.env.LC_ALL || "en_US.UTF-8",
      HTPTYD: "1",
    },
  });

  const id = generateId();
  const entry: PtyEntry = {
    id,
    proc,
    cwd: resolvedCwd,
    pid: proc.pid,
    owned: false,
    attachedSockets: new Set(),
  };

  proc.onExit(() => {
    // Notify all attached sockets
    for (const sock of entry.attachedSockets) {
      try {
        const exitMsg: DaemonResponse = { type: "PTY_EXIT", id, exitCode: 0 };
        sock.write(JSON.stringify(exitMsg) + "\n");
      } catch {
        // ignore
      }
    }
    entry.attachedSockets.clear();
    ptyMap.delete(id);
    log(`PTY exited: ${id}`);
    resetIdleTimer();
  });

  ptyMap.set(id, entry);
  log(`PTY created: ${id} pid=${proc.pid} cwd=${resolvedCwd}`);
  return entry;
}

/**
 * Create a daemon-owned PTY (pinned group). Buffers recent output so new
 * client connections can get some scrollback on ATTACH.
 */
function createOwnedPty(
  cwd: string,
  cmd?: string,
  cols?: number,
  rows?: number,
  groupLabel?: string
): PtyEntry {
  const entry = createPty(cwd, cmd, cols, rows);
  entry.owned = true;
  entry.groupLabel = groupLabel;

  // Buffer last 50 KB of output for scrollback on ATTACH
  const SCROLL_BUF_LIMIT = 50 * 1024;
  let scrollBuf = "";

  entry.proc.onData((data: string) => {
    // Append to scrollback buffer
    scrollBuf += data;
    if (scrollBuf.length > SCROLL_BUF_LIMIT) {
      scrollBuf = scrollBuf.slice(scrollBuf.length - SCROLL_BUF_LIMIT);
    }
    // Forward to all attached sockets
    const b64 = Buffer.from(data, "utf8").toString("base64");
    const msg: DaemonResponse = { type: "DATA", id: entry.id, b64 };
    const line = JSON.stringify(msg) + "\n";
    for (const sock of entry.attachedSockets) {
      try {
        sock.write(line);
      } catch {
        // socket likely closed
        entry.attachedSockets.delete(sock);
      }
    }
  });

  // Store scroll buffer accessor on entry (accessed by ATTACH handler)
  (entry as PtyEntry & { getScrollBuf: () => string }).getScrollBuf = () => scrollBuf;

  log(`PTY owned-spawn: ${entry.id} label="${groupLabel ?? ""}" cwd=${entry.cwd}`);
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
  entry.attachedSockets.clear();
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
    groupLabel: e.groupLabel,
    owned: e.owned,
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
// IPC request handler (stateless requests)
// ---------------------------------------------------------------------------

function handleRequest(req: DaemonRequest, socket: net.Socket): DaemonResponse | null {
  switch (req.type) {
    case "PING":
      return { type: "PONG" };

    case "CREATE": {
      const entry = createPty(req.cwd ?? os.homedir(), req.cmd);
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
      setImmediate(() => shutdown(0));
      return { type: "OK" };

    case "SPAWN_OWNED": {
      const entry = createOwnedPty(
        req.cwd ?? os.homedir(),
        req.cmd,
        req.cols,
        req.rows,
        req.groupLabel
      );
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
      return {
        type: "SPAWNED",
        id: entry.id,
        cwd: entry.cwd,
        pid: entry.pid,
      };
    }

    case "ATTACH": {
      const entry = ptyMap.get(req.id);
      if (!entry || !entry.owned) {
        return { type: "ERROR", message: `Owned PTY not found: ${req.id}` };
      }

      // Send scrollback first, then ATTACHED, then keep socket for streaming
      const scrollBuf = (entry as PtyEntry & { getScrollBuf?: () => string }).getScrollBuf?.() ?? "";
      if (scrollBuf.length > 0) {
        const b64 = Buffer.from(scrollBuf, "utf8").toString("base64");
        const scrollMsg: DaemonResponse = { type: "DATA", id: entry.id, b64 };
        socket.write(JSON.stringify(scrollMsg) + "\n");
      }

      entry.attachedSockets.add(socket);
      socket.once("close", () => {
        entry.attachedSockets.delete(socket);
        log(`ATTACH socket closed for PTY ${req.id}`);
      });

      log(`ATTACH: PTY ${req.id} now has ${entry.attachedSockets.size} client(s)`);
      // Return ATTACHED — then socket stays open for streaming
      return { type: "ATTACHED", id: req.id };
    }

    case "DETACH": {
      const entry = ptyMap.get(req.id);
      if (entry) {
        entry.attachedSockets.delete(socket);
        log(`DETACH: PTY ${req.id} — ${entry.attachedSockets.size} client(s) remaining`);
      }
      return { type: "OK" };
    }

    case "INPUT": {
      const entry = ptyMap.get(req.id);
      if (!entry) {
        return { type: "ERROR", message: `PTY not found: ${req.id}` };
      }
      try {
        entry.proc.write(req.data);
      } catch {
        // ignore write errors (PTY may have exited)
      }
      // No response needed for INPUT — return null to skip write
      return null;
    }

    case "RESIZE": {
      const entry = ptyMap.get(req.id);
      if (!entry) {
        return { type: "ERROR", message: `PTY not found: ${req.id}` };
      }
      try {
        entry.proc.resize(req.cols, req.rows);
      } catch {
        // ignore
      }
      return null; // no response needed
    }

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

        const resp = handleRequest(req, socket);
        if (resp !== null) {
          socket.write(JSON.stringify(resp) + "\n");
        }
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
