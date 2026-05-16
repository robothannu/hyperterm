import { app, BrowserWindow, ipcMain, Menu, MenuItem, shell, Notification, dialog } from "electron";
import * as path from "path";
import * as fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import * as net from "net";
import * as os from "os";

const execFileAsync = promisify(execFile);
import * as PtyManager from "./pty-manager";
import * as PtyManagerCodex from "./pty-manager-codex";
import { installSubagentHooks } from "./subagent-hook-installer";
import { isActiveHarnessPhase, isWorkspaceOpenFromCwds } from "./session-state";
import {
  startSubagentWatcher,
  stopSubagentWatcher,
  getSubagentSnapshot,
} from "./subagent-watcher";
import {
  initWorkspaces,
  loadWorkspaces,
  addWorkspace,
  removeWorkspace,
  renameWorkspace,
  archiveToggleWorkspace,
  type Workspace,
} from "./workspaces";
import { getCardData, summarizeOverview, getStatusInfo, getFileTree, detectTool } from "./workspace-reader";
import {
  initWorkflows,
  loadWorkflows,
  saveWorkflows,
  addWorkflow,
  removeWorkflow,
  makeWorkflow,
  type Workflow,
} from "./workflows";

interface Note {
  id: number;
  content: string;
  createdAt: string;
}

app.setName("HyperT");

// Global exception handlers
process.on("uncaughtException", (err) => {
  console.error("[main] Uncaught exception:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[main] Unhandled rejection:", reason);
});

let mainWindow: BrowserWindow | null = null;
let dashboardWindow: BrowserWindow | null = null;
let isQuitting = false;
let forceQuitTimer: NodeJS.Timeout | null = null;
let hookServer: net.Server | null = null;

// In-memory workspace list (persisted via workspaces module)
let workspaces: Workspace[] = [];

// In-memory workflow list (persisted via workflows module). Initialized on app ready.
let workflows: Workflow[] = [];

const sessionsFilePath = path.join(app.getPath("userData"), "sessions.json");
const notesFilePath = path.join(app.getPath("userData"), "notes.json");
const settingsFilePath = path.join(app.getPath("userData"), "settings.json");

// --- App Settings ---

interface AppSettings {
  claudeNotifications: boolean;
  codexNotifications?: boolean;
  fontSize?: number;
  theme?: "dark" | "light";
  recentProjects?: string[];
}

let appSettings: AppSettings = { claudeNotifications: true, codexNotifications: true };

function loadSettings(): void {
  try {
    if (fs.existsSync(settingsFilePath)) {
      const raw = fs.readFileSync(settingsFilePath, "utf8");
      const parsed = JSON.parse(raw);
      appSettings = { ...appSettings, ...parsed };
    }
  } catch {
    // ignore, use defaults
  }
}

function persistSettings(): void {
  try {
    fs.writeFileSync(settingsFilePath, JSON.stringify(appSettings, null, 2), "utf8");
  } catch (err) {
    console.error("[main] Failed to persist settings:", err);
  }
}

// --- Unix Socket Hook Server ---

const sockPath = path.join(os.homedir(), "Library", "Application Support", "HyperTerm", "agent.sock");

function startHookServer(): net.Server {
  // Ensure directory exists
  const sockDir = path.dirname(sockPath);
  try { fs.mkdirSync(sockDir, { recursive: true }); } catch {}
  // Remove stale socket file
  try { fs.unlinkSync(sockPath); } catch {}

  const server = net.createServer((socket) => {
    let buf = "";
    socket.on("data", (data) => {
      buf += data.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line);
          mainWindow?.webContents.send("hook:event", evt);
        } catch {
          // ignore malformed JSON
        }
      }
    });
    socket.on("error", () => { /* ignore client errors */ });
  });

  server.on("error", (err) => {
    console.error("[main] Hook server error:", err);
  });

  server.listen(sockPath, () => {
    console.log(`[main] Hook server listening at ${sockPath}`);
  });

  return server;
}

// --- Hook Script + settings.json Installation ---

const hookScriptDir = path.join(os.homedir(), ".config", "hyperterm");
const hookScriptPath = path.join(hookScriptDir, "hook.sh");
const claudeSettingsPath = path.join(os.homedir(), ".claude", "settings.json");

function ensureHookScript(): void {
  try {
    fs.mkdirSync(hookScriptDir, { recursive: true });
    const script = `#!/bin/bash
# Claude Code hook → HyperTerm Unix socket
# Single python3 invocation to avoid macOS launcher crash dialogs.
# Use Apple-signed /usr/bin/python3 explicitly (more stable than brew python).
# HYPERTERM_PTY_ID is injected by pty-manager and inherited via Claude Code → this hook.
PAYLOAD=$(cat)
SOCK="$HOME/Library/Application Support/HyperTerm/agent.sock"
PTY_ID="\${HYPERTERM_PTY_ID:-}"
echo "$PAYLOAD" | HYPERT_PTY_ID="$PTY_ID" /usr/bin/python3 -c '
import sys, json, os
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
out = {
    "event": d.get("hook_event_name", "unknown"),
    "session_id": d.get("session_id", ""),
    "tool_name": d.get("tool_name", ""),
    "message": d.get("message", ""),
    "hypert_pty_id": os.environ.get("HYPERT_PTY_ID", ""),
}
sys.stdout.write(json.dumps(out) + "\\n")
' 2>/dev/null | nc -U "$SOCK" 2>/dev/null || true
`;
    // Always overwrite to keep hook.sh up-to-date with the latest template
    fs.writeFileSync(hookScriptPath, script, { mode: 0o755, encoding: "utf8" });
  } catch (err) {
    console.error("[main] Failed to write hook.sh:", err);
  }
}

function installClaudeHooks(): boolean {
  try {
    ensureHookScript();

    const claudeDir = path.join(os.homedir(), ".claude");
    try { fs.mkdirSync(claudeDir, { recursive: true }); } catch {}

    let existing: Record<string, unknown> = {};
    try {
      if (fs.existsSync(claudeSettingsPath)) {
        existing = JSON.parse(fs.readFileSync(claudeSettingsPath, "utf8"));
      }
    } catch {
      existing = {};
    }

    const hookEntry = {
      matcher: "",
      hooks: [{ type: "command", command: hookScriptPath }],
    };

    const hooks = (existing.hooks as Record<string, unknown[]> | undefined) || {};
    for (const event of ["PreToolUse", "PostToolUse", "UserPromptSubmit", "Notification", "Stop"]) {
      if (!Array.isArray(hooks[event])) {
        hooks[event] = [];
      }
      // Avoid duplicates
      const arr = hooks[event] as Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }>;
      const alreadyPresent = arr.some((e) =>
        Array.isArray(e.hooks) && e.hooks.some((h) => h.command === hookScriptPath)
      );
      if (!alreadyPresent) {
        arr.push(hookEntry);
      }
    }

    existing.hooks = hooks;
    fs.writeFileSync(claudeSettingsPath, JSON.stringify(existing, null, 2), "utf8");
    return true;
  } catch (err) {
    console.error("[main] Failed to install Claude hooks:", err);
    return false;
  }
}

function isHookInstalled(): boolean {
  try {
    if (!fs.existsSync(claudeSettingsPath)) return false;
    const settings = JSON.parse(fs.readFileSync(claudeSettingsPath, "utf8"));
    const hooks = settings?.hooks;
    if (!hooks) return false;
    for (const event of ["PreToolUse", "PostToolUse", "UserPromptSubmit", "Notification", "Stop"]) {
      const arr = hooks[event];
      if (!Array.isArray(arr)) return false;
      const found = arr.some((e: { hooks?: Array<{ command?: string }> }) =>
        Array.isArray(e.hooks) && e.hooks.some((h) => h.command === hookScriptPath)
      );
      if (!found) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    backgroundColor: "#1a1a2e",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 12, y: 10 },
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));

  // Open DevTools in dev mode
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  // Disable Electron's default context menu (custom menu is in renderer)
  mainWindow.webContents.on("context-menu", (e) => {
    e.preventDefault();
  });

  // Intercept close to save session metadata first, then destroy all pty sessions
  mainWindow.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      isQuitting = true;
      mainWindow?.webContents.send("app:before-quit");

      // Force-quit if renderer never responds with app:quit-ready
      forceQuitTimer = setTimeout(() => {
        console.warn("[main] Renderer did not respond to app:before-quit in time, force-quitting.");
        PtyManager.destroyAll();
        PtyManagerCodex.destroyAll();
        if (mainWindow) {
          mainWindow.destroy();
        }
        app.quit();
      }, 3000);
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// --- Dashboard Window ---

