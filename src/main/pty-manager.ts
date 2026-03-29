import * as pty from "node-pty";
import { execSync } from "child_process";
import { platform } from "os";
import * as path from "path";
import { app } from "electron";
import * as fs from "fs";

const TMUX_SOCKET = "terminal-app";

/**
 * Escapes a string for safe use as a shell argument by wrapping it
 * in single quotes and escaping any embedded single quotes.
 */
function shellEscape(arg: string): string {
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

interface PtySession {
  id: number;
  tmuxName: string;
  process: pty.IPty;
}

let nextId = 1;
const sessions = new Map<number, PtySession>();

// Resolve the bundled tmux binary path
function getTmuxPath(): string {
  if (app.isPackaged) {
    // In packaged app: Contents/Resources/app.asar.unpacked/vendor/bin/tmux
    return path.join(
      process.resourcesPath,
      "app.asar.unpacked",
      "vendor",
      "bin",
      "tmux"
    );
  }
  return path.join(app.getAppPath(), "vendor", "bin", "tmux");
}

function getTmuxEnv(): { [key: string]: string } {
  let libDir: string;
  if (app.isPackaged) {
    libDir = path.join(
      process.resourcesPath,
      "app.asar.unpacked",
      "vendor",
      "lib"
    );
  } else {
    libDir = path.join(app.getAppPath(), "vendor", "lib");
  }

  return {
    ...(process.env as { [key: string]: string }),
    DYLD_LIBRARY_PATH: libDir,
    LANG: process.env.LANG || "en_US.UTF-8",
    LC_ALL: process.env.LC_ALL || "en_US.UTF-8",
  };
}

export function isTmuxAvailable(): boolean {
  const tmuxPath = getTmuxPath();
  return fs.existsSync(tmuxPath);
}

function getNextTmuxName(): string {
  const existing = listTmuxSessions();
  let max = 0;
  for (const name of existing) {
    const match = name.match(/^tab-(\d+)$/);
    if (match) {
      max = Math.max(max, parseInt(match[1]));
    }
  }
  return `tab-${max + 1}`;
}

function getDefaultShell(): string {
  if (platform() === "win32") {
    return "powershell.exe";
  }
  return process.env.SHELL || "/bin/bash";
}

function tmuxExec(args: string): string {
  const tmuxPath = getTmuxPath();
  const env = getTmuxEnv();
  return execSync(`"${tmuxPath}" ${args}`, {
    encoding: "utf8",
    stdio: "pipe",
    env,
  });
}

export function createSession(
  cols: number,
  rows: number,
  onData: (id: number, data: string) => void,
  onExit: (id: number, exitCode: number) => void,
  cwd?: string,
  existingTmuxSession?: string
): { id: number; tmuxName: string } {
  const id = nextId++;
  const tmuxName = existingTmuxSession || getNextTmuxName();
  const sessionCwd = cwd || process.env.HOME || "/";

  // Create tmux session if it doesn't already exist
  const existing = listTmuxSessions();
  if (!existing.includes(tmuxName)) {
    const shell = getDefaultShell();
    try {
      tmuxExec(
        `-u -L ${TMUX_SOCKET} new-session -d -s ${shellEscape(tmuxName)} -x ${cols} -y ${rows} -c ${shellEscape(sessionCwd)} ${shellEscape(shell)}`
      );
      // Set scrollback buffer (mouse scrolling handled by xterm.js)
      tmuxExec(
        `-L ${TMUX_SOCKET} set-option -t ${shellEscape(tmuxName)} -g history-limit 10000`
      );
      // Disable tmux mouse mode (scrolling handled by xterm.js)
      tmuxExec(
        `-L ${TMUX_SOCKET} set-option -t ${shellEscape(tmuxName)} mouse off`
      );
      // Disable alternate screen — lets xterm.js manage scrollback directly
      tmuxExec(
        `-L ${TMUX_SOCKET} set-option -g terminal-overrides ",xterm-256color:smcup@:rmcup@"`
      );
      // Disable tmux right-click popup menu (custom context menu in renderer)
      tmuxExec(
        `-L ${TMUX_SOCKET} unbind-key -T root MouseDown3Pane`
      );
    } catch (err) {
      // Clean up the partially-created tmux session if any step failed
      try {
        tmuxExec(
          `-L ${TMUX_SOCKET} kill-session -t ${shellEscape(tmuxName)} 2>/dev/null`
        );
      } catch {
        // session may not have been created at all
      }
      throw new Error(
        `Failed to create tmux session "${tmuxName}": ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  const tmuxPath = getTmuxPath();
  const env = getTmuxEnv();

  let proc: pty.IPty;
  try {
    // Attach to the tmux session via node-pty
    proc = pty.spawn(
      tmuxPath,
      ["-u", "-L", TMUX_SOCKET, "attach-session", "-t", tmuxName],
      {
        name: "xterm-256color",
        cols,
        rows,
        cwd: process.env.HOME || "/",
        env,
      }
    );
  } catch (err) {
    throw new Error(
      `Failed to attach to tmux session "${tmuxName}": ${err instanceof Error ? err.message : String(err)}`
    );
  }

  proc.onData((data: string) => onData(id, data));
  proc.onExit(({ exitCode }) => {
    sessions.delete(id);
    onExit(id, exitCode);
  });

  sessions.set(id, { id, tmuxName, process: proc });
  return { id, tmuxName };
}

export function listTmuxSessions(): string[] {
  try {
    const output = tmuxExec(
      `-L ${TMUX_SOCKET} list-sessions -F "#{session_name}" 2>/dev/null`
    );
    return output.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

export function getSessionCwd(id: number): string {
  const session = sessions.get(id);
  if (!session) return process.env.HOME || "/";
  return getTmuxSessionCwd(session.tmuxName);
}

export function getTmuxSessionCwd(tmuxName: string): string {
  try {
    return tmuxExec(
      `-L ${TMUX_SOCKET} display-message -p -t ${shellEscape(tmuxName)} "#{pane_current_path}" 2>/dev/null`
    ).trim();
  } catch {
    return process.env.HOME || "/";
  }
}

export function getSessionTmuxName(id: number): string | null {
  return sessions.get(id)?.tmuxName || null;
}

export function writeToSession(id: number, data: string): void {
  const session = sessions.get(id);
  if (!session) return;
  try {
    session.process.write(data);
  } catch (err) {
    // Process is dead — clean up the orphaned session entry
    sessions.delete(id);
    console.error(
      `writeToSession failed for session ${id}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export function resizeSession(id: number, cols: number, rows: number): void {
  const session = sessions.get(id);
  if (!session) return;
  try {
    session.process.resize(cols, rows);
  } catch (err) {
    // Process is dead — clean up the orphaned session entry
    sessions.delete(id);
    console.error(
      `resizeSession failed for session ${id}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

// Kill both the PTY client and the tmux session (used when user closes a tab)
export function destroySession(id: number): void {
  const session = sessions.get(id);
  if (session) {
    try {
      tmuxExec(
        `-L ${TMUX_SOCKET} kill-session -t ${shellEscape(session.tmuxName)} 2>/dev/null`
      );
    } catch {
      // session may already be dead
    }
    session.process.kill();
    sessions.delete(id);
  }
}

// Detach only — kill PTY clients but keep tmux sessions alive (used on app quit)
export function detachAll(): void {
  for (const [, session] of sessions) {
    session.process.kill();
  }
  sessions.clear();
}

// Kill everything (tmux sessions + PTY clients)
export function destroyAll(): void {
  for (const [id] of sessions) {
    destroySession(id);
  }
}

// --- Pane operations ---

export interface PaneInfo {
  paneId: string;
  left: number;
  top: number;
  width: number;
  height: number;
  active: boolean;
}

export function listPanes(tmuxName: string): PaneInfo[] {
  try {
    const output = tmuxExec(
      `-L ${TMUX_SOCKET} list-panes -t ${shellEscape(tmuxName)} -F "#{pane_id}:#{pane_left}:#{pane_top}:#{pane_width}:#{pane_height}:#{pane_active}"`
    );
    return output
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [paneId, left, top, width, height, active] = line.split(":");
        return {
          paneId,
          left: parseInt(left),
          top: parseInt(top),
          width: parseInt(width),
          height: parseInt(height),
          active: active === "1",
        };
      });
  } catch {
    return [];
  }
}

export function selectPane(tmuxName: string, paneId: string): void {
  try {
    tmuxExec(`-L ${TMUX_SOCKET} select-pane -t ${shellEscape(paneId)}`);
  } catch {
    // pane may no longer exist
  }
}

export function splitPane(
  tmuxName: string,
  direction: "horizontal" | "vertical"
): void {
  const flag = direction === "horizontal" ? "-v" : "-h";
  tmuxExec(
    `-L ${TMUX_SOCKET} split-window ${flag} -t ${shellEscape(tmuxName)}`
  );
}

export function closePane(tmuxName: string): void {
  try {
    tmuxExec(
      `-L ${TMUX_SOCKET} kill-pane -t ${shellEscape(tmuxName)}`
    );
  } catch {
    // pane or session may already be dead
  }
}

export function scrollSession(
  tmuxName: string,
  direction: "up" | "down",
  lines: number
): void {
  try {
    // Enter copy-mode (no-op if already in copy-mode)
    tmuxExec(
      `-L ${TMUX_SOCKET} copy-mode -t ${shellEscape(tmuxName)}`
    );
    const cmd = direction === "up" ? "scroll-up" : "scroll-down";
    tmuxExec(
      `-L ${TMUX_SOCKET} send-keys -t ${shellEscape(tmuxName)} -X -N ${lines} ${cmd}`
    );
  } catch {
    // ignore — might not be in copy-mode or session may not exist
  }
}

export function renameTmuxSession(oldName: string, newName: string): string {
  // Sanitize: tmux session names cannot contain dots or colons
  const sanitized = newName.replace(/[.:]/g, "-").replace(/\s+/g, "-") || oldName;
  try {
    tmuxExec(
      `-L ${TMUX_SOCKET} rename-session -t ${shellEscape(oldName)} ${shellEscape(sanitized)}`
    );
    return sanitized;
  } catch {
    return oldName;
  }
}

export function exitCopyMode(tmuxName: string): void {
  try {
    tmuxExec(
      `-L ${TMUX_SOCKET} send-keys -t ${shellEscape(tmuxName)} -X cancel`
    );
  } catch {
    // ignore — might not be in copy-mode
  }
}

export function navigatePane(
  tmuxName: string,
  direction: "U" | "D" | "L" | "R"
): void {
  try {
    tmuxExec(
      `-L ${TMUX_SOCKET} select-pane -t ${shellEscape(tmuxName)} -${direction}`
    );
  } catch {
    // ignore
  }
}
