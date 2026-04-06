import * as pty from "node-pty";
import { execSync, execFile } from "child_process";
import { promisify } from "util";
import { platform } from "os";
import * as path from "path";
import { app } from "electron";
import * as fs from "fs";

const execFileAsync = promisify(execFile);

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

/**
 * Returns the path to a bundled vendor resource.
 * @param segment - "bin" or "lib"
 */
function getVendorPath(segment: "bin" | "lib"): string {
  const vendorSegment = app.isPackaged
    ? path.join(process.resourcesPath, "app.asar.unpacked", "vendor", segment)
    : path.join(app.getAppPath(), "vendor", segment);
  return vendorSegment;
}

// Resolve the bundled tmux binary path
function getTmuxPath(): string {
  return path.join(getVendorPath("bin"), "tmux");
}

function getTmuxEnv(): { [key: string]: string } {
  const libDir = getVendorPath("lib");
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
  return execSync(`'${tmuxPath}' ${args}`, {
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
  let sessionCwd = cwd || process.env.HOME || "/";
  // Validate cwd is an absolute path to prevent shell injection via tmux -c flag
  if (sessionCwd && (typeof sessionCwd !== "string" || !path.isAbsolute(sessionCwd) || !fs.existsSync(sessionCwd))) {
    sessionCwd = process.env.HOME || "/";
  }

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
      // Enable aggressive-resize so window tracks the attached client size
      tmuxExec(
        `-L ${TMUX_SOCKET} set-window-option -t ${shellEscape(tmuxName)} aggressive-resize on`
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

export function getTmuxSessionName(tmuxName: string): string {
  try {
    return tmuxExec(
      `-L ${TMUX_SOCKET} display-message -p -t ${shellEscape(tmuxName)} "#{session_name}" 2>/dev/null`
    ).trim();
  } catch {
    return tmuxName;
  }
}

export function getTmuxPaneCurrentCommand(tmuxName: string): string {
  try {
    // #{pane_current_command} gives the process name (e.g., "bash", "zsh", "node")
    return tmuxExec(
      `-L ${TMUX_SOCKET} display-message -p -t ${shellEscape(tmuxName)} "#{pane_current_command}" 2>/dev/null`
    ).trim();
  } catch {
    return "";
  }
}

export function getTmuxPanePid(tmuxName: string): string {
  try {
    return tmuxExec(
      `-L ${TMUX_SOCKET} display-message -p -t ${shellEscape(tmuxName)} "#{pane_pid}" 2>/dev/null`
    ).trim();
  } catch {
    return "";
  }
}

export async function getProcessInfo(pid: string): Promise<{ cpu: number; memory: number }> {
  // Validate pid is numeric to prevent shell injection
  if (!pid || !/^\d+$/.test(pid)) return { cpu: 0, memory: 0 };
  try {
    const { stdout } = await execFileAsync("ps", ["-p", pid, "-o", "%cpu=,%mem="], { encoding: "utf8", timeout: 2000 });
    const output = stdout.trim();
    const [cpu, mem] = output.split(",").map(s => parseFloat(s.trim()) || 0);
    return { cpu, memory: mem };
  } catch {
    return { cpu: 0, memory: 0 };
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
  try {
    const flag = direction === "horizontal" ? "-v" : "-h";
    tmuxExec(
      `-L ${TMUX_SOCKET} split-window ${flag} -t ${shellEscape(tmuxName)}`
    );
  } catch {
    // pane or session may already be dead
  }
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
  } catch (err) {
    console.error(`[pty-manager] scrollSession failed for ${tmuxName}:`, err instanceof Error ? err.message : String(err));
  }
}

export function renameTmuxSession(oldName: string, newName: string): string {
  // Sanitize: strip control chars, dots, colons; collapse whitespace to hyphens
  const sanitized = newName
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/[.:]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "") || oldName;
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

export function sendTmuxKey(tmuxName: string, key: string): void {
  try {
    // Escape all shell metacharacters to prevent injection
    const safeKey = key.replace(/[\\$`"';|&<>!#]/g, "\\$&");
    tmuxExec(
      `-L ${TMUX_SOCKET} send-keys -t ${shellEscape(tmuxName)} -X search-forward '${safeKey}'`
    );
  } catch {
    // ignore
  }
}

export function sendTextToTmux(tmuxName: string, text: string): void {
  try {
    // Escape all shell metacharacters to prevent injection
    const safeText = text.replace(/[\\$`"';|&<>!#\r\n]/g, "\\$&");
    tmuxExec(
      `-L ${TMUX_SOCKET} send-keys -t ${shellEscape(tmuxName)} '${safeText}'`
    );
  } catch {
    // ignore
  }
}

export function startTmuxSearch(tmuxName: string): void {
  try {
    // Enter copy-mode and start search with /
    tmuxExec(`-L ${TMUX_SOCKET} copy-mode -t ${shellEscape(tmuxName)}`);
    tmuxExec(
      `-L ${TMUX_SOCKET} send-keys -t ${shellEscape(tmuxName)} "/"`
    );
  } catch {
    // ignore
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
