import * as pty from "node-pty";
import { execFile } from "child_process";
import { promisify } from "util";
import { platform } from "os";
import * as path from "path";
import * as fs from "fs";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Shared types and helpers used by both pty-manager.ts (claude) and
// pty-manager-codex.ts (codex). Each manager keeps its own SessionStore
// instance — IDs and processes never mix.
// ---------------------------------------------------------------------------

export interface SessionEntry {
  id: number;
  sessionKey: string;
  process: pty.IPty;
  childPid: number;
}

export function getDefaultShell(): string {
  if (platform() === "win32") return "powershell.exe";
  return process.env.SHELL || "/bin/bash";
}

/** Force zsh on macOS so user-defined shell functions / PATH resolve. */
export function getInteractiveShell(): string {
  return platform() === "darwin" ? "/bin/zsh" : getDefaultShell();
}

/**
 * Validate cwd: must be an absolute path that exists. Falls back to $HOME.
 */
export function resolveSessionCwd(cwd: string | undefined): string {
  let sessionCwd = cwd || process.env.HOME || "/";
  if (
    typeof sessionCwd !== "string" ||
    !path.isAbsolute(sessionCwd) ||
    !fs.existsSync(sessionCwd)
  ) {
    sessionCwd = process.env.HOME || "/";
  }
  return sessionCwd;
}

/** Default env passed to every spawned shell. Adds HYPERTERM_PTY_ID. */
export function buildSessionEnv(id: number): { [key: string]: string } {
  return {
    ...(process.env as { [key: string]: string }),
    LANG: process.env.LANG || "en_US.UTF-8",
    LC_ALL: process.env.LC_ALL || "en_US.UTF-8",
    HYPERTERM_PTY_ID: String(id),
  };
}

// ---------------------------------------------------------------------------
// SessionStore: per-manager Map of sessions + lifecycle ops.
// ---------------------------------------------------------------------------

export interface SessionStore {
  /** Allocate the next id and register a SessionEntry. */
  register(entry: Omit<SessionEntry, "id"> & { id: number }): void;
  /** Allocate the next id without registering. */
  nextId(): number;
  /** Lookup helpers. */
  get(id: number): SessionEntry | undefined;
  has(id: number): boolean;
  delete(id: number): void;
  values(): IterableIterator<SessionEntry>;
  /** I/O. */
  write(id: number, data: string): void;
  resize(id: number, cols: number, rows: number): void;
  /** Destruction. */
  destroy(id: number): void;
  destroyAll(): void;
  /** Queries. */
  sessionKey(id: number): string | null;
  cwd(id: number): Promise<string>;
}

export function createSessionStore(idStart: number, logPrefix: string): SessionStore {
  const sessions = new Map<number, SessionEntry>();
  let counter = idStart;

  return {
    register(entry) {
      sessions.set(entry.id, entry);
    },
    nextId() {
      return counter++;
    },
    get(id) {
      return sessions.get(id);
    },
    has(id) {
      return sessions.has(id);
    },
    delete(id) {
      sessions.delete(id);
    },
    values() {
      return sessions.values();
    },
    write(id, data) {
      const session = sessions.get(id);
      if (!session) return;
      try {
        session.process.write(data);
      } catch (err) {
        sessions.delete(id);
        console.error(
          `${logPrefix} write failed for session ${id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    resize(id, cols, rows) {
      const session = sessions.get(id);
      if (!session) return;
      try {
        session.process.resize(cols, rows);
      } catch (err) {
        sessions.delete(id);
        console.error(
          `${logPrefix} resize failed for session ${id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    destroy(id) {
      const session = sessions.get(id);
      if (session) {
        try {
          session.process.kill();
        } catch {
          // already dead
        }
        sessions.delete(id);
      }
    },
    destroyAll() {
      for (const [, session] of sessions) {
        try {
          session.process.kill();
        } catch {
          // already dead
        }
      }
      sessions.clear();
    },
    sessionKey(id) {
      return sessions.get(id)?.sessionKey ?? null;
    },
    async cwd(id) {
      const session = sessions.get(id);
      if (!session) return process.env.HOME || "/";

      try {
        const { stdout } = await execFileAsync(
          "lsof",
          ["-p", String(session.childPid), "-a", "-d", "cwd", "-F", "n"],
          { encoding: "utf8", timeout: 3000 },
        );
        const lines = stdout.trim().split("\n");
        for (let i = lines.length - 1; i >= 0; i--) {
          if (lines[i].startsWith("n/")) {
            return lines[i].substring(1);
          }
        }
        return process.env.HOME || "/";
      } catch {
        return process.env.HOME || "/";
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Process tree search — shared by claude/codex agent-status detection.
// ---------------------------------------------------------------------------

/**
 * BFS through child processes (up to `depth`) looking for a process whose
 * `args[0]` basename equals `binary`, or `node <path containing fragment>`.
 *
 * Returns the matched PID, or null if nothing matches.
 *
 * @param binary        e.g. "claude" or "codex"
 * @param nodeFragment  path fragment that identifies a node-hosted version
 *                      (e.g. "/claude/", "/codex/")
 */
export async function findInProcessTree(
  rootPid: number,
  depth: number,
  binary: string,
  nodeFragment: string,
): Promise<number | null> {
  if (depth <= 0) return null;

  let childPids: number[] = [];
  try {
    const { stdout } = await execFileAsync("pgrep", ["-P", String(rootPid)], {
      encoding: "utf8",
      timeout: 2000,
    });
    childPids = stdout
      .trim()
      .split("\n")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n > 0);
  } catch {
    return null;
  }

  if (childPids.length === 0) return null;

  for (const childPid of childPids) {
    try {
      const { stdout } = await execFileAsync(
        "ps",
        ["-o", "args=", "-p", String(childPid)],
        { encoding: "utf8", timeout: 2000 },
      );
      const args = stdout.trim();
      const parts = args.split(/\s+/);
      const cmdBin = path.basename(parts[0]);
      const isDirect = cmdBin === binary;
      const isNodeHosted =
        cmdBin === "node" &&
        parts.length > 1 &&
        (parts[1].includes(nodeFragment) ||
          path.basename(parts[1]).startsWith(binary));
      if (isDirect || isNodeHosted) {
        return childPid;
      }
    } catch {
      // process exited
    }
  }

  for (const childPid of childPids) {
    const result = await findInProcessTree(childPid, depth - 1, binary, nodeFragment);
    if (result !== null) return result;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Command availability — `command -v <cmd>` in interactive zsh.
// ---------------------------------------------------------------------------

/**
 * True iff `command -v <cmd>` resolves to either the bare command name or an
 * absolute path. We filter stdout because interactive shells emit noise like
 * "Restored session:" lines that are not the command path.
 */
export async function isCommandAvailable(cmd: string): Promise<boolean> {
  const shell = getInteractiveShell();
  try {
    const { stdout } = await execFileAsync(
      shell,
      ["-i", "-c", `command -v ${cmd}`],
      { encoding: "utf8", timeout: 4000 },
    );
    const lines = stdout.split("\n").map((s) => s.trim()).filter((s) => s.length > 0);
    return lines.some((line) => line === cmd || line.startsWith("/"));
  } catch {
    return false;
  }
}
