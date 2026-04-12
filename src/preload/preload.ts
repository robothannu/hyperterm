import { contextBridge, ipcRenderer, clipboard } from "electron";

interface Note {
  id: number;
  content: string;
  createdAt: string;
}

interface UsageData {
  five_hour: { utilization: number; resets_at: string | null };
  seven_day: { utilization: number; resets_at: string | null };
  seven_day_opus: { utilization: number; resets_at: string | null };
}

interface UsageResult {
  data?: UsageData;
  error?: "keychain" | "api" | "parse";
}

export interface TerminalAPI {
  createPty(
    cols: number,
    rows: number,
    cwd?: string
  ): Promise<{ id: number; sessionKey: string }>;
  writePty(id: number, data: string): void;
  resizePty(id: number, cols: number, rows: number): void;
  destroyPty(id: number): void;
  onPtyData(callback: (id: number, data: string) => void): void;
  onPtyExit(callback: (id: number, exitCode: number) => void): void;
  getCwd(id: number): Promise<string>;
  saveSessions(data: string): Promise<boolean>;
  loadSessions(): Promise<string | null>;
  loadNotes(sessionKey: string): Promise<Note[]>;
  saveNotes(sessionKey: string, notes: Note[]): Promise<void>;
  deleteSessionNotes(sessionKey: string): Promise<void>;
  onBeforeQuit(callback: () => void): void;
  quitReady(): void;
  copyToClipboard(text: string): void;
  readFromClipboard(): string;
  getProcessInfo(id: number): Promise<{ cpu: number; memory: number }>;
  fetchUsage(): Promise<UsageResult>;
  onHelpGuide(callback: () => void): void;
  onHelpAbout(callback: () => void): void;
}

contextBridge.exposeInMainWorld("terminalAPI", {
  createPty: (
    cols: number,
    rows: number,
    cwd?: string
  ): Promise<{ id: number; sessionKey: string }> => {
    return ipcRenderer.invoke("pty:create", cols, rows, cwd);
  },
  writePty: (id: number, data: string): void => {
    ipcRenderer.send("pty:write", id, data);
  },
  resizePty: (id: number, cols: number, rows: number): void => {
    ipcRenderer.send("pty:resize", id, cols, rows);
  },
  destroyPty: (id: number): void => {
    ipcRenderer.send("pty:destroy", id);
  },
  onPtyData: (callback: (id: number, data: string) => void): void => {
    ipcRenderer.removeAllListeners("pty:data");
    ipcRenderer.on("pty:data", (_event, id, data) => callback(id, data));
  },
  onPtyExit: (callback: (id: number, exitCode: number) => void): void => {
    ipcRenderer.removeAllListeners("pty:exit");
    ipcRenderer.on("pty:exit", (_event, id, exitCode) => callback(id, exitCode));
  },
  getCwd: (id: number): Promise<string> => {
    return ipcRenderer.invoke("pty:getCwd", id);
  },
  saveSessions: (data: string): Promise<boolean> => {
    return ipcRenderer.invoke("session:save", data);
  },
  loadSessions: (): Promise<string | null> => {
    return ipcRenderer.invoke("session:load");
  },
  loadNotes: (sessionKey: string): Promise<Note[]> => {
    return ipcRenderer.invoke("notes:load", sessionKey);
  },
  saveNotes: (sessionKey: string, notes: Note[]): Promise<void> => {
    return ipcRenderer.invoke("notes:save", sessionKey, notes);
  },
  deleteSessionNotes: (sessionKey: string): Promise<void> => {
    return ipcRenderer.invoke("notes:deleteSession", sessionKey);
  },
  onBeforeQuit: (callback: () => void): void => {
    ipcRenderer.removeAllListeners("app:before-quit");
    ipcRenderer.on("app:before-quit", () => callback());
  },
  quitReady: (): void => {
    ipcRenderer.send("app:quit-ready");
  },
  copyToClipboard: (text: string): void => {
    clipboard.writeText(text);
  },
  readFromClipboard: (): string => {
    return clipboard.readText();
  },
  getProcessInfo: (id: number): Promise<{ cpu: number; memory: number }> => {
    return ipcRenderer.invoke("pty:getProcessInfo", id);
  },
  fetchUsage: (): Promise<UsageResult> => {
    return ipcRenderer.invoke("usage:fetch");
  },
  onHelpGuide: (callback: () => void): void => {
    ipcRenderer.removeAllListeners("help:show-guide");
    ipcRenderer.on("help:show-guide", () => callback());
  },
  onHelpAbout: (callback: () => void): void => {
    ipcRenderer.removeAllListeners("help:show-about");
    ipcRenderer.on("help:show-about", () => callback());
  },
} satisfies TerminalAPI);