function openDashboardWindow(): void {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    // Singleton: bring to front
    if (dashboardWindow.isMinimized()) dashboardWindow.restore();
    dashboardWindow.focus();
    console.log("[dashboard] focus: existing window brought to front");
    return;
  }

  dashboardWindow = new BrowserWindow({
    width: 1340,
    height: 840,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: "#0a0b0f",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 12, y: 12 },
    title: "Workspace Dashboard",
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "dashboard-preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  dashboardWindow.loadFile(
    path.join(__dirname, "..", "renderer", "dashboard.html")
  );

  if (!app.isPackaged) {
    dashboardWindow.webContents.openDevTools({ mode: "detach" });
  }

  dashboardWindow.on("closed", () => {
    dashboardWindow = null;
    console.log("[dashboard] window closed");
  });

  console.log("[dashboard] open: new dashboard window created");
}

// --- IPC Handlers ---

function isValidDimension(cols: number, rows: number): boolean {
  return Number.isInteger(cols) && Number.isInteger(rows)
    && cols >= 1 && rows >= 1 && cols <= 10000 && rows <= 10000;
}

ipcMain.handle(
  "pty:create",
  (_event, cols: number, rows: number, cwd?: string) => {
    if (!isValidDimension(cols, rows)) {
      throw new Error(`Invalid dimensions: cols=${cols}, rows=${rows}`);
    }
    const result = PtyManager.createSession(
      cols,
      rows,
      (sessionId, data) => {
        mainWindow?.webContents.send("pty:data", sessionId, data);
      },
      (sessionId, exitCode) => {
        mainWindow?.webContents.send("pty:exit", sessionId, exitCode);
      },
      cwd,
    );
    return result; // { id, sessionKey }
  }
);

// --- pty:createWithClaude IPC (Sprint: Run with Claude) ---
// Spawns a PTY whose foreground command is `claude` (Claude Code CLI),
// then drops into an interactive zsh after claude exits. Pre-check
// `claude` availability via main process before letting renderer call
// this — caller (renderer) can short-circuit and toast.
//
// Sprint 2: optional `taskText` is forwarded to PtyManager which passes it
// as a *positional argv* to zsh (not interpolated into the -c script).
// Metacharacters in taskText are NOT shell-evaluated.
ipcMain.handle(
  "pty:createWithClaude",
  (_event, cols: number, rows: number, cwd?: string, taskText?: string) => {
    if (!isValidDimension(cols, rows)) {
      throw new Error(`Invalid dimensions: cols=${cols}, rows=${rows}`);
    }
    const safeTaskText =
      typeof taskText === "string" && taskText.length > 0 ? taskText : undefined;
    const result = PtyManager.createSessionWithClaude(
      cols,
      rows,
      (sessionId, data) => {
        mainWindow?.webContents.send("pty:data", sessionId, data);
      },
      (sessionId, exitCode) => {
        mainWindow?.webContents.send("pty:exit", sessionId, exitCode);
      },
      cwd,
      safeTaskText,
    );
    return result; // { id, sessionKey }
  }
);

// --- claude:checkInstalled IPC (Sprint: Run with Claude) ---
// Returns whether `claude` is resolvable from an interactive zsh.
ipcMain.handle("claude:checkInstalled", async () => {
  return await PtyManager.isClaudeAvailable();
});

// --- codex:checkInstalled IPC (Sprint 1: Codex 진입점) ---
// Returns whether `codex` is resolvable from an interactive zsh.
ipcMain.handle("codex:checkInstalled", async () => {
  return await PtyManagerCodex.isCodexAvailable();
});

// --- pty:createWithCodex IPC (Sprint 1: Codex 진입점) ---
// Spawns a PTY whose foreground command is `codex` (OpenAI Codex CLI
// interactive REPL), then drops into an interactive zsh after codex exits.
// Mirrors pty:createWithClaude pattern exactly.
// SECURITY: spawn argv is hardcoded literal — no user input interpolation.
// Sprint 3: added optional taskText parameter forwarded to codex as positional arg.
ipcMain.handle(
  "pty:createWithCodex",
  (_event, cols: number, rows: number, cwd?: string, taskText?: string) => {
    if (!isValidDimension(cols, rows)) {
      throw new Error(`[codex] Invalid dimensions: cols=${cols}, rows=${rows}`);
    }
    console.log(`[main] pty:createWithCodex IPC: cols=${cols} rows=${rows} cwd=${cwd}`);
    const result = PtyManagerCodex.createSessionWithCodex(
      cols,
      rows,
      (sessionId, data) => {
        mainWindow?.webContents.send("pty:data", sessionId, data);
      },
      (sessionId, exitCode) => {
        mainWindow?.webContents.send("pty:exit", sessionId, exitCode);
      },
      cwd,
      taskText,
    );
    return result; // { id, sessionKey }
  }
);

// --- workspace:openInMainWithCodex IPC (Sprint 1: Codex 진입점) ---
// Dashboard card "Codex" footer button → focus mainWindow + send
// group:openWithCwdWithCodex (renderer creates a NEW tab whose initial PTY
// runs `codex`).
//
// Policy mirrors workspace:openInMainWithClaude exactly:
//   - Pre-checks codex availability before opening any window.
//   - If codex missing, returns { error: "codex_missing" } without focusing.
//   - Caller (renderer) shows a toast.
// Sprint 3: added optional taskText parameter (safe argv path, same pattern as claude).
ipcMain.handle("workspace:openInMainWithCodex", async (_event, workspacePath: string, taskText?: string) => {
  if (!workspacePath || typeof workspacePath !== "string") {
    console.warn("[workspace] openInMainWithCodex: invalid path");
    return { error: "invalid_path" };
  }

  if (!fs.existsSync(workspacePath)) {
    console.warn(`[workspace] openInMainWithCodex: path does not exist: ${workspacePath}`);
    return { error: "path_missing" };
  }

  // Pre-check codex availability before opening any window.
  const codexAvailable = await PtyManagerCodex.isCodexAvailable();
  if (!codexAvailable) {
    console.warn("[workspace] openInMainWithCodex: codex CLI not found in PATH");
    return { error: "codex_missing" };
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    console.log("[workspace] openInMainWithCodex: mainWindow does not exist, creating it");
    if (forceQuitTimer !== null) {
      clearTimeout(forceQuitTimer);
      forceQuitTimer = null;
    }
    isQuitting = false;
    createWindow();
    await new Promise<void>((resolve) => {
      const win = mainWindow!;
      if (win.webContents.isLoading()) {
        win.webContents.once("did-finish-load", () => resolve());
      } else {
        resolve();
      }
    });
  }

  if (mainWindow!.isMinimized()) mainWindow!.restore();
  mainWindow!.focus();
  mainWindow!.show();

  const normalizedPath = path.resolve(workspacePath);
  // Sprint 3: taskText forwarded in payload (renderer passes it to codex PTY as prompt).
  const payload: { path: string; taskText?: string } = { path: normalizedPath };
  if (typeof taskText === "string" && taskText.length > 0) {
    payload.taskText = taskText;
  }
  console.log(`[workspace] openInMainWithCodex: sending group:openWithCwdWithCodex for ${normalizedPath}`);
  mainWindow!.webContents.send("group:openWithCwdWithCodex", payload);

  return { success: true };
});

