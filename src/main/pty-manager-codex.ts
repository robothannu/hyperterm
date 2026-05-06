import * as pty from "node-pty";
import { execFile } from "child_process";
import { promisify } from "util";
import { platform } from "os";
import * as path from "path";
import * as fs from "fs";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Codex PTY manager
// Mirrors pty-manager.ts patterns for Claude, but targets the `codex` CLI
// (OpenAI Codex CLI — interactive REPL mode, /opt/homebrew/bin/codex).
//
// Standalone module with its own session map and ID counter, so it does not
// modify pty-manager.ts state. main.ts routes codex-specific IPCs here.
// ---------------------------------------------------------------------------

interface CodexSessionEntry {
  id: number;
  sessionKey: string;
  process: pty.IPty;
  childPid: number;
}

let nextId = 50000; // start above pty-manager's range to avoid collision
const sessions = new Map<number, CodexSessionEntry>();

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
 * Spawn a new shell that runs `codex` as the foreground command in interactive
 * REPL mode, then drops into an interactive shell after codex exits.
 *
 * Pattern mirrors createSessionWithClaude in pty-manager.ts:
 *   - Uses `zsh -i -c 'codex; exec zsh -i'` so the user's zshrc loads and
 *     PATH includes /opt/homebrew/bin (where codex binary lives).
 *   - After codex exits the user keeps an interactive shell in the same cwd.
 *
 * SECURITY: the -c script is a hardcoded literal. cwd is validated. No
 * user-controlled value is interpolated into the shell script string.
 */
export function createSessionWithCodex(
  cols: number,
  rows: number,
  onData: (id: number, data: string) => void,
  onExit: (id: number, exitCode: number) => void,
  cwd?: string,
): { id: number; sessionKey: string } {
  const id = nextId++;
  const sessionKey = `session-${id}`;

  let sessionCwd = cwd || process.env.HOME || "/";
  if (
    typeof sessionCwd !== "string" ||
    !path.isAbsolute(sessionCwd) ||
    !fs.existsSync(sessionCwd)
  ) {
    sessionCwd = process.env.HOME || "/";
  }

  // Force zsh on macOS so PATH (/opt/homebrew/bin) resolves correctly.
  const shell = platform() === "darwin" ? "/bin/zsh" : getDefaultShell();
  const args = ["-i", "-c", "codex; exec zsh -i"];

  console.log(`[pty-codex] spawning session id=${id} cwd=${sessionCwd}`);

  const proc = pty.spawn(shell, args, {
    name: "xterm-256color",
    cols,
    rows,
    cwd: sessionCwd,
    env: {
      ...(process.env as { [key: string]: string }),
      LANG: process.env.LANG || "en_US.UTF-8",
      LC_ALL: process.env.LC_ALL || "en_US.UTF-8",
      HYPERTERM_PTY_ID: String(id),
    },
  });

  const childPid = proc.pid;

  proc.onData((data: string) => onData(id, data));
  proc.onExit(({ exitCode }) => {
    sessions.delete(id);
    console.log(`[pty-codex] session ${id} exited with code ${exitCode}`);
    onExit(id, exitCode);
  });

  sessions.set(id, { id, sessionKey, process: proc, childPid });
  return { id, sessionKey };
}

/**
 * Check whether `codex` is resolvable from an interactive zsh shell.
 * Returns true iff `command -v codex` exits 0 AND prints a path or "codex".
 * SECURITY: argv has no user input.
 */
export async function isCodexAvailable(): Promise<boolean> {
  const shell = platform() === "darwin" ? "/bin/zsh" : getDefaultShell();
  try {
    const { stdout } = await execFileAsync(
      shell,
      ["-i", "-c", "command -v codex"],
      { encoding: "utf8", timeout: 4000 },
    );
    const lines = stdout.split("\n").map((s) => s.trim()).filter((s) => s.length > 0);
    const result = lines.some((line) => line === "codex" || line.startsWith("/"));
    console.log(`[pty-codex] isCodexAvailable=${result}`);
    return result;
  } catch {
    console.warn("[pty-codex] isCodexAvailable: check failed");
    return false;
  }
}

// ---------------------------------------------------------------------------
// Data I/O (forwarded from pty-manager IPC pattern)
// ---------------------------------------------------------------------------

export function writeToSession(id: number, data: string): void {
  const session = sessions.get(id);
  if (!session) return;
  try {
    session.process.write(data);
  } catch (err) {
    sessions.delete(id);
    console.error(`[pty-codex] writeToSession failed for session ${id}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function resizeSession(id: number, cols: number, rows: number): void {
  const session = sessions.get(id);
  if (!session) return;
  try {
    session.process.resize(cols, rows);
  } catch (err) {
    sessions.delete(id);
    console.error(`[pty-codex] resizeSession failed for session ${id}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

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

export function getSessionKey(id: number): string | null {
  return sessions.get(id)?.sessionKey ?? null;
}

export function hasSession(id: number): boolean {
  return sessions.has(id);
}

export async function getCwd(id: number): Promise<string> {
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
}
