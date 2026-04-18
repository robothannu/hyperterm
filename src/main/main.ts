import { app, BrowserWindow, ipcMain, Menu, MenuItem, shell, Notification } from "electron";
import * as path from "path";
import * as fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import * as net from "net";
import * as os from "os";

const execFileAsync = promisify(execFile);
import * as https from "https";
import * as PtyManager from "./pty-manager";

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
let isQuitting = false;
let forceQuitTimer: NodeJS.Timeout | null = null;
let hookServer: net.Server | null = null;

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
      buf = lines.pop()!;
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
PAYLOAD=$(cat)
SOCK="$HOME/Library/Application Support/HyperTerm/agent.sock"
EVENT_TYPE="\${CLAUDE_HOOK_EVENT:-unknown}"
SESSION_ID="\${CLAUDE_SESSION_ID:-}"
TOOL_NAME="\${CLAUDE_TOOL_NAME:-}"
# Extract top-level message field from payload (Notification events)
MESSAGE=$(echo "$PAYLOAD" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('message',''))" 2>/dev/null || true)
# Escape double quotes in message for JSON embedding
MESSAGE_ESCAPED=$(echo "$MESSAGE" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
# Build JSON, truncate payload to 4096 bytes
PAYLOAD_TRIMMED=$(echo "$PAYLOAD" | head -c 4096)
printf '%s\\n' "{\\"event\\":\\"$EVENT_TYPE\\",\\"session_id\\":\\"$SESSION_ID\\",\\"tool_name\\":\\"$TOOL_NAME\\",\\"message\\":\\"$MESSAGE_ESCAPED\\",\\"payload\\":$PAYLOAD_TRIMMED}" | \\
  socat - "UNIX-CONNECT:$SOCK" 2>/dev/null || true
`;
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
    for (const event of ["PreToolUse", "PostToolUse", "Notification", "Stop"]) {
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
    for (const event of ["PreToolUse", "PostToolUse", "Notification", "Stop"]) {
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

// --- IPC Handlers ---

ipcMain.handle(
  "pty:create",
  (_event, cols: number, rows: number, cwd?: string) => {
    // Validate cols/rows to prevent NaN or out-of-bounds values reaching node-pty
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1 || cols > 10000 || rows > 10000) {
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
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1 || cols > 10000 || rows > 10000) {
    return;
  }
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

function fetchUsageFromAPI(token: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      "https://api.anthropic.com/api/oauth/usage",
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "anthropic-beta": "oauth-2025-04-20",
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => (body += chunk.toString()));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error("parse"));
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error("timeout"));
    });
  });
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
}

ipcMain.handle("git:status", async (_event, projectRoot: string): Promise<GitStatus | null> => {
  if (!projectRoot || typeof projectRoot !== "string") return null;
  try {
    const [branchResult, statusResult] = await Promise.all([
      execFileAsync("git", ["-C", projectRoot, "branch", "--show-current"], {
        encoding: "utf8",
        timeout: 5000,
      }),
      execFileAsync("git", ["-C", projectRoot, "status", "--porcelain"], {
        encoding: "utf8",
        timeout: 5000,
      }),
    ]);

    const branch = branchResult.stdout.trim() || "HEAD";
    const lines = statusResult.stdout.split("\n").filter((l) => l.length > 0);

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
  if (mainWindow) {
    mainWindow.destroy();
  }
  app.quit();
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
  hookServer = startHookServer();
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
