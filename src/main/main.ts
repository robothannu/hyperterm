import { app, BrowserWindow, ipcMain } from "electron";
import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process";
import * as https from "https";
import * as PtyManager from "./pty-manager";

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

const sessionsFilePath = path.join(app.getPath("userData"), "sessions.json");
const notesFilePath = path.join(app.getPath("userData"), "notes.json");
const sshProfilesFilePath = path.join(app.getPath("userData"), "ssh-profiles.json");

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
      sandbox: false,
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

  // Intercept close to save session metadata first, then detach (keep tmux alive)
  mainWindow.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      isQuitting = true;
      mainWindow?.webContents.send("app:before-quit");

      // Force-quit if renderer never responds with app:quit-ready
      setTimeout(() => {
        console.warn("[main] Renderer did not respond to app:before-quit in time, force-quitting.");
        PtyManager.detachAll();
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
  (_event, cols: number, rows: number, cwd?: string, tmuxSession?: string) => {
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
      tmuxSession
    );
    return result; // { id, tmuxName }
  }
);

ipcMain.on("pty:write", (_event, id: number, data: string) => {
  PtyManager.writeToSession(id, data);
});

ipcMain.on("pty:resize", (_event, id: number, cols: number, rows: number) => {
  PtyManager.resizeSession(id, cols, rows);
});

ipcMain.on("pty:destroy", (_event, id: number) => {
  PtyManager.destroySession(id);
});

ipcMain.handle("pty:getCwd", (_event, id: number) => {
  return PtyManager.getSessionCwd(id);
});

// --- tmux IPC ---

ipcMain.handle("tmux:check", () => {
  return PtyManager.isTmuxAvailable();
});

ipcMain.handle("tmux:list", () => {
  return PtyManager.listTmuxSessions();
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

function readNotes(): Record<string, any[]> {
  try {
    if (fs.existsSync(notesFilePath)) {
      return JSON.parse(fs.readFileSync(notesFilePath, "utf8"));
    }
  } catch {
    // ignore
  }
  return {};
}

function writeNotes(data: Record<string, any[]>): void {
  try {
    fs.writeFileSync(notesFilePath, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.error("[main] Failed to write notes:", err);
  }
}

ipcMain.handle("notes:load", (_event, tmuxName: string) => {
  const all = readNotes();
  return all[tmuxName] || [];
});

ipcMain.handle("notes:save", (_event, tmuxName: string, notes: any[]) => {
  const all = readNotes();
  if (notes.length === 0) {
    delete all[tmuxName];
  } else {
    all[tmuxName] = notes;
  }
  writeNotes(all);
});

ipcMain.handle("notes:deleteSession", (_event, tmuxName: string) => {
  const all = readNotes();
  delete all[tmuxName];
  writeNotes(all);
});

// --- SSH Profiles IPC ---

interface SshProfile {
  id: string;
  name: string;
  host: string;
  user: string;
  port: number;
  keyFile?: string;
}

function readSshProfiles(): SshProfile[] {
  try {
    if (fs.existsSync(sshProfilesFilePath)) {
      return JSON.parse(fs.readFileSync(sshProfilesFilePath, "utf8"));
    }
  } catch { /* ignore */ }
  return [];
}

function writeSshProfiles(profiles: SshProfile[]): void {
  fs.writeFileSync(sshProfilesFilePath, JSON.stringify(profiles, null, 2), "utf8");
}

ipcMain.handle("ssh:listProfiles", () => {
  return readSshProfiles();
});

ipcMain.handle("ssh:saveProfile", (_event, profile: SshProfile) => {
  const profiles = readSshProfiles();
  const idx = profiles.findIndex(p => p.id === profile.id);
  if (idx >= 0) {
    profiles[idx] = profile;
  } else {
    profiles.push(profile);
  }
  writeSshProfiles(profiles);
  return true;
});

ipcMain.handle("ssh:deleteProfile", (_event, id: string) => {
  const profiles = readSshProfiles().filter(p => p.id !== id);
  writeSshProfiles(profiles);
  return true;
});

ipcMain.handle("ssh:getSshCommand", (_event, profile: SshProfile) => {
  const keyFlag = profile.keyFile ? ` -i "${profile.keyFile}"` : "";
  return `ssh${keyFlag} ${profile.user}@${profile.host} -p ${profile.port}`;
});

// --- Usage IPC ---

function getOAuthToken(): string | null {
  try {
    const raw = execSync(
      'security find-generic-password -s "Claude Code-credentials" -w',
      { encoding: "utf8", timeout: 5000 }
    ).trim();
    const parsed = JSON.parse(raw);
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
  const token = getOAuthToken();
  if (!token) {
    return { error: "keychain" };
  }
  try {
    const data = await fetchUsageFromAPI(token);
    return { data };
  } catch (err: any) {
    console.error("[main] Usage fetch failed:", err?.message || err);
    return { error: err?.message === "parse" ? "parse" : "api" };
  }
});

// --- Pane IPC ---

ipcMain.handle("tmux:listPanes", (_event, tmuxName: string) => {
  return PtyManager.listPanes(tmuxName);
});

ipcMain.handle("tmux:selectPane", (_event, tmuxName: string, paneId: string) => {
  return PtyManager.selectPane(tmuxName, paneId);
});

ipcMain.handle("tmux:splitPane", (_event, tmuxName: string, direction: string) => {
  return PtyManager.splitPane(tmuxName, direction as "horizontal" | "vertical");
});

ipcMain.handle("tmux:closePane", (_event, tmuxName: string) => {
  return PtyManager.closePane(tmuxName);
});

ipcMain.handle("tmux:navigatePane", (_event, tmuxName: string, direction: string) => {
  return PtyManager.navigatePane(tmuxName, direction as "U" | "D" | "L" | "R");
});

ipcMain.on("tmux:scroll", (_event, tmuxName: string, direction: string, lines: number) => {
  PtyManager.scrollSession(tmuxName, direction as "up" | "down", lines);
});

ipcMain.on("tmux:exitCopyMode", (_event, tmuxName: string) => {
  PtyManager.exitCopyMode(tmuxName);
});

ipcMain.on("tmux:sendKey", (_event, tmuxName: string, key: string) => {
  PtyManager.sendTmuxKey(tmuxName, key);
});

ipcMain.on("tmux:sendText", (_event, tmuxName: string, text: string) => {
  PtyManager.sendTextToTmux(tmuxName, text);
});

ipcMain.on("tmux:startSearch", (_event, tmuxName: string) => {
  PtyManager.startTmuxSearch(tmuxName);
});

ipcMain.handle("tmux:renameSession", (_event, oldName: string, newName: string) => {
  return PtyManager.renameTmuxSession(oldName, newName);
});

ipcMain.handle("tmux:getSessionName", (_event, tmuxName: string) => {
  return PtyManager.getTmuxSessionName(tmuxName);
});

ipcMain.handle("tmux:getPaneCommand", (_event, tmuxName: string) => {
  return PtyManager.getTmuxPaneCurrentCommand(tmuxName);
});

ipcMain.handle("tmux:getProcessInfo", (_event, tmuxName: string) => {
  const pid = PtyManager.getTmuxPanePid(tmuxName);
  return PtyManager.getProcessInfo(pid);
});

// Renderer signals that session metadata has been saved — safe to quit
ipcMain.on("app:quit-ready", () => {
  PtyManager.detachAll(); // keep tmux sessions alive
  if (mainWindow) {
    mainWindow.destroy();
  }
  app.quit();
});

// --- App Lifecycle ---

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    isQuitting = false;
    createWindow();
  }
});
