import * as pty from "node-pty";
import { execFile } from "child_process";
import { promisify } from "util";
import {
  type SessionEntry,
  buildSessionEnv,
  createSessionStore,
  findInProcessTree,
  getDefaultShell,
  getInteractiveShell,
  isCommandAvailable,
  resolveSessionCwd,
} from "./pty-manager-base";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Claude PTY manager — per-spawn logic + thin re-exports of shared store ops.
// ---------------------------------------------------------------------------

const store = createSessionStore(1, "[pty]");

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

/**
 * Spawn a new shell via node-pty and return a session handle.
 */
export function createSession(
  cols: number,
  rows: number,
  onData: (id: number, data: string) => void,
  onExit: (id: number, exitCode: number) => void,
  cwd?: string,
): { id: number; sessionKey: string } {
  const id = store.nextId();
  const sessionKey = `session-${id}`;

  const sessionCwd = resolveSessionCwd(cwd);
  const shell = getDefaultShell();

  const proc = pty.spawn(shell, [], {
    name: "xterm-256color",
    cols,
    rows,
    cwd: sessionCwd,
    env: buildSessionEnv(id),
  });

  const childPid = proc.pid;

  proc.onData((data: string) => onData(id, data));
  proc.onExit(({ exitCode }) => {
    store.delete(id);
    onExit(id, exitCode);
  });

  store.register({ id, sessionKey, process: proc, childPid });
  return { id, sessionKey };
}

/**
 * Spawn a new shell that runs `claude` as the foreground command, then drops
 * into an interactive shell after claude exits.
 *
 * Sprint 1 (Run with Claude): we use `zsh -i -c 'claude; exec zsh -i'` so:
 *   1. The user's interactive zshrc loads (their `claude` shell function with
 *      the ANTHROPIC_* env unset wrapper resolves correctly).
 *   2. `claude` runs in the foreground.
 *   3. After claude exits the user keeps an interactive shell in the cwd.
 *
 * Sprint 2 (Ask Claude per nextStep): when `taskText` is provided, the prompt
 * is passed as a *positional argument* to zsh — NEVER interpolated into the
 * `-c` script string. The script uses `"$@"` which zsh expands to the
 * positional args as separate, already-quoted argv elements; metacharacters
 * like `;`, `$(...)`, backticks, `&&`, `|` inside taskText are preserved as
 * a literal single argv string handed to the claude binary.
 *
 * SECURITY: the `-c` script is a hardcoded literal. The only user-controlled
 * value (`taskText`) reaches the spawned process via argv[positional], not
 * via shell parsing. cwd is validated like createSession.
 */
export function createSessionWithClaude(
  cols: number,
  rows: number,
  onData: (id: number, data: string) => void,
  onExit: (id: number, exitCode: number) => void,
  cwd?: string,
  taskText?: string,
): { id: number; sessionKey: string } {
  const id = store.nextId();
  const sessionKey = `session-${id}`;
  const sessionCwd = resolveSessionCwd(cwd);

  const shell = getInteractiveShell();
  const hasTask = typeof taskText === "string" && taskText.length > 0;
  const args = hasTask
    ? ["-i", "-c", 'claude "$@"; exec zsh -i', "_", taskText as string]
    : ["-i", "-c", "claude; exec zsh -i"];

  const proc = pty.spawn(shell, args, {
    name: "xterm-256color",
    cols,
    rows,
    cwd: sessionCwd,
    env: buildSessionEnv(id),
  });

  const childPid = proc.pid;

  proc.onData((data: string) => onData(id, data));
  proc.onExit(({ exitCode }) => {
    store.delete(id);
    onExit(id, exitCode);
  });

  store.register({ id, sessionKey, process: proc, childPid });
  return { id, sessionKey };
}

/**
 * Check whether `claude` is resolvable from an interactive zsh.
 */
export function isClaudeAvailable(): Promise<boolean> {
  return isCommandAvailable("claude");
}

// ---------------------------------------------------------------------------
// Re-exports of shared store ops (preserve public API used by main.ts)
// ---------------------------------------------------------------------------

export const writeToSession = (id: number, data: string): void => store.write(id, data);
export const resizeSession = (id: number, cols: number, rows: number): void => store.resize(id, cols, rows);
export const destroySession = (id: number): void => store.destroy(id);
export const destroyAll = (): void => store.destroyAll();
export const getSessionKey = (id: number): string | null => store.sessionKey(id);
export const hasSession = (id: number): boolean => store.has(id);
export const getCwd = (id: number): Promise<string> => store.cwd(id);

// ---------------------------------------------------------------------------
// Process queries — claude-specific
// ---------------------------------------------------------------------------

/**
 * Query the current foreground command of a session's shell via `ps`.
 */
export async function getSessionCurrentCommand(id: number): Promise<string> {
  const session = store.get(id);
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
 * session's shell PID.
 */
export async function getAgentStatus(
  id: number,
): Promise<{ isClaudeRunning: boolean; claudePid: number | null }> {
  const session = store.get(id);
  if (!session) return { isClaudeRunning: false, claudePid: null };
  try {
    const found = await findInProcessTree(session.childPid, 3, "claude", "/claude/");
    if (found !== null) return { isClaudeRunning: true, claudePid: found };
    return { isClaudeRunning: false, claudePid: null };
  } catch {
    return { isClaudeRunning: false, claudePid: null };
  }
}

/**
 * Query CPU and memory usage for a session's shell process.
 */
export async function getProcessInfo(id: number): Promise<{ cpu: number; memory: number }> {
  const session = store.get(id);
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

// keep type re-export for existing imports
export type { SessionEntry };
