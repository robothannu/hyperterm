import { app, BrowserWindow, ipcMain, Menu, MenuItem, shell, Notification, dialog } from "electron";
import * as path from "path";
import * as fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import * as net from "net";
import * as os from "os";

const execFileAsync = promisify(execFile);
import * as PtyManager from "./pty-manager";
import { installSubagentHooks } from "./subagent-hook-installer";
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
  type Workspace,
} from "./workspaces";
import { getCardData, summarizeOverview, getStatusInfo, getFileTree } from "./workspace-reader";

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

const sessionsFilePath = path.join(app.getPath("userData"), "sessions.json");
const notesFilePath = path.join(app.getPath("userData"), "notes.json");
const settingsFilePath = path.join(app.getPath("userData"), "settings.json");

// --- App Settings ---

interface AppSettings {
  claudeNotifications: boolean;
  fontSize?: number;
  theme?: "dark" | "light";
  recentProjects?: string[];
}

let appSettings: AppSettings = { claudeNotifications: true };

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
    width: 800,
    height: 560,
    minWidth: 480,
    minHeight: 360,
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

ipcMain.on("pty:write", (_event, id: number, data: string) => {
  PtyManager.writeToSession(id, data);
});

ipcMain.on("pty:resize", (_event, id: number, cols: number, rows: number) => {
  if (!isValidDimension(cols, rows)) return;
  PtyManager.resizeSession(id, cols, rows);
});

ipcMain.on("pty:destroy", (_event, id: number) => {
  PtyManager.destroySession(id);
});

ipcMain.handle("pty:getCwd", (_event, id: number) => {
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

// Renderer signals that session metadata has been saved — safe to quit
ipcMain.on("app:quit-ready", () => {
  if (forceQuitTimer !== null) {
    clearTimeout(forceQuitTimer);
    forceQuitTimer = null;
  }
  PtyManager.destroyAll(); // kill all pty processes
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
  return workspaces;
});

ipcMain.handle("workspace:add", async () => {
  const result = await dialog.showOpenDialog(
    dashboardWindow ?? mainWindow!,
    {
      title: "Select Workspace Folder",
      properties: ["openDirectory", "createDirectory"],
    }
  );

  if (result.canceled || result.filePaths.length === 0) {
    console.log("[workspace] add: dialog cancelled");
    return { workspaces, duplicate: false, cancelled: true };
  }

  const chosen = result.filePaths[0];
  const addResult = addWorkspace(workspaces, chosen);
  workspaces = addResult.workspaces;

  return {
    workspaces,
    duplicate: addResult.duplicate,
    cancelled: false,
  };
});

ipcMain.handle("workspace:remove", (_event, id: string) => {
  workspaces = removeWorkspace(workspaces, id);
  return workspaces;
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

// --- Session State IPC (Sprint 5: badges) ---
// Returns { open: boolean, harnessPhase: string | null } for a given workspace path.
// - open: true if sessions.json has any tab leaf with cwd matching workspacePath
// - harnessPhase: current_phase from .claude/harness/state.json (null if idle/complete/missing)

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
      if (node.type === "leaf" && typeof node.cwd === "string") {
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
    if (!phase || phase === "idle" || phase === "complete") return null;
    return phase;
  } catch (err) {
    console.warn(`[dashboard] getHarnessPhase: failed to parse state.json for ${workspacePath}:`, err);
    return null;
  }
}

ipcMain.handle("workspace:sessionState", (_event, workspacePath: string) => {
  if (!workspacePath || typeof workspacePath !== "string") {
    return { open: false, harnessPhase: null };
  }
  const normalized = path.resolve(workspacePath);
  let open = false;
  try {
    const openCwds = getOpenCwds();
    open = openCwds.has(normalized);
  } catch (err) {
    console.warn(`[dashboard] session-state: open check failed for ${normalized}:`, err);
  }
  const harnessPhase = getHarnessPhase(normalized);
  console.log(`[dashboard] session-state ws=${normalized} open=${open} harness=${harnessPhase ?? "null"}`);
  return { open, harnessPhase };
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

// --- Settings IPC ---

ipcMain.handle("settings:get", () => appSettings);
ipcMain.handle("settings:save", (_event, settings: Partial<AppSettings>) => {
  appSettings = { ...appSettings, ...settings };
  persistSettings();
  return true;
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
      body: "Claude가 승인을 기다리고 있습니다",
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
  hookServer = startHookServer();
  // Always re-install hooks: ensures hook.sh is refreshed to the latest template
  // even when settings.json already lists it. isHookInstalled() only checks
  // settings.json registration, not hook.sh content.
  installClaudeHooks();
  installSubagentHooks();
  // Start subagent file watcher (Sprint 2)
  startSubagentWatcher(() => mainWindow);
  createWindow();
  createMenu();
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
