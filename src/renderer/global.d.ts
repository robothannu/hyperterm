interface Note {
  id: number;
  content: string;
  createdAt: string;
}

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

interface TerminalAPI {
  // --- Core pty API ---
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

  // --- Session persistence ---
  saveSessions(data: string): Promise<boolean>;
  loadSessions(): Promise<string | null>;

  // --- Notes (sessionKey-based, accepts any string key) ---
  loadNotes(sessionKey: string): Promise<Note[]>;
  saveNotes(sessionKey: string, notes: Note[]): Promise<void>;
  deleteSessionNotes(sessionKey: string): Promise<void>;

  // --- App lifecycle ---
  onBeforeQuit(callback: () => void): void;
  quitReady(): void;

  // --- Clipboard ---
  copyToClipboard(text: string): void;
  readFromClipboard(): string;

  // --- Process info (pty ID based) ---
  getProcessInfo(id: number): Promise<{ cpu: number; memory: number }>;

  // --- Usage ---
  fetchUsage(): Promise<UsageResult>;

  // --- Help ---
  onHelpGuide(callback: () => void): void;
  onHelpAbout(callback: () => void): void;

}

interface Window {
  terminalAPI: TerminalAPI;
}
