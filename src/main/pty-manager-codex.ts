import * as pty from "node-pty";
import * as path from "path";
import {
  buildSessionEnv,
  createSessionStore,
  findInProcessTree,
  getInteractiveShell,
  isCommandAvailable,
  resolveSessionCwd,
} from "./pty-manager-base";

// ---------------------------------------------------------------------------
// Codex PTY manager — mirrors the Claude manager but targets the `codex` CLI
// (OpenAI Codex CLI, interactive REPL mode). Standalone session store keeps
// IDs in the 50000+ range so they never collide with Claude's 1+ range.
// ---------------------------------------------------------------------------

const store = createSessionStore(50000, "[pty-codex]");

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
 *
 * Sprint 3: optional taskText is passed as codex's positional prompt argument
 * via the shell's argv array — NOT interpolated into any -c string.
 */
export function createSessionWithCodex(
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

  const args = typeof taskText === "string" && taskText.length > 0
    ? ["-i", "-c", 'codex "$@"; exec zsh -i', "--", taskText]
    : ["-i", "-c", "codex; exec zsh -i"];

  console.log(`[pty-codex] spawning session id=${id} cwd=${sessionCwd}`);

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
    console.log(`[pty-codex] session ${id} exited with code ${exitCode}`);
    onExit(id, exitCode);
  });

  store.register({ id, sessionKey, process: proc, childPid });
  return { id, sessionKey };
}

/**
 * Check whether `codex` is resolvable from an interactive zsh shell.
 */
export async function isCodexAvailable(): Promise<boolean> {
  const result = await isCommandAvailable("codex");
  console.log(`[pty-codex] isCodexAvailable=${result}`);
  return result;
}

// ---------------------------------------------------------------------------
// Re-exports of shared store ops
// ---------------------------------------------------------------------------

export const writeToSession = (id: number, data: string): void => store.write(id, data);
export const resizeSession = (id: number, cols: number, rows: number): void => store.resize(id, cols, rows);
export const destroySession = (id: number): void => store.destroy(id);
export const destroyAll = (): void => store.destroyAll();
export const getSessionKey = (id: number): string | null => store.sessionKey(id);
export const hasSession = (id: number): boolean => store.has(id);
export const getCwd = (id: number): Promise<string> => store.cwd(id);

/**
 * Check whether any running Codex session is rooted in the given cwd.
 */
export async function hasRunningSessionAtCwd(targetCwd: string): Promise<boolean> {
  const normalizedTarget = path.resolve(targetCwd);
  const sessions = Array.from(store.values());
  const results = await Promise.all(
    sessions.map(async (session) => {
      try {
        const cwd = path.resolve(await store.cwd(session.id));
        if (cwd !== normalizedTarget) return false;
        const status = await getCodexStatus(session.id);
        return status.isCodexRunning;
      } catch {
        return false;
      }
    }),
  );
  return results.some(Boolean);
}

// ---------------------------------------------------------------------------
// Codex process status — Sprint 2: Sidebar Running marker
// ---------------------------------------------------------------------------

/**
 * Check if a `codex` process is running in the process tree rooted at the
 * session's shell PID.
 */
export async function getCodexStatus(
  id: number,
): Promise<{ isCodexRunning: boolean; codexPid: number | null }> {
  const session = store.get(id);
  if (!session) return { isCodexRunning: false, codexPid: null };

  try {
    const found = await findInProcessTree(session.childPid, 3, "codex", "/codex/");
    if (found !== null) return { isCodexRunning: true, codexPid: found };
    return { isCodexRunning: false, codexPid: null };
  } catch {
    return { isCodexRunning: false, codexPid: null };
  }
}