ipcMain.on("pty:write", (_event, id: number, data: string) => {
  if (PtyManagerCodex.hasSession(id)) {
    PtyManagerCodex.writeToSession(id, data);
  } else {
    PtyManager.writeToSession(id, data);
  }
});

ipcMain.on("pty:resize", (_event, id: number, cols: number, rows: number) => {
  if (!isValidDimension(cols, rows)) return;
  if (PtyManagerCodex.hasSession(id)) {
    PtyManagerCodex.resizeSession(id, cols, rows);
  } else {
    PtyManager.resizeSession(id, cols, rows);
  }
});

ipcMain.on("pty:destroy", (_event, id: number) => {
  if (PtyManagerCodex.hasSession(id)) {
    PtyManagerCodex.destroySession(id);
  } else {
    PtyManager.destroySession(id);
  }
});

ipcMain.handle("pty:getCwd", (_event, id: number) => {
  if (PtyManagerCodex.hasSession(id)) {
    return PtyManagerCodex.getCwd(id);
  }
  return PtyManager.getCwd(id);
});

// --- Session metadata IPC ---

ipcMain.handle("session:save", (_event, data: string) => {
  try {
    fs.writeFileSync(sessionsFilePath, data, "utf8");
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle("session:load", () => {
  try {
    if (fs.existsSync(sessionsFilePath)) {
      return fs.readFileSync(sessionsFilePath, "utf8");
    }
  } catch {
    // ignore
  }
  return null;
});

// --- Notes IPC ---

function readNotes(): Record<string, Note[]> {
  try {
    if (fs.existsSync(notesFilePath)) {
      return JSON.parse(fs.readFileSync(notesFilePath, "utf8"));
    }
  } catch {
    // ignore
  }
  return {};
}

function writeNotes(data: Record<string, Note[]>): void {
  try {
    fs.writeFileSync(notesFilePath, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.error("[main] Failed to write notes:", err);
  }
}

ipcMain.handle("notes:load", (_event, sessionKey: string) => {
  const all = readNotes();
  return all[sessionKey] || [];
});

ipcMain.handle("notes:save", (_event, sessionKey: string, notes: Note[]) => {
  const all = readNotes();
  if (notes.length === 0) {
    delete all[sessionKey];
  } else {
    all[sessionKey] = notes;
  }
  writeNotes(all);
});

ipcMain.handle("notes:deleteSession", (_event, sessionKey: string) => {
  const all = readNotes();
  delete all[sessionKey];
  writeNotes(all);
});

// --- SSH Profiles IPC ---

// --- Usage IPC ---

async function getOAuthToken(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "security",
      ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
      { encoding: "utf8", timeout: 5000 }
    );
    const parsed = JSON.parse(stdout.trim());
    return parsed?.claudeAiOauth?.accessToken || null;
  } catch {
    return null;
  }
}

async function fetchUsageFromAPI(token: string): Promise<any> {
  const { stdout } = await execFileAsync(
    "curl",
    [
      "-s", "-f", "--max-time", "10",
      "-H", `Authorization: Bearer ${token}`,
      "-H", "anthropic-beta: oauth-2025-04-20",
      "https://api.anthropic.com/api/oauth/usage",
    ],
    { encoding: "utf8", timeout: 12000 }
  );
  return JSON.parse(stdout);
}

ipcMain.handle("usage:fetch", async () => {
  const token = await getOAuthToken();
  if (!token) {
    return { error: "keychain" };
  }
  try {
    const data = await fetchUsageFromAPI(token);
    return { data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[main] Usage fetch failed:", message);
    return { error: message === "parse" ? "parse" : "api" };
  }
});

// --- Git IPC ---

function findGitRoot(dir: string): string | null {
  let current = dir;
  while (true) {
    try {
      if (fs.existsSync(path.join(current, ".git"))) return current;
    } catch {
      return null;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

ipcMain.handle("git:findRoot", (_event, dir: string) => {
  if (!dir || typeof dir !== "string") return null;
  return findGitRoot(dir);
});

interface GitStatus {
  branch: string;
  dirty: boolean;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  aheadCount: number;
}

ipcMain.handle("git:status", async (_event, projectRoot: string): Promise<GitStatus | null> => {
  if (!projectRoot || typeof projectRoot !== "string") return null;
  try {
    const [branchResult, statusResult, aheadResult] = await Promise.all([
      execFileAsync("git", ["-C", projectRoot, "branch", "--show-current"], {
        encoding: "utf8",
        timeout: 5000,
      }),
      execFileAsync("git", ["-C", projectRoot, "status", "--porcelain"], {
        encoding: "utf8",
        timeout: 5000,
      }),
      execFileAsync("git", ["-C", projectRoot, "rev-list", "--count", "@{u}..HEAD"], {
        encoding: "utf8",
        timeout: 5000,
      }).catch(() => ({ stdout: "0" })),
    ]);

    const branch = branchResult.stdout.trim() || "HEAD";
    const lines = statusResult.stdout.split("\n").filter((l) => l.length > 0);
    const aheadCount = parseInt(aheadResult.stdout.trim(), 10) || 0;

    let stagedCount = 0;
    let unstagedCount = 0;
    let untrackedCount = 0;

    for (const line of lines) {
      const x = line[0]; // staged area
      const y = line[1]; // working tree

      if (x === "?" && y === "?") {
        untrackedCount++;
      } else {
        if (x !== " " && x !== "?") stagedCount++;
        if (y !== " " && y !== "?") unstagedCount++;
      }
    }

    return {
      branch,
      dirty: lines.length > 0,
      stagedCount,
      unstagedCount,
      untrackedCount,
      aheadCount,
    };
  } catch {
    return null;
  }
});

// Returns per-file list from `git status --porcelain`
interface GitFileEntry {
  path: string;
  x: string; // staged status char
  y: string; // unstaged status char
}

ipcMain.handle("git:files", async (_event, projectRoot: string): Promise<GitFileEntry[]> => {
  if (!projectRoot || typeof projectRoot !== "string") return [];
  try {
    const result = await execFileAsync(
      "git",
      ["-C", projectRoot, "status", "--porcelain"],
      { encoding: "utf8", timeout: 5000 }
    );
    return result.stdout
      .split("\n")
      .filter((l) => l.length >= 3)
      .map((l) => ({
        x: l[0],
        y: l[1],
        path: l.slice(3).trim(),
      }));
  } catch {
    return [];
  }
});

// Returns unified diff string for a given file
// Return: { diff: string } | { tooLarge: true; lineCount: number } | { error: string }
ipcMain.handle(
  "git:diff",
  async (
    _event,
    projectRoot: string,
    filePath: string,
    staged: boolean
  ): Promise<{ diff: string } | { tooLarge: true; lineCount: number } | { error: string }> => {
    if (!projectRoot || !filePath) return { error: "invalid args" };
    try {
      let stdout: string;
      try {
        const args = staged
          ? ["-C", projectRoot, "diff", "--cached", "--", filePath]
          : ["-C", projectRoot, "diff", "HEAD", "--", filePath];
        const result = await execFileAsync("git", args, {
          encoding: "utf8",
          timeout: 10000,
        });
        stdout = result.stdout;
      } catch (err: unknown) {
        // Untracked 파일: git diff --no-index /dev/null <file> (exit code 1 정상)
        const anyErr = err as { stdout?: string; code?: number };
        if (anyErr.stdout !== undefined) {
          stdout = anyErr.stdout;
        } else {
          return { error: String(err) };
        }
      }

      if (!stdout) {
        // staged=false이고 아직 HEAD가 없거나 untracked인 경우 재시도
        try {
          const result = await execFileAsync(
            "git",
            ["-C", projectRoot, "diff", "--no-index", "--", "/dev/null", filePath],
            { encoding: "utf8", timeout: 10000 }
          );
          stdout = result.stdout;
        } catch (err2: unknown) {
          const anyErr2 = err2 as { stdout?: string };
          if (anyErr2.stdout) {
            stdout = anyErr2.stdout;
          }
        }
      }

      const lineCount = stdout.split("\n").length;
      if (lineCount > 5000) {
        return { tooLarge: true, lineCount };
      }
      return { diff: stdout };
    } catch (err: unknown) {
      return { error: String(err) };
    }
  }
);

// --- Process info IPC (pty ID based) ---

ipcMain.handle("pty:getProcessInfo", async (_event, id: number) => {
  return await PtyManager.getProcessInfo(id);
});

ipcMain.handle("pty:getAgentStatus", async (_event, id: number) => {
  return await PtyManager.getAgentStatus(id);
});

// --- Sprint 2 (Codex sidebar marker): Codex process status IPC ---
// Separate from Claude polling path — failure here never affects Claude.
ipcMain.handle("pty:getCodexStatus", async (_event, id: number) => {
  return await PtyManagerCodex.getCodexStatus(id);
});

// Renderer signals that session metadata has been saved — safe to quit
ipcMain.on("app:quit-ready", () => {
  if (forceQuitTimer !== null) {
    clearTimeout(forceQuitTimer);
    forceQuitTimer = null;
  }
  PtyManager.destroyAll(); // kill all pty processes
  PtyManagerCodex.destroyAll(); // kill all codex pty processes
  if (hookServer) {
    hookServer.close();
    hookServer = null;
  }
  stopSubagentWatcher();
  if (mainWindow) {
    mainWindow.destroy();
  }
  app.quit();
});

// --- Dashboard IPC ---

ipcMain.on("dashboard:open", () => {
  console.log("[dashboard] IPC: dashboard:open received");
  openDashboardWindow();
});

// --- Workspace IPC ---

ipcMain.handle("workspace:list", () => {
  // Enrich each workspace with detected tool (mtime-based Claude/Codex selection).
  // Backwards-compatible: existing dashboard consumers ignore the extra field.
  return workspaces.map((w) => {
    let tool: "claude" | "codex" | "mixed" | "none" = "none";
    try {
      tool = detectTool(w.absolutePath);
    } catch {
      tool = "none";
    }
    return { ...w, tool };
  });
});

ipcMain.handle("workspace:add", async () => {
  console.log("[workspace] add: IPC invoked");
  const parent =
    dashboardWindow && !dashboardWindow.isDestroyed()
      ? dashboardWindow
      : mainWindow && !mainWindow.isDestroyed()
      ? mainWindow
      : null;

  let result;
  try {
    result = parent
      ? await dialog.showOpenDialog(parent, {
          title: "Select Workspace Folder",
          properties: ["openDirectory", "createDirectory"],
        })
      : await dialog.showOpenDialog({
          title: "Select Workspace Folder",
          properties: ["openDirectory", "createDirectory"],
        });
  } catch (err) {
    console.error("[workspace] add: dialog error:", err);
    return { workspaces, duplicate: false, cancelled: true };
  }

  if (result.canceled || result.filePaths.length === 0) {
    console.log("[workspace] add: dialog cancelled");
    return { workspaces, duplicate: false, cancelled: true };
  }

  const chosen = result.filePaths[0];
  console.log(`[workspace] add: chosen path=${chosen}`);
  const addResult = addWorkspace(workspaces, chosen);
  workspaces = addResult.workspaces;
  console.log(
    `[workspace] add: done — duplicate=${addResult.duplicate}, total=${workspaces.length}`
  );

  return {
    workspaces,
    duplicate: addResult.duplicate,
    cancelled: false,
  };
});

ipcMain.handle("workspace:pickParentDirectory", async (_event, defaultPath?: string) => {
  const parent = BrowserWindow.fromWebContents(_event.sender);
  const safeDefaultPath =
    defaultPath && typeof defaultPath === "string" && path.isAbsolute(defaultPath)
      ? defaultPath
      : undefined;

  try {
    const result = parent && !parent.isDestroyed()
      ? await dialog.showOpenDialog(parent, {
          title: "Select Parent Directory",
          defaultPath: safeDefaultPath,
          properties: ["openDirectory", "createDirectory"],
        })
      : await dialog.showOpenDialog({
          title: "Select Parent Directory",
          defaultPath: safeDefaultPath,
          properties: ["openDirectory", "createDirectory"],
        });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }
    return { canceled: false, path: result.filePaths[0] };
  } catch (err) {
    console.error("[workspace] pickParentDirectory dialog error:", err);
    return { canceled: true };
  }
});

ipcMain.handle("workspace:remove", (_event, id: string) => {
  workspaces = removeWorkspace(workspaces, id);
  return workspaces;
});

// --- Workflows IPC (Command Palette quick-runners) ---

ipcMain.handle("workflows:list", () => {
  return workflows;
});

ipcMain.handle(
  "workflows:add",
  (_event, input: { label?: unknown; command?: unknown; cwd?: unknown }) => {
    const result = makeWorkflow({
      label: typeof input?.label === "string" ? input.label : "",
      command: typeof input?.command === "string" ? input.command : "",
      cwd: typeof input?.cwd === "string" ? input.cwd : undefined,
    });
    if (!result.ok) return { ok: false, error: result.error, workflows };
    const added = addWorkflow(workflows, result.workflow);
    if (added.duplicate) return { ok: false, error: "duplicate", workflows };
    workflows = added.workflows;
    saveWorkflows(workflows);
    return { ok: true, workflow: result.workflow, workflows };
  }
);

ipcMain.handle("workflows:remove", (_event, id: string) => {
  if (typeof id !== "string" || id.length === 0) {
    return { ok: false, error: "invalid_id", workflows };
  }
  const next = removeWorkflow(workflows, id);
  if (next.length === workflows.length) {
    return { ok: false, error: "not_found", workflows };
  }
  workflows = next;
  saveWorkflows(workflows);
  return { ok: true, workflows };
});

// --- Workspace Discovery IPC (Sprint 3 — Discovery banner) ---
// Scans ~/dev, ~/work, ~/projects (1-level children only) for git repos that
// are not yet registered in workspaces.json. Missing roots silently skipped.

interface DiscoveryCandidate {
  absolutePath: string;
  name: string;
  root: string; // absolute path of the parent root (e.g. /Users/alice/dev)
}

const DISCOVERY_ROOT_NAMES = ["dev", "work", "projects"] as const;

ipcMain.handle("workspace:discoverCandidates", async (): Promise<DiscoveryCandidate[]> => {
  const home = os.homedir();
  const candidates: DiscoveryCandidate[] = [];

  // Pre-compute the set of registered absolutePaths for quick membership checks
  const registered = new Set<string>(
    workspaces.map((w) => path.resolve(w.absolutePath))
  );

  for (const rootName of DISCOVERY_ROOT_NAMES) {
    const root = path.join(home, rootName);
    let exists = false;
    try {
      exists = fs.existsSync(root);
    } catch {
      exists = false;
    }
    if (!exists) {
      // silently skip missing roots
      continue;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch (err) {
      console.warn(`[workspace] discoverCandidates: readdir failed for ${root}:`, err);
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // Skip dotfiles (e.g. .DS_Store dirs)
      if (entry.name.startsWith(".")) continue;

      const childPath = path.join(root, entry.name);
      const gitDir = path.join(childPath, ".git");
      let hasGit = false;
      try {
        hasGit = fs.existsSync(gitDir);
      } catch {
        hasGit = false;
      }
      if (!hasGit) continue;

      const normalized = path.resolve(childPath);
      if (registered.has(normalized)) continue;

      candidates.push({
        absolutePath: normalized,
        name: entry.name,
        root,
      });
    }
  }

  console.log(`[workspace] discoverCandidates: found ${candidates.length} candidate(s)`);
  return candidates;
});

interface BatchAddResult {
  workspaces: Workspace[];
  added: string[];                              // absolute paths that were added
  failed: { path: string; reason: string }[];   // duplicates or errors
}

ipcMain.handle("workspace:addBatch", async (_event, paths: string[]): Promise<BatchAddResult> => {
  const result: BatchAddResult = {
    workspaces,
    added: [],
    failed: [],
  };

  if (!Array.isArray(paths) || paths.length === 0) {
    return result;
  }

  for (const p of paths) {
    if (typeof p !== "string" || p.length === 0) {
      result.failed.push({ path: String(p), reason: "invalid_path" });
      continue;
    }
    if (!fs.existsSync(p)) {
      result.failed.push({ path: p, reason: "path_missing" });
      continue;
    }
    try {
      const r = addWorkspace(workspaces, p);
      workspaces = r.workspaces;
      if (r.duplicate) {
        result.failed.push({ path: p, reason: "duplicate" });
      } else {
        result.added.push(path.resolve(p));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[workspace] addBatch: failed to add ${p}: ${msg}`);
      result.failed.push({ path: p, reason: msg });
    }
  }

  result.workspaces = workspaces;
  console.log(
    `[workspace] addBatch: added=${result.added.length} failed=${result.failed.length}`
  );
  return result;
});

// --- Workspace Card Data IPC (Sprint 2) ---

ipcMain.handle("workspace:cardData", async (_event, workspacePath: string) => {
  return getCardData(workspacePath);
});

// --- Workspace Card Revamp IPC (Sprint 4) ---

ipcMain.handle("workspace:overviewSummary", async (_event, workspacePath: string) => {
  console.log(`[main] workspace:overviewSummary IPC for: ${workspacePath}`);
  return summarizeOverview(workspacePath);
});

ipcMain.handle("workspace:statusInfo", async (_event, workspacePath: string) => {
  console.log(`[main] workspace:statusInfo IPC for: ${workspacePath}`);
  return getStatusInfo(workspacePath);
});

ipcMain.handle("workspace:fileTree", async (_event, workspacePath: string) => {
  console.log(`[main] workspace:fileTree IPC for: ${workspacePath}`);
  return getFileTree(workspacePath);
});

// --- Workspace Archive Toggle IPC (Sprint 2) ---

ipcMain.handle("workspace:archiveToggle", (_event, id: string, archived: boolean) => {
  console.log(`[workspace] archiveToggle: id=${id} archived=${archived}`);
  const updated = archiveToggleWorkspace(workspaces, id, archived);
  if (updated === null) {
    console.warn(`[workspace] archiveToggle: failed for id=${id}`);
    return { workspaces, success: false };
  }
  workspaces = updated;
  return { workspaces, success: true };
});

// --- Workspace Rename IPC (Sprint 3) ---

ipcMain.handle("workspace:rename", (_event, id: string, newName: string) => {
  const updated = renameWorkspace(workspaces, id, newName);
  if (updated === null) {
    console.warn(`[workspace] rename: failed for id=${id}`);
    return { workspaces, success: false };
  }
  workspaces = updated;
  console.log(`[workspace] rename: IPC success id=${id}`);
  return { workspaces, success: true };
});

// --- workspace:openInMain IPC (Sprint 3) ---
// Dashboard card "Open" → focus mainWindow + send group:openWithCwd

ipcMain.handle("workspace:openInMain", async (_event, workspacePath: string) => {
  if (!workspacePath || typeof workspacePath !== "string") {
    console.warn("[workspace] openInMain: invalid path");
    return { error: "invalid_path" };
  }

  // Verify path exists on disk
  if (!fs.existsSync(workspacePath)) {
    console.warn(`[workspace] openInMain: path does not exist: ${workspacePath}`);
    return { error: "path_missing" };
  }

  // Ensure mainWindow exists; create it if needed
  if (!mainWindow || mainWindow.isDestroyed()) {
    console.log("[workspace] openInMain: mainWindow does not exist, creating it");
    // Cancel any in-flight quit sequence so the new window isn't destroyed
    // by a stale forceQuitTimer or a late app:quit-ready callback.
    if (forceQuitTimer !== null) {
      clearTimeout(forceQuitTimer);
      forceQuitTimer = null;
    }
    isQuitting = false;
    createWindow();
    // Give the window time to load before sending IPC
    await new Promise<void>((resolve) => {
      const win = mainWindow!;
      if (win.webContents.isLoading()) {
        win.webContents.once("did-finish-load", () => resolve());
      } else {
        resolve();
      }
    });
  }

  // Bring mainWindow to front
  if (mainWindow!.isMinimized()) mainWindow!.restore();
  mainWindow!.focus();
  mainWindow!.show();

  // Send the open request to main renderer
  const normalizedPath = path.resolve(workspacePath);
  console.log(`[workspace] openInMain: sending group:openWithCwd for ${normalizedPath}`);
  mainWindow!.webContents.send("group:openWithCwd", { path: normalizedPath });

  return { success: true };
});

// --- workspace:openInMainWithClaude IPC (Sprint: Run with Claude) ---
// Dashboard card "Claude" footer button → focus mainWindow + send
// group:openWithCwdWithClaude (renderer creates a NEW tab whose initial PTY
// runs `claude`).
//
// Policy decisions:
//   - Re-open dedup: handled in renderer (group:openWithCwdWithClaude). When
//     taskText is empty (Run with Claude), the renderer switches to an
//     existing claude tab whose claudeCwd === requestedPath. When taskText
//     is present (Ask Claude), the renderer always creates a new tab.
//     Main process unconditionally focuses the window and forwards the
//     event; the dedup decision lives next to tabMap (single source).
//   - Missing CLI: pre-check via PtyManager.isClaudeAvailable(). If missing,
//     return error WITHOUT focusing/creating any group. Caller toasts.
//   - SECURITY: spawn argv has no user-controlled string (literal "claude").
ipcMain.handle("workspace:openInMainWithClaude", async (_event, workspacePath: string, taskText?: string) => {
  if (!workspacePath || typeof workspacePath !== "string") {
    console.warn("[workspace] openInMainWithClaude: invalid path");
    return { error: "invalid_path" };
  }

  if (!fs.existsSync(workspacePath)) {
    console.warn(`[workspace] openInMainWithClaude: path does not exist: ${workspacePath}`);
    return { error: "path_missing" };
  }

  // Pre-check claude availability before opening any window. If missing we
  // do not focus/create the main window — caller shows a toast.
  const claudeAvailable = await PtyManager.isClaudeAvailable();
  if (!claudeAvailable) {
    console.warn("[workspace] openInMainWithClaude: claude CLI not found in PATH");
    return { error: "claude_missing" };
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    console.log("[workspace] openInMainWithClaude: mainWindow does not exist, creating it");
    if (forceQuitTimer !== null) {
      clearTimeout(forceQuitTimer);
      forceQuitTimer = null;
    }
    isQuitting = false;
    createWindow();
    await new Promise<void>((resolve) => {
      const win = mainWindow!;
      if (win.webContents.isLoading()) {
        win.webContents.once("did-finish-load", () => resolve());
      } else {
        resolve();
      }
    });
  }

  if (mainWindow!.isMinimized()) mainWindow!.restore();
  mainWindow!.focus();
  mainWindow!.show();

  const normalizedPath = path.resolve(workspacePath);
  // Sprint 2: taskText (optional) is forwarded as-is to renderer; eventually
  // passes through to zsh via positional argv (no shell interpolation).
  const safeTaskText =
    typeof taskText === "string" && taskText.length > 0 ? taskText : undefined;
  console.log(`[workspace] openInMainWithClaude: sending group:openWithCwdWithClaude for ${normalizedPath}${safeTaskText ? ` (with taskText, len=${safeTaskText.length})` : ""}`);
  mainWindow!.webContents.send("group:openWithCwdWithClaude", {
    path: normalizedPath,
    taskText: safeTaskText,
  });

  return { success: true };
});

// --- Session State IPC (Sprint 5: badges) ---
// Returns { open: boolean, harnessPhase: string | null, codexRunning: boolean }
// for a given workspace path.
// - open: true if sessions.json has any tab leaf with cwd at or under workspacePath
// - harnessPhase: current_phase from .claude/harness/state.json (null if idle/complete/missing)
// - codexRunning: true if any Codex PTY rooted at workspacePath is still active

function getOpenCwds(): Set<string> {
  try {
    if (!fs.existsSync(sessionsFilePath)) return new Set();
    const raw = fs.readFileSync(sessionsFilePath, "utf8");
    const parsed = JSON.parse(raw) as {
      tabs?: Array<{ layout?: unknown }>;
    };
    if (!Array.isArray(parsed.tabs)) return new Set();

    const cwds = new Set<string>();
    function collectLeafCwds(layout: unknown): void {
      if (!layout || typeof layout !== "object") return;
      const node = layout as { type?: string; cwd?: string; children?: unknown[] };
      if (node.type === "leaf" && typeof node.cwd === "string" && node.cwd.length > 0) {
        cwds.add(path.resolve(node.cwd));
      }
      if (Array.isArray(node.children)) {
        for (const child of node.children) collectLeafCwds(child);
      }
    }
    for (const tab of parsed.tabs) {
      collectLeafCwds(tab.layout);
    }
    return cwds;
  } catch (err) {
    console.warn("[dashboard] getOpenCwds: failed to read sessions.json:", err);
    return new Set();
  }
}

function getHarnessPhase(workspacePath: string): string | null {
  const stateFile = path.join(workspacePath, ".claude", "harness", "state.json");
  try {
    if (!fs.existsSync(stateFile)) return null;
    const raw = fs.readFileSync(stateFile, "utf8");
    const parsed = JSON.parse(raw) as { current_phase?: string };
    const phase = parsed.current_phase ?? null;
    if (!isActiveHarnessPhase(phase)) return null;
    return phase;
  } catch (err) {
    console.warn(`[dashboard] getHarnessPhase: failed to parse state.json for ${workspacePath}:`, err);
    return null;
  }
}

ipcMain.handle("workspace:sessionState", async (_event, workspacePath: string) => {
  if (!workspacePath || typeof workspacePath !== "string") {
    return { open: false, harnessPhase: null, codexRunning: false };
  }
  const normalized = path.resolve(workspacePath);
  let open = false;
  try {
    const openCwds = getOpenCwds();
    open = isWorkspaceOpenFromCwds(openCwds, normalized);
  } catch (err) {
    console.warn(`[dashboard] session-state: open check failed for ${normalized}:`, err);
  }
  const [harnessPhase, codexRunning] = await Promise.all([
    Promise.resolve(getHarnessPhase(normalized)),
    PtyManagerCodex.hasRunningSessionAtCwd(normalized).catch((err) => {
      console.warn(`[dashboard] session-state: codex check failed for ${normalized}:`, err);
      return false;
    }),
  ]);
  console.log(
    `[dashboard] session-state ws=${normalized} open=${open} harness=${harnessPhase ?? "null"} codex=${codexRunning ? "running" : "idle"}`
  );
  return { open, harnessPhase, codexRunning };
});

// --- Path Existence IPC ---

ipcMain.handle("path:checkExists", (_event, dirPath: string): boolean => {
  if (!dirPath || typeof dirPath !== "string") return false;
  try {
    return fs.existsSync(dirPath);
  } catch {
    return false;
  }
});

// --- Home dir IPC (Sprint 1 UX Polish: dashboard tilde abbreviation) ---

ipcMain.handle("workspace:homedir", (): string => {
  return os.homedir();
});

// --- Open in Terminal IPC (Sprint 1 UX Polish) ---
// Launches the macOS default Terminal app at the workspace path. This is
// distinct from `workspace:openInMain` which opens the workspace as a group
// inside the HyperTerm main window (footer "Open" button).

ipcMain.handle("workspace:openInTerminal", async (_event, workspacePath: string) => {
  if (!workspacePath || typeof workspacePath !== "string") {
    return { error: "invalid_path" };
  }
  if (!fs.existsSync(workspacePath)) {
    return { error: "path_missing" };
  }
  try {
    await execFileAsync("open", ["-a", "Terminal", workspacePath]);
    console.log(`[workspace] openInTerminal: opened in Terminal: ${workspacePath}`);
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[workspace] openInTerminal: failed: ${msg}`);
    return { error: msg };
  }
});

// --- Open in IDE IPC (Sprint 1 UX Polish) ---
// Try Cursor first, then fall back to standard `open` (which lets macOS pick).
// Returns { success: true } or { error: string } so renderer can toast appropriately.

ipcMain.handle("workspace:openInIDE", async (_event, workspacePath: string) => {
  if (!workspacePath || typeof workspacePath !== "string") {
    return { error: "invalid_path" };
  }
  if (!fs.existsSync(workspacePath)) {
    return { error: "path_missing" };
  }

  // First attempt: open with Cursor.app explicitly.
  try {
    await execFileAsync("open", ["-a", "Cursor", workspacePath]);
    console.log(`[workspace] openInIDE: opened in Cursor: ${workspacePath}`);
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[workspace] openInIDE: Cursor open failed: ${msg}`);
    return { error: "cursor_unavailable" };
  }
});

// --- Reveal in Finder IPC (Sprint 1 UX Polish) ---

ipcMain.handle("workspace:revealInFinder", async (_event, workspacePath: string) => {
  if (!workspacePath || typeof workspacePath !== "string") {
    return { error: "invalid_path" };
  }
  if (!fs.existsSync(workspacePath)) {
    return { error: "path_missing" };
  }
  try {
    // shell.openPath opens the directory itself in Finder; for a folder we
    // prefer this over showItemInFolder (which would highlight the folder
    // inside its parent — slightly less useful for a workspace folder).
    const errStr = await shell.openPath(workspacePath);
    if (errStr) {
      console.warn(`[workspace] revealInFinder: shell.openPath returned error: ${errStr}`);
      return { error: errStr };
    }
    console.log(`[workspace] revealInFinder: opened ${workspacePath}`);
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[workspace] revealInFinder: failed: ${msg}`);
    return { error: msg };
  }
});

// --- Git Flow IPC (Sprint 2 — Dashboard design v2) ---
// Returns commit/branch/tag data sufficient to render the gitflow SVG diagram.
// Bundles three pieces of git CLI output into one IPC roundtrip:
//   - git log -n 20 --all  (with %D decoration for refs/tags)
//   - git symbolic-ref --short HEAD (current branch)
// Returns null on non-git / missing path / failure (renderer skips SVG).

interface GitFlowCommit {
  id: string;          // full hash
  shortHash: string;
  parents: string[];
  author: string;
  relTime: string;
  msg: string;
  branch: string | null; // primary branch ref pointing at this commit (if any)
  tag: string | null;    // first tag pointing at this commit (if any)
  isHead: boolean;
}

interface GitFlowBranchSummary {
  name: string;
  shortHash: string | null;
  lastMessage: string | null;
  lastCommitRelTime: string | null;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
}

interface GitFlowData {
  commits: GitFlowCommit[]; // newest first
  branches: string[];       // unique branch names referenced
  branchSummaries: GitFlowBranchSummary[];
  head: string | null;      // hash of HEAD
  branch: string | null;    // current branch name
  remoteUrl: string | null;
  ahead: number | null;
  behind: number | null;
  summary: string;          // "{N} commits · {branch}"
}

function parseGitDecoration(decoration: string): { branches: string[]; tags: string[]; isHead: boolean } {
  // Decoration looks like: "HEAD -> main, origin/main, tag: v1.0, feature/foo"
  const out = { branches: [] as string[], tags: [] as string[], isHead: false };
  if (!decoration) return out;
  const parts = decoration.split(",").map((p) => p.trim()).filter((p) => p.length > 0);
  for (const part of parts) {
    if (part.startsWith("HEAD -> ")) {
      out.isHead = true;
      const ref = part.slice("HEAD -> ".length).trim();
      if (ref) out.branches.push(ref);
    } else if (part === "HEAD") {
      out.isHead = true;
    } else if (part.startsWith("tag: ")) {
      out.tags.push(part.slice("tag: ".length).trim());
    } else if (part.startsWith("origin/") || part.startsWith("upstream/") || part.includes("/HEAD")) {
      // skip remote refs
    } else {
      out.branches.push(part);
    }
  }
  return out;
}

function parseGitTrack(track: string): { ahead: number | null; behind: number | null } {
  if (!track) return { ahead: null, behind: null };
  const aheadMatch = track.match(/ahead\s+(\d+)/i);
  const behindMatch = track.match(/behind\s+(\d+)/i);
  return {
    ahead: aheadMatch ? Number.parseInt(aheadMatch[1] ?? "0", 10) || 0 : 0,
    behind: behindMatch ? Number.parseInt(behindMatch[1] ?? "0", 10) || 0 : 0,
  };
}

ipcMain.handle("workspace:gitFlow", async (_event, workspacePath: string): Promise<GitFlowData | null> => {
  if (!workspacePath || typeof workspacePath !== "string") return null;
  if (!workspacePath.startsWith("/") || workspacePath.length < 2) return null;
  if (!fs.existsSync(workspacePath)) return null;

  try {
    // Single git log call carries refs (%D) and parents (%P), so we only need
    // one extra call for current branch.
    const SEP = "\x1F";
    const FIELDS = ["%H", "%h", "%P", "%an", "%cr", "%s", "%D"].join(SEP);
    const branchSummaryFields = [
      "%(refname:short)",
      "%(objectname:short)",
      "%(contents:subject)",
      "%(committerdate:relative)",
      "%(upstream:short)",
      "%(upstream:track)",
    ].join(SEP);
    const [logResult, branchResult, branchSummaryResult, remoteResult] = await Promise.all([
      execFileAsync(
        "git",
        ["-C", workspacePath, "log", "--max-count=20", "--all", "--date-order", `--pretty=format:${FIELDS}`],
        { encoding: "utf8", timeout: 8000, maxBuffer: 1024 * 1024 }
      ),
      execFileAsync(
        "git",
        ["-C", workspacePath, "symbolic-ref", "--short", "HEAD"],
        { encoding: "utf8", timeout: 4000 }
      ).catch(() => ({ stdout: "" })),
      execFileAsync(
        "git",
        ["-C", workspacePath, "for-each-ref", "refs/heads", `--format=${branchSummaryFields}`],
        { encoding: "utf8", timeout: 8000, maxBuffer: 512 * 1024 }
      ).catch(() => ({ stdout: "" })),
      execFileAsync(
        "git",
        ["-C", workspacePath, "remote", "get-url", "origin"],
        { encoding: "utf8", timeout: 4000 }
      ).catch(() => ({ stdout: "" })),
    ]);

    const stdout = logResult.stdout.trim();
    if (!stdout) {
      // Repo with no commits.
      return null;
    }

    const currentBranch = branchResult.stdout.trim() || null;

    const commits: GitFlowCommit[] = [];
    const branchSet = new Set<string>();
    let headHash: string | null = null;

    for (const line of stdout.split("\n")) {
      const parts = line.split(SEP);
      if (parts.length < 6) continue;
      const fullHash = parts[0]?.trim() ?? "";
      const shortHash = parts[1]?.trim() ?? "";
      const parentStr = parts[2]?.trim() ?? "";
      const author = parts[3]?.trim() ?? "";
      const relTime = parts[4]?.trim() ?? "";
      const msg = parts[5] ?? "";
      const decoration = parts[6] ?? "";
      const parents = parentStr.length > 0 ? parentStr.split(/\s+/) : [];
      const dec = parseGitDecoration(decoration);
      const primaryBranch = dec.branches.length > 0 ? dec.branches[0] : null;
      const firstTag = dec.tags.length > 0 ? dec.tags[0] : null;
      if (primaryBranch) branchSet.add(primaryBranch);
      if (dec.isHead) headHash = fullHash;
      commits.push({
        id: fullHash,
        shortHash,
        parents,
        author,
        relTime,
        msg,
        branch: primaryBranch,
        tag: firstTag,
        isHead: dec.isHead,
      });
    }

    // Make sure current branch is in the set (even if no decoration was visible)
    if (currentBranch) branchSet.add(currentBranch);

    const branchSummaries: GitFlowBranchSummary[] = [];
    for (const line of branchSummaryResult.stdout.trim().split("\n")) {
      if (!line.trim()) continue;
      const parts = line.split(SEP);
      const name = parts[0]?.trim() ?? "";
      if (!name) continue;
      const track = parseGitTrack(parts[5]?.trim() ?? "");
      branchSummaries.push({
        name,
        shortHash: parts[1]?.trim() || null,
        lastMessage: parts[2]?.trim() || null,
        lastCommitRelTime: parts[3]?.trim() || null,
        upstream: parts[4]?.trim() || null,
        ahead: track.ahead,
        behind: track.behind,
      });
      branchSet.add(name);
    }

    const currentBranchSummary = branchSummaries.find((b) => b.name === currentBranch) ?? null;

    return {
      commits,
      branches: Array.from(branchSet),
      branchSummaries,
      head: headHash,
      branch: currentBranch,
      remoteUrl: remoteResult.stdout.trim() || null,
      ahead: currentBranchSummary?.ahead ?? null,
      behind: currentBranchSummary?.behind ?? null,
      summary: `${commits.length} commits${currentBranch ? ` · ${currentBranch}` : ""}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[workspace] gitFlow: failed at ${workspacePath}: ${msg}`);
    return null;
  }
});

// --- workspace:newProject IPC (Sprint 1: New Project Wizard) ---
// 신규 프로젝트 디렉토리 생성 + 옵션 적용 + workspaces.json 등록을 원자적으로 수행.
// 셸 인젝션 금지: git init은 spawn + 명시적 argv, 파일 쓰기는 fs/promises 사용.

interface NewProjectPayload {
  projectName: string;
  parentDir: string;
  options?: {
    tool?: "claude" | "codex";
    gitInit?: boolean;
    claudeMd?: boolean;
    progressMd?: boolean;
    agentMd?: boolean;
    handoffMd?: boolean;
    gitignoreNode?: boolean;
  };
  createParent?: boolean;
}

interface NewProjectResult {
  success: boolean;
  absolutePath?: string;
  workspaces?: typeof workspaces;
  error?: string;
  parentCreated?: boolean;
  // Non-fatal step failures (git init, file writes). Renderer surfaces these
  // to the user so partial-failure orphan dirs aren't silent.
  warnings?: string[];
}

ipcMain.handle("workspace:newProject", async (_event, payload: NewProjectPayload): Promise<NewProjectResult> => {
  const { projectName, parentDir, createParent } = payload;
  const options = payload.options ?? {};

  console.log(`[new-project] received: name="${projectName}" parent="${parentDir}" options=${JSON.stringify(options)}`);

  // 입력값 기본 검증
  if (!projectName || typeof projectName !== "string" || !parentDir || typeof parentDir !== "string") {
    return { success: false, error: "invalid_input" };
  }

  // ~ 확장
  const expandedParent = parentDir.startsWith("~/")
    ? path.join(os.homedir(), parentDir.slice(2))
    : parentDir.startsWith("~")
    ? os.homedir()
    : parentDir;

  const absolutePath = path.join(expandedParent, projectName);
  console.log(`[new-project] absolutePath="${absolutePath}"`);

  // AC #4: 이미 존재하는 경로 체크
  if (fs.existsSync(absolutePath)) {
    console.log(`[new-project] already_exists: ${absolutePath}`);
    return { success: false, error: "already_exists" };
  }

  // AC #5: 부모 디렉토리 존재 여부
  let parentCreated = false;
  if (!fs.existsSync(expandedParent)) {
    if (!createParent) {
      console.log(`[new-project] parent_missing: ${expandedParent}`);
      return { success: false, error: "parent_missing" };
    }
    // 재귀 생성 (mkdir -p 상당)
    try {
      fs.mkdirSync(expandedParent, { recursive: true });
      parentCreated = true;
      console.log(`[new-project] parent created: ${expandedParent}`);
    } catch (err) {
      console.error("[new-project] failed to create parent:", err);
      return { success: false, error: "parent_create_failed" };
    }
  }

  // AC #6: 프로젝트 디렉토리 생성
  try {
    fs.mkdirSync(absolutePath, { recursive: false });
    console.log(`[new-project] directory created: ${absolutePath}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[new-project] mkdir failed:", err);
    return { success: false, error: `mkdir_failed: ${msg}` };
  }

  // AC #6: 옵션별 파일/git 초기화
  const fsp = fs.promises;
  const warnings: string[] = [];
  const isToolPayload = options.tool === "claude" || options.tool === "codex";
  const selectedTool: "claude" | "codex" =
    options.tool === "codex" ? "codex" : "claude";
  const shouldCreateClaudeConfig = isToolPayload ? selectedTool === "claude" : options.claudeMd === true;
  const shouldCreateClaudeProgress = isToolPayload ? selectedTool === "claude" : options.progressMd === true;
  const shouldCreateCodexConfig = isToolPayload ? selectedTool === "codex" : options.agentMd === true;
  const shouldCreateCodexHandoff = isToolPayload ? selectedTool === "codex" : options.handoffMd === true;

  // git init (spawn + 명시적 argv — 셸 인젝션 없음)
  try {
    await execFileAsync("git", ["init", absolutePath]);
    console.log(`[new-project] git init OK: ${absolutePath}`);
  } catch (err) {
    console.warn("[new-project] git init failed (non-fatal):", err);
    warnings.push("git init failed; folder was created");
  }

  // CLAUDE.md 템플릿
  if (shouldCreateClaudeConfig) {
    const claudeContent = `# ${projectName}

## Objective
(Describe the goal of this project)

## Overview
(Brief technical overview)
`;
    try {
      await fsp.writeFile(path.join(absolutePath, "CLAUDE.md"), claudeContent, "utf8");
      console.log("[new-project] CLAUDE.md written");
    } catch (err) {
      console.warn("[new-project] CLAUDE.md write failed (non-fatal):", err);
      warnings.push("CLAUDE.md creation failed");
    }
  }

  // progress.md 템플릿 (startwork 형식 준수)
  if (shouldCreateClaudeProgress) {
    const today = new Date().toISOString().split("T")[0];
    const progressContent = `# Progress — ${projectName}

## Current Task
(What are you working on right now?)

## Next Steps
- (First next step)

## Blockers
(None)

## Last Updated
${today}
`;
    try {
      await fsp.writeFile(path.join(absolutePath, "progress.md"), progressContent, "utf8");
      console.log("[new-project] progress.md written");
    } catch (err) {
      console.warn("[new-project] progress.md write failed (non-fatal):", err);
      warnings.push("progress.md creation failed");
    }
  }

  if (shouldCreateCodexConfig) {
    const agentsContent = `# ${projectName}

## Objective
(Describe the goal of this project)

## Instructions
- Keep changes scoped.
- Verify with the relevant local checks before reporting completion.
`;
    try {
      await fsp.writeFile(path.join(absolutePath, "AGENTS.md"), agentsContent, "utf8");
      console.log("[new-project] AGENTS.md written");
    } catch (err) {
      console.warn("[new-project] AGENTS.md write failed (non-fatal):", err);
      warnings.push("AGENTS.md creation failed");
    }
  }

  if (shouldCreateCodexHandoff) {
    const today = new Date().toISOString().split("T")[0];
    const handoffContent = `# Handoff — ${projectName}

## Goal
(What should Codex help complete?)

## Current
(Current state)

## Next
- (First next step)

## Git Flow
- Branch: main
- Last checked: ${today}
`;
    try {
      await fsp.writeFile(path.join(absolutePath, "codex-handoff.md"), handoffContent, "utf8");
      console.log("[new-project] codex-handoff.md written");
    } catch (err) {
      console.warn("[new-project] codex-handoff.md write failed (non-fatal):", err);
      warnings.push("codex-handoff.md creation failed");
    }
  }

  // .gitignore Node 템플릿 (AC #6: node_modules, dist, .env, .DS_Store 포함)
  if (options.gitignoreNode) {
    const gitignoreContent = `node_modules/
dist/
.env
.DS_Store
*.log
.cache/
coverage/
`;
    try {
      await fsp.writeFile(path.join(absolutePath, ".gitignore"), gitignoreContent, "utf8");
      console.log("[new-project] .gitignore written");
    } catch (err) {
      console.warn("[new-project] .gitignore write failed (non-fatal):", err);
      warnings.push(".gitignore creation failed");
    }
  }

  // AC #7: workspaces.json 즉시 등록
  const addResult = addWorkspace(workspaces, absolutePath);
  workspaces = addResult.workspaces;
  console.log(`[new-project] workspace registered: id lookup from updated list`);

  return {
    success: true,
    absolutePath,
    workspaces,
    parentCreated,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
});

// --- Settings IPC ---

ipcMain.handle("settings:get", () => appSettings);
ipcMain.handle("settings:save", (_event, settings: Partial<AppSettings>) => {
  appSettings = { ...appSettings, ...settings };
  persistSettings();
  return true;
});

// --- Sprint 3 (Codex usage): codex:fetchUsage IPC ---
// Codex CLI does not expose a usage/quota subcommand (verified via `codex --help`).
// Returns { available: false } as placeholder — renderer shows "codex usage unavailable".
// SECURITY: no user input — argv is a hardcoded literal. Wrapped in try/catch so
// any future codex version that does expose usage won't crash the main process.
ipcMain.handle("codex:fetchUsage", async () => {
  console.log("[codex:fetchUsage] codex usage subcommand not supported — returning placeholder");
  return { available: false };
});

// --- Hook IPC ---

ipcMain.handle("hook:checkInstalled", () => isHookInstalled());
ipcMain.handle("hook:install", () => installClaudeHooks());

// --- Subagent Watcher IPC (Sprint 2) ---

ipcMain.handle("subagent:snapshot", () => getSubagentSnapshot());

// --- macOS Notification for waiting_approval ---

ipcMain.on("hook:notify-approval", () => {
  if (!appSettings.claudeNotifications) return;
  if (Notification.isSupported()) {
    new Notification({
      title: "HyperTerm",
      body: "Claude is waiting for approval",
    }).show();
  }
});

// --- App Lifecycle ---

function createMenu(): void {
  const template: (Electron.MenuItemConstructorOptions | MenuItem)[] = [
    {
      label: "HyperT",
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { role: "close" },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "User Guide",
          click: () => {
            mainWindow?.webContents.send("help:show-guide");
          },
        },
        { type: "separator" },
        {
          label: "About",
          click: () => {
            mainWindow?.webContents.send("help:show-about");
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  loadSettings();
  // Initialize workspaces persistence
  initWorkspaces(app.getPath("userData"));
  workspaces = loadWorkspaces();
  initWorkflows(app.getPath("userData"));
  workflows = loadWorkflows();
  hookServer = startHookServer();
  // Always re-install hooks: ensures hook.sh is refreshed to the latest template
  // even when settings.json already lists it. isHookInstalled() only checks
  // settings.json registration, not hook.sh content.
  installClaudeHooks();
  installSubagentHooks();
  // Start subagent file watcher (Sprint 2)
  startSubagentWatcher(() => mainWindow);
  // Terminal window: restores sessions.json groups (cwd + label only).
  createWindow();
  createMenu();
  // Dashboard-first launch: open dashboard after terminal window so it appears
  // on top and gets focus. Terminal window restores previous sessions in the
  // background. Dashboard is always shown at startup (AC #1, #5).
  openDashboardWindow();
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    isQuitting = false;
    createWindow();
  }
});
