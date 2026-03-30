interface UsageMetric {
  utilization: number;
  resets_at: string | null;
}

interface UsageData {
  five_hour: UsageMetric;
  seven_day: UsageMetric;
  seven_day_opus: UsageMetric;
}

interface UsageResult {
  data?: UsageData;
  error?: "keychain" | "api" | "parse";
}

interface PaneInfo {
  paneId: string;
  left: number;
  top: number;
  width: number;
  height: number;
  active: boolean;
}

interface TerminalAPI {
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
  sendTextToTmux(tmuxName: string, text: string): void;
  startTmuxSearch(tmuxName: string): void;
  renameTmuxSession(oldName: string, newName: string): Promise<string>;
  getTmuxSessionName(tmuxName: string): Promise<string>;
  getPaneCommand(tmuxName: string): Promise<string>;
  getProcessInfo(tmuxName: string): Promise<{ cpu: number; memory: number }>;
  fetchUsage(): Promise<UsageResult>;
  listSshProfiles(): Promise<SshProfile[]>;
  saveSshProfile(profile: SshProfile): Promise<boolean>;
  deleteSshProfile(id: string): Promise<boolean>;
  getSshCommand(profile: SshProfile): Promise<string>;
}

interface SshProfile {
  id: string;
  name: string;
  host: string;
  user: string;
  port: number;
  keyFile?: string;
}

interface Window {
  terminalAPI: TerminalAPI;
}
