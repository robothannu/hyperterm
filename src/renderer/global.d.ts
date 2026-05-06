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
  hypert_pty_id?: string;
  payload?: unknown;
}

interface AppSettings {
  claudeNotifications: boolean;
  codexNotifications?: boolean;
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
  // Sprint: Run with Claude — spawns a PTY whose foreground command is `claude`.
  // Sprint 2: optional `taskText` becomes claude's first CLI arg (positional argv,
  // not interpolated into any shell -c string).
  createPtyWithClaude(
    cols: number,
    rows: number,
    cwd?: string,
    taskText?: string
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

  // --- Subagent Watcher (Sprint 2) ---
  onSubagentStatus(callback: (payload: SubagentStatusPayload) => void): void;
  getSubagentSnapshot(): Promise<SubagentStatusPayload[]>;

  // --- Workspace Dashboard (Sprint 4) ---
  openDashboard(): void;

  // --- group:openWithCwd (Sprint 3 dashboard → main renderer) ---
  onOpenGroupWithCwd(callback: (payload: { path: string }) => void): void;

  // --- group:openWithCwdWithClaude (Sprint: Run with Claude) ---
  // Sprint 2: payload may include optional taskText for "Ask Claude per nextStep".
  onOpenGroupWithCwdWithClaude(
    callback: (payload: { path: string; taskText?: string }) => void
  ): void;

  // --- Sprint 1 (Codex 진입점): Codex PTY + IPC ---
  // Sprint 3: optional taskText forwarded to codex as positional prompt arg.
  createPtyWithCodex(
    cols: number,
    rows: number,
    cwd?: string,
    taskText?: string
  ): Promise<{ id: number; sessionKey: string }>;

  // Sprint 3: payload may include optional taskText for "Ask Codex per nextStep".
  onOpenGroupWithCwdWithCodex(
    callback: (payload: { path: string; taskText?: string }) => void
  ): void;

  // --- Sprint 2 (Codex sidebar marker): Codex process status polling ---
  getCodexStatus(id: number): Promise<{ isCodexRunning: boolean; codexPid: number | null }>;

  // --- Sprint 3 (Codex usage): fetch Codex usage info ---
  // Returns { available: false } since codex CLI has no usage subcommand.
  fetchCodexUsage(): Promise<{ available: boolean; raw?: string }>;
}

interface SubagentAgent {
  agent_type?: string;
  task_description?: string;
  started_at: number;
}

interface SubagentStatusPayload {
  ptyId: string;
  activeCount: number;
  agents: SubagentAgent[];
}

interface Window {
  terminalAPI: TerminalAPI;
  dashboardAPI?: DashboardAPI;
}

// Dashboard API (exposed only in dashboard.html window context)
interface DashboardGitLogEntry {
  hash: string;
  msg: string;
  relTime: string;
}

interface DashboardCardData {
  claude: string | null;
  progress: string | null;
  gitLog: DashboardGitLogEntry[] | null;
  notAGitRepo: boolean;
  errors: {
    claude?: string;
    progress?: string;
    gitLog?: string;
  };
}

// Sprint 4: card revamp types
interface DashboardOverviewGit {
  branch: string | null;
  commitsLast7d: number | null;
  dirty: boolean | null;
  notAGitRepo: boolean;
}

interface DashboardOverviewSummary {
  objective: string | null;
  goal: string | null;
  currentTask: string | null;
  nextSteps: string[];
  git: DashboardOverviewGit;
  errors: { claude?: string; progress?: string; git?: string };
}

interface DashboardStatusInfo {
  notAGitRepo: boolean;
  branch: string | null;
  dirty: boolean | null;
  staged: number | null;
  unstaged: number | null;
  untracked: number | null;
  ahead: number | null;
  behind: number | null;
  remoteUrl: string | null;
  lastCommitRelTime: string | null;
  error?: string;
}

interface DashboardFileTreeNode {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: DashboardFileTreeNode[];
}

interface DashboardFileTreeResult {
  tree: DashboardFileTreeNode[] | null;
  error?: string;
}

// Sprint 2 (Dashboard design v2): git flow diagram source data
interface DashboardGitFlowCommit {
  id: string;
  shortHash: string;
  parents: string[];
  author: string;
  relTime: string;
  msg: string;
  branch: string | null;
  tag: string | null;
  isHead: boolean;
}

interface DashboardGitFlowData {
  commits: DashboardGitFlowCommit[];
  branches: string[];
  head: string | null;
  branch: string | null;
  summary: string;
}

// Sprint 3 (Dashboard design v2): discovery banner candidate
interface DashboardDiscoveryCandidate {
  absolutePath: string;
  name: string;
  root: string;
}

interface DashboardBatchAddResult {
  workspaces: WorkspaceEntry[];
  added: string[];
  failed: { path: string; reason: string }[];
}

interface DashboardAPI {
  listWorkspaces(): Promise<WorkspaceEntry[]>;
  addWorkspace(): Promise<{ workspaces: WorkspaceEntry[]; duplicate: boolean; cancelled: boolean }>;
  removeWorkspace(id: string): Promise<WorkspaceEntry[]>;
  checkPathExists(p: string): Promise<boolean>;
  readCardData(workspacePath: string): Promise<DashboardCardData | { error: string }>;
  renameWorkspace(id: string, newName: string): Promise<{ workspaces: WorkspaceEntry[]; success: boolean }>;
  openInMain(workspacePath: string): Promise<{ success?: boolean; error?: string }>;
  // Sprint: Run with Claude — opens workspace as new group + runs `claude` in initial PTY.
  // Pre-checks claude availability; if missing returns { error: "claude_missing" } and
  // does NOT focus/create the main window.
  // Sprint 2: optional `taskText` is passed as claude's prompt argument (safe argv path,
  // no shell interpolation).
  openInMainWithClaude(
    workspacePath: string,
    taskText?: string
  ): Promise<{ success?: boolean; error?: string }>;
  // Sprint: Run with Claude — checks if `claude` is resolvable from interactive zsh.
  claudeCheckInstalled(): Promise<boolean>;
  // Sprint 1 (Codex 진입점): opens workspace as new group + runs `codex` in initial PTY.
  // Sprint 3: optional taskText is forwarded to codex as positional prompt arg.
  openInMainWithCodex(workspacePath: string, taskText?: string): Promise<{ success?: boolean; error?: string }>;
  // Sprint 1 (Codex 진입점): checks if `codex` is resolvable from interactive zsh.
  codexCheckInstalled(): Promise<boolean>;
  // Sprint 4
  overviewSummary(workspacePath: string): Promise<DashboardOverviewSummary | { error: string }>;
  statusInfo(workspacePath: string): Promise<DashboardStatusInfo | { error: string }>;
  fileTree(workspacePath: string): Promise<DashboardFileTreeResult>;
  // Sprint 5: session state badges
  sessionState(workspacePath: string): Promise<{ open: boolean; harnessPhase: string | null }>;
  // Sprint 2: archive toggle
  archiveToggle(id: string, archived: boolean): Promise<{ workspaces: WorkspaceEntry[]; success: boolean }>;
  // Sprint 1 UX Polish
  homedir(): Promise<string>;
  openInTerminal(workspacePath: string): Promise<{ success?: boolean; error?: string }>;
  openInIDE(workspacePath: string): Promise<{ success?: boolean; error?: string }>;
  revealInFinder(workspacePath: string): Promise<{ success?: boolean; error?: string }>;
  // Sprint 2 (Dashboard design v2): git flow diagram source data
  gitFlow(workspacePath: string): Promise<DashboardGitFlowData | null>;
  // Sprint 3 (Dashboard design v2): discovery banner
  discoverCandidates(): Promise<DashboardDiscoveryCandidate[]>;
  addWorkspacesBatch(paths: string[]): Promise<DashboardBatchAddResult>;
  // Sprint 1 (New Project Wizard): create a new project directory + register workspace.
  newProject(payload: {
    projectName: string;
    parentDir: string;
    options: {
      gitInit: boolean;
      claudeMd: boolean;
      progressMd: boolean;
      gitignoreNode: boolean;
    };
    createParent?: boolean;
  }): Promise<{
    success: boolean;
    absolutePath?: string;
    workspaces?: WorkspaceEntry[];
    error?: string;
    parentCreated?: boolean;
  }>;
}

interface WorkspaceEntry {
  id: string;
  name: string;
  absolutePath: string;
  addedAt: string;
  // Sprint 2 optional fields
  archived?: boolean;
  iconColor?: string;
  tags?: string[];
}

// Cross-module teardown helpers (defined in their respective modules,
// called from renderer.ts _teardownAll during beforeunload / onBeforeQuit)
declare function teardownKeybindings(): void;
declare function teardownSidebarDelegation(): void;
declare function stopGitPolling(): void;

// Sprint 1 (Session Restore): snapshot-capture.ts — loaded before renderer.ts
declare function captureSnapshot(session: TerminalSession): string;
declare function buildDivider(timestamp?: string | Date): string;
declare function restoreSnapshot(session: TerminalSession, snapshot: string, savedAt?: string): void;

// Sprint 1 (Session Restore): periodic snapshot save — defined in renderer.ts
declare function startPeriodicSnapshotSave(): void;
declare function stopPeriodicSnapshotSave(): void;

// Sidebar dot state (sidebar.ts → hook-state.ts, agent-status.ts, agent-status-codex.ts)
declare function setSidebarDotState(tabId: number, state: "idle" | "running" | "codex-running" | "waiting" | "done"): void;
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

// Sprint 3: Codex usage refresh (statusbar.ts) — called from init.ts
declare function refreshCodexUsage(): Promise<void>;

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

// Subagent indicator (subagent-indicator.ts — Sprint 3)
declare function initSubagentIndicator(): Promise<void>;
declare function cleanupSubagentForPty(ptyId: number): void;

// Codex agent status polling (agent-status-codex.ts — Sprint 2)
declare function startCodexPolling(): void;
declare function stopCodexPolling(): void;
declare function cleanupCodexTabMarker(tabId: number): void;
