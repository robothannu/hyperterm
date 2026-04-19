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

interface HookEvent {
  event: string;
  session_id?: string;
  tool_name?: string;
  message?: string;
  payload?: unknown;
}

interface AppSettings {
  claudeNotifications: boolean;
  fontSize?: number;
  theme?: "dark" | "light";
  recentProjects?: string[];
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
  getAgentStatus(id: number): Promise<{ isClaudeRunning: boolean; claudePid: number | null }>;

  // --- Usage ---
  fetchUsage(): Promise<UsageResult>;

  // --- Help ---
  onHelpGuide(callback: () => void): void;
  onHelpAbout(callback: () => void): void;

  // --- Git ---
  gitFindRoot(dir: string): Promise<string | null>;
  gitStatus(projectRoot: string): Promise<{
    branch: string;
    dirty: boolean;
    stagedCount: number;
    unstagedCount: number;
    untrackedCount: number;
    aheadCount: number;
  } | null>;
  gitFiles(projectRoot: string): Promise<{ path: string; x: string; y: string }[]>;
  gitDiff(
    projectRoot: string,
    filePath: string,
    staged: boolean
  ): Promise<{ diff: string } | { tooLarge: true; lineCount: number } | { error: string }>;

  // --- Hook / Agent State ---
  onHookEvent(callback: (evt: HookEvent) => void): void;
  hookCheckInstalled(): Promise<boolean>;
  hookInstall(): Promise<boolean>;
  notifyApproval(): void;

  // --- Settings ---
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: Partial<AppSettings>): Promise<boolean>;

  // --- Path existence ---
  checkPathExists(dirPath: string): Promise<boolean>;
}

interface Window {
  terminalAPI: TerminalAPI;
}

// Cross-module teardown helpers (defined in their respective modules,
// called from renderer.ts _teardownAll during beforeunload / onBeforeQuit)
declare function teardownKeybindings(): void;
declare function teardownSidebarDelegation(): void;
declare function stopGitPolling(): void;

// Sidebar dot state (sidebar.ts → hook-state.ts, agent-status.ts)
declare function setSidebarDotState(tabId: number, state: "idle" | "running" | "waiting" | "done"): void;
declare function applySidebarDotState(dotEl: HTMLElement): void;
declare function updateSidebarCountPill(tabId: number): void;

// Pane header branch update (renderer.ts → git-status.ts)
declare function updatePaneHeadersFromGitCache(tabId: number): void;

// Cross-module function: git-status.ts — on-demand poll when switching tabs
declare function pollGitOnTabSwitch(tabId: number): void;

// Cross-module shared state: renderer.ts — current active font/theme for new sessions
declare var activeSessionSettings: { fontSize: number; theme: "dark" | "light" };

// Toast helper defined in renderer.ts, available to all modules loaded after it
declare function showToast(message: string, variant?: "error" | "warn" | "ok" | "done"): void;

// Toolbar row: layout preset functions (toolbar-row.ts)
declare function initToolbarRow(): void;
declare function syncToolbarToTab(tabId: number): void;
declare function getTabLayoutPreset(tabId: number): string | undefined;
declare function setTabLayoutPreset(tabId: number, presetName: string): void;

// Cross-module function: changed-files-panel.ts exports this for renderer.ts to call
declare function refreshChangedFilesPanel(): Promise<void>;

// Cross-module function: git-status.ts exports this for changed-files-panel.ts to call
// Returns the GitCacheEntry for the given tabId, or undefined if not cached
declare function getGitCacheForTab(tabId: number): { cwd: string; projectRoot: string | null; info: { branch: string; dirty: boolean; dirtyCount: number; ahead: number } | null; files: { path: string; x: string; y: string }[] | null; filesTs: number } | undefined;

// Cross-module function: git-status.ts — per-pane cache lookup
declare function getGitCacheForPane(ptyId: number): { cwd: string; projectRoot: string | null; info: { branch: string; dirty: boolean; dirtyCount: number; ahead: number } | null; files: { path: string; x: string; y: string }[] | null; filesTs: number } | undefined;

// Cross-module function: git-status.ts — cleanup per-pane cache when pane closes
declare function cleanupPaneGitCache(ptyId: number): void;

// Sidebar pane sub-row functions (sidebar.ts — Sprint 2)
declare function updateSidebarPaneRows(tabId: number): void;
declare function refreshSidebarPaneRowBranch(tabId: number, ptyId: number): void;
declare function setSidebarPaneRowState(tabId: number, ptyId: number, state: "idle" | "running" | "waiting" | "done"): void;
