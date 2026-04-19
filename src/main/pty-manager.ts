import * as pty from "node-pty";
import { execFile } from "child_process";
import { promisify } from "util";
import { platform } from "os";
import * as path from "path";
import * as fs from "fs";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SessionEntry {
  id: number;
  sessionKey: string;
  process: pty.IPty;
  childPid: number;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let nextId = 1;
const sessions = new Map<number, SessionEntry>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDefaultShell(): string {
  if (platform() === "win32") {
    return "powershell.exe";
  }
  return process.env.SHELL || "/bin/bash";
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

/**
 * Spawn a new shell via node-pty and return a session handle.
 *
 * @param cols    terminal column count
 * @param rows    terminal row count
 * @param onData  callback invoked when the pty emits data
 * @param onExit  callback invoked when the pty process exits
 * @param cwd     optional starting directory (defaults to $HOME)
 * @returns       `{ id, sessionKey }` identifying the new session
 */
export function createSession(
  cols: number,
  rows: number,
  onData: (id: number, data: string) => void,
  onExit: (id: number, exitCode: number) => void,
  cwd?: string,
): { id: number; sessionKey: string } {
  const id = nextId++;
  const sessionKey = `session-${id}`;

  let sessionCwd = cwd || process.env.HOME || "/";
  // Validate cwd is an absolute path that exists
  if (
    typeof sessionCwd !== "string" ||
    !path.isAbsolute(sessionCwd) ||
    !fs.existsSync(sessionCwd)
  ) {
    sessionCwd = process.env.HOME || "/";
  }

  const shell = getDefaultShell();

  const proc = pty.spawn(shell, [], {
    name: "xterm-256color",
    cols,
    rows,
    cwd: sessionCwd,
    env: {
      ...(process.env as { [key: string]: string }),
      LANG: process.env.LANG || "en_US.UTF-8",
      LC_ALL: process.env.LC_ALL || "en_US.UTF-8",
    },
  });

  const childPid = proc.pid;

  proc.onData((data: string) => onData(id, data));
  proc.onExit(({ exitCode }) => {
    sessions.delete(id);
    onExit(id, exitCode);
  });

  sessions.set(id, { id, sessionKey, process: proc, childPid });
  return { id, sessionKey };
}

// ---------------------------------------------------------------------------
// Data I/O
// ---------------------------------------------------------------------------

/** Write data (keystrokes) to a session's pty. */
export function writeToSession(id: number, data: string): void {
  const session = sessions.get(id);
  if (!session) return;
  try {
    session.process.write(data);
  } catch (err) {
    sessions.delete(id);
    console.error(
      `writeToSession failed for session ${id}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Resize a session's pty. */
export function resizeSession(id: number, cols: number, rows: number): void {
  const session = sessions.get(id);
  if (!session) return;
  try {
    session.process.resize(cols, rows);
  } catch (err) {
    sessions.delete(id);
    console.error(
      `resizeSession failed for session ${id}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Session destruction
// ---------------------------------------------------------------------------

/** Kill a single session's pty process and remove it from the map. */
export function destroySession(id: number): void {
  const session = sessions.get(id);
  if (session) {
    try {
      session.process.kill();
    } catch {
      // process may already be dead
    }
    sessions.delete(id);
  }
}

/** Kill all pty processes (used on app quit). */
export function destroyAll(): void {
  for (const [, session] of sessions) {
    try {
      session.process.kill();
    } catch {
      // process may already be dead
    }
  }
  sessions.clear();
}

// ---------------------------------------------------------------------------
// Session queries
// ---------------------------------------------------------------------------

/** Return the child PID of a session's shell process. */
export function getSessionPid(id: number): number | null {
  return sessions.get(id)?.childPid ?? null;
}

/** Return the sessionKey for a given session id. */
export function getSessionKey(id: number): string | null {
  return sessions.get(id)?.sessionKey ?? null;
}

/**
 * Query the current working directory of a session's shell via macOS `lsof`.
 * Falls back to $HOME on error or non-macOS.
 */
export async function getCwd(id: number): Promise<string> {
  const session = sessions.get(id);
  if (!session) return process.env.HOME || "/";

  try {
    const { stdout } = await execFileAsync(
      "lsof",
      ["-p", String(session.childPid), "-a", "-d", "cwd", "-F", "n"],
      { encoding: "utf8", timeout: 3000 },
    );
    // lsof -Fn output has lines like "p1234" (pid) then "ncwd" then "n/some/path"
    // We want the last line starting with 'n' that contains a path
    const lines = stdout.trim().split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].startsWith("n/")) {
        return lines[i].substring(1); // strip leading 'n'
      }
    }
    return process.env.HOME || "/";
  } catch {
    return process.env.HOME || "/";
  }
}

/**
 * Query the current foreground command of a session's shell via `ps`.
 * Returns the command name (e.g. "vim", "node") or empty string on error.
 */
export async function getSessionCurrentCommand(id: number): Promise<string> {
  const session = sessions.get(id);
  if (!session) return "";

  try {
    const { stdout } = await execFileAsync(
      "ps",
      ["-o", "comm=", "-p", String(session.childPid)],
      { encoding: "utf8", timeout: 2000 },
    );
    return stdout.trim();
  } catch {
    return "";
  }
}

/**
 * Check if a `claude` process is running in the process tree rooted at the
 * session's shell PID. Uses `pgrep -P` to walk one level of children, then
 * checks each child's command name for "claude".
 *
 * Returns `{ isClaudeRunning, claudePid }`.
 */
export async function getAgentStatus(
  id: number
): Promise<{ isClaudeRunning: boolean; claudePid: number | null }> {
  const session = sessions.get(id);
  if (!session) return { isClaudeRunning: false, claudePid: null };

  try {
    // Recursively search the process tree for a process named 'claude'
    const found = await findClaudeInTree(session.childPid, 3);
    if (found !== null) {
      return { isClaudeRunning: true, claudePid: found };
    }
    return { isClaudeRunning: false, claudePid: null };
  } catch {
    return { isClaudeRunning: false, claudePid: null };
  }
}

/**
 * Recursively search process tree (BFS up to `depth` levels) for a process
 * whose comm contains "claude".
 */
async function findClaudeInTree(
  pid: number,
  depth: number
): Promise<number | null> {
  if (depth <= 0) return null;

  let childPids: number[] = [];
  try {
    const { stdout } = await execFileAsync("pgrep", ["-P", String(pid)], {
      encoding: "utf8",
      timeout: 2000,
    });
    childPids = stdout
      .trim()
      .split("\n")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n > 0);
  } catch {
    // No children or pgrep failed
    return null;
  }

  if (childPids.length === 0) return null;

  // Check each child's command line (args includes full path, safer than comm)
  for (const childPid of childPids) {
    try {
      const { stdout } = await execFileAsync(
        "ps",
        ["-o", "args=", "-p", String(childPid)],
        { encoding: "utf8", timeout: 2000 }
      );
      const args = stdout.trim();
      // Binary-name based matching to avoid false positives (e.g. claude.conf)
      const parts = args.split(/\s+/);
      const binary = path.basename(parts[0]);
      const isClaudeBinary = binary === "claude";
      const isClaudeNode =
        binary === "node" &&
        parts.length > 1 &&
        (parts[1].includes("/claude/") ||
          path.basename(parts[1]).startsWith("claude"));
      if (isClaudeBinary || isClaudeNode) {
        return childPid;
      }
    } catch {
      // process may have already exited
    }
  }

  // Recurse into children
  for (const childPid of childPids) {
    const result = await findClaudeInTree(childPid, depth - 1);
    if (result !== null) return result;
  }

  return null;
}

/**
 * Query CPU and memory usage for a session's shell process.
 * Returns `{ cpu, memory }` percentages, or zeros on error.
 */
export async function getProcessInfo(id: number): Promise<{ cpu: number; memory: number }> {
  const session = sessions.get(id);
  if (!session) return { cpu: 0, memory: 0 };

  const pid = String(session.childPid);
  try {
    const { stdout } = await execFileAsync(
      "ps",
      ["-p", pid, "-o", "%cpu=,%mem="],
      { encoding: "utf8", timeout: 2000 },
    );
    const output = stdout.trim();
    const [cpu, mem] = output.split(",").map((s) => parseFloat(s.trim()) || 0);
    return { cpu, memory: mem };
  } catch {
    return { cpu: 0, memory: 0 };
  }
}
