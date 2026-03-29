import { contextBridge, ipcRenderer, clipboard } from "electron";

export interface SshProfile {
  id: string;
  name: string;
  host: string;
  user: string;
  port: number;
  keyFile?: string;
}

export interface TerminalAPI {
  createPty(
    cols: number,
    rows: number,
    cwd?: string,
    tmuxSession?: string
  ): Promise<{ id: number; tmuxName: string }>;
  writePty(id: number, data: string): void;
  resizePty(id: number, cols: number, rows: number): void;
  destroyPty(id: number): void;
  onPtyData(callback: (id: number, data: string) => void): void;
  onPtyExit(callback: (id: number, exitCode: number) => void): void;
  getCwd(id: number): Promise<string>;
  isTmuxAvailable(): Promise<boolean>;
  listTmuxSessions(): Promise<string[]>;
  saveSessions(data: string): Promise<boolean>;
  loadSessions(): Promise<string | null>;
  loadNotes(tmuxName: string): Promise<any[]>;
  saveNotes(tmuxName: string, notes: any[]): Promise<void>;
  deleteSessionNotes(tmuxName: string): Promise<void>;
  onBeforeQuit(callback: () => void): void;
  quitReady(): void;
  copyToClipboard(text: string): void;
  readFromClipboard(): string;
  listPanes(tmuxName: string): Promise<PaneInfo[]>;
  selectPane(tmuxName: string, paneId: string): Promise<void>;
  splitPane(tmuxName: string, direction: "horizontal" | "vertical"): Promise<void>;
  closePane(tmuxName: string): Promise<void>;
  navigatePane(tmuxName: string, direction: "U" | "D" | "L" | "R"): Promise<void>;
  scrollTmux(tmuxName: string, direction: "up" | "down", lines: number): void;
  exitCopyMode(tmuxName: string): void;
  sendTmuxKey(tmuxName: string, key: string): void;
  renameTmuxSession(oldName: string, newName: string): Promise<string>;
  getTmuxSessionName(tmuxName: string): Promise<string>;
  getPaneCommand(tmuxName: string): Promise<string>;
  getProcessInfo(tmuxName: string): Promise<{ cpu: number; memory: number }>;
  fetchUsage(): Promise<{ data?: any; error?: string }>;
  listSshProfiles(): Promise<SshProfile[]>;
  saveSshProfile(profile: SshProfile): Promise<boolean>;
  deleteSshProfile(id: string): Promise<boolean>;
  getSshCommand(profile: SshProfile): Promise<string>;
}

contextBridge.exposeInMainWorld("terminalAPI", {
  createPty: (
    cols: number,
    rows: number,
    cwd?: string,
    tmuxSession?: string
  ): Promise<{ id: number; tmuxName: string }> => {
    return ipcRenderer.invoke("pty:create", cols, rows, cwd, tmuxSession);
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
  isTmuxAvailable: (): Promise<boolean> => {
    return ipcRenderer.invoke("tmux:check");
  },
  listTmuxSessions: (): Promise<string[]> => {
    return ipcRenderer.invoke("tmux:list");
  },
  saveSessions: (data: string): Promise<boolean> => {
    return ipcRenderer.invoke("session:save", data);
  },
  loadSessions: (): Promise<string | null> => {
    return ipcRenderer.invoke("session:load");
  },
  loadNotes: (tmuxName: string): Promise<any[]> => {
    return ipcRenderer.invoke("notes:load", tmuxName);
  },
  saveNotes: (tmuxName: string, notes: any[]): Promise<void> => {
    return ipcRenderer.invoke("notes:save", tmuxName, notes);
  },
  deleteSessionNotes: (tmuxName: string): Promise<void> => {
    return ipcRenderer.invoke("notes:deleteSession", tmuxName);
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
  listPanes: (tmuxName: string): Promise<PaneInfo[]> => {
    return ipcRenderer.invoke("tmux:listPanes", tmuxName);
  },
  selectPane: (tmuxName: string, paneId: string): Promise<void> => {
    return ipcRenderer.invoke("tmux:selectPane", tmuxName, paneId);
  },
  splitPane: (tmuxName: string, direction: "horizontal" | "vertical"): Promise<void> => {
    return ipcRenderer.invoke("tmux:splitPane", tmuxName, direction);
  },
  closePane: (tmuxName: string): Promise<void> => {
    return ipcRenderer.invoke("tmux:closePane", tmuxName);
  },
  navigatePane: (tmuxName: string, direction: "U" | "D" | "L" | "R"): Promise<void> => {
    return ipcRenderer.invoke("tmux:navigatePane", tmuxName, direction);
  },
  scrollTmux: (tmuxName: string, direction: "up" | "down", lines: number): void => {
    ipcRenderer.send("tmux:scroll", tmuxName, direction, lines);
  },
  exitCopyMode: (tmuxName: string): void => {
    ipcRenderer.send("tmux:exitCopyMode", tmuxName);
  },
  sendTmuxKey: (tmuxName: string, key: string): void => {
    ipcRenderer.send("tmux:sendKey", tmuxName, key);
  },
  renameTmuxSession: (oldName: string, newName: string): Promise<string> => {
    return ipcRenderer.invoke("tmux:renameSession", oldName, newName);
  },
  getTmuxSessionName: (tmuxName: string): Promise<string> => {
    return ipcRenderer.invoke("tmux:getSessionName", tmuxName);
  },
  getPaneCommand: (tmuxName: string): Promise<string> => {
    return ipcRenderer.invoke("tmux:getPaneCommand", tmuxName);
  },
  getProcessInfo: (tmuxName: string): Promise<{ cpu: number; memory: number }> => {
    return ipcRenderer.invoke("tmux:getProcessInfo", tmuxName);
  },
  listSshProfiles: (): Promise<SshProfile[]> => {
    return ipcRenderer.invoke("ssh:listProfiles");
  },
  saveSshProfile: (profile: SshProfile): Promise<boolean> => {
    return ipcRenderer.invoke("ssh:saveProfile", profile);
  },
  deleteSshProfile: (id: string): Promise<boolean> => {
    return ipcRenderer.invoke("ssh:deleteProfile", id);
  },
  getSshCommand: (profile: SshProfile): Promise<string> => {
    return ipcRenderer.invoke("ssh:getSshCommand", profile);
  },
  fetchUsage: (): Promise<{ data?: any; error?: string }> => {
    return ipcRenderer.invoke("usage:fetch");
  },
} satisfies TerminalAPI);
