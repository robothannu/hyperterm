import { app, BrowserWindow, ipcMain, Menu, MenuItem, shell } from "electron";
import * as path from "path";
import * as fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";

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

const sessionsFilePath = path.join(app.getPath("userData"), "sessions.json");
const notesFilePath = path.join(app.getPath("userData"), "notes.json");

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

// --- Process info IPC (pty ID based) ---

ipcMain.handle("pty:getProcessInfo", async (_event, id: number) => {
  return await PtyManager.getProcessInfo(id);
});

// Renderer signals that session metadata has been saved — safe to quit
ipcMain.on("app:quit-ready", () => {
  if (forceQuitTimer !== null) {
    clearTimeout(forceQuitTimer);
    forceQuitTimer = null;
  }
  PtyManager.destroyAll(); // kill all pty processes
  if (mainWindow) {
    mainWindow.destroy();
  }
  app.quit();
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
