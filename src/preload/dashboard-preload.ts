import { contextBridge, ipcRenderer } from "electron";

interface Workspace {
  id: string;
  name: string;
  absolutePath: string;
  addedAt: string;
  // Sprint 2 optional fields
  archived?: boolean;
  iconColor?: string;
  tags?: string[];
}

interface AddResult {
  workspaces: Workspace[];
  duplicate: boolean;
  cancelled: boolean;
}

interface RenameResult {
  workspaces: Workspace[];
  success: boolean;
}

interface OpenInMainResult {
  success?: boolean;
  error?: string;
}

interface GitLogEntry {
  hash: string;
  msg: string;
  relTime: string;
}

interface CardData {
  claude: string | null;
  progress: string | null;
  gitLog: GitLogEntry[] | null;
  notAGitRepo: boolean;
  errors: {
    claude?: string;
    progress?: string;
    gitLog?: string;
  };
}

// Sprint 4 types
interface OverviewGit {
  branch: string | null;
  commitsLast7d: number | null;
  dirty: boolean | null;
  notAGitRepo: boolean;
}

interface OverviewSummary {
  objective: string | null;
  goal: string | null;
  currentTask: string | null;
  nextSteps: string[];
  git: OverviewGit;
  errors: { claude?: string; progress?: string; git?: string };
}

interface StatusInfo {
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

interface FileTreeNode {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: FileTreeNode[];
}

interface FileTreeResult {
  tree: FileTreeNode[] | null;
  error?: string;
}

// Sprint 2 (Dashboard design v2): Git flow diagram data
interface GitFlowCommit {
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

interface GitFlowData {
  commits: GitFlowCommit[];
  branches: string[];
  head: string | null;
  branch: string | null;
  summary: string;
}

// Sprint 3: Discovery banner types
interface DiscoveryCandidate {
  absolutePath: string;
  name: string;
  root: string;
}

interface BatchAddResult {
  workspaces: Workspace[];
  added: string[];
  failed: { path: string; reason: string }[];
}

contextBridge.exposeInMainWorld("dashboardAPI", {
  listWorkspaces: (): Promise<Workspace[]> => {
    return ipcRenderer.invoke("workspace:list");
  },

  addWorkspace: (): Promise<AddResult> => {
    return ipcRenderer.invoke("workspace:add");
  },

  removeWorkspace: (id: string): Promise<Workspace[]> => {
    return ipcRenderer.invoke("workspace:remove", id);
  },

  checkPathExists: (p: string): Promise<boolean> => {
    return ipcRenderer.invoke("path:checkExists", p);
  },

  readCardData: (workspacePath: string): Promise<CardData | { error: string }> => {
    return ipcRenderer.invoke("workspace:cardData", workspacePath);
  },

  renameWorkspace: (id: string, newName: string): Promise<RenameResult> => {
    return ipcRenderer.invoke("workspace:rename", id, newName);
  },

  openInMain: (workspacePath: string): Promise<OpenInMainResult> => {
    return ipcRenderer.invoke("workspace:openInMain", workspacePath);
  },

  // Sprint 4: card revamp data sources
  overviewSummary: (workspacePath: string): Promise<OverviewSummary | { error: string }> => {
    return ipcRenderer.invoke("workspace:overviewSummary", workspacePath);
  },

  statusInfo: (workspacePath: string): Promise<StatusInfo | { error: string }> => {
    return ipcRenderer.invoke("workspace:statusInfo", workspacePath);
  },

  fileTree: (workspacePath: string): Promise<FileTreeResult> => {
    return ipcRenderer.invoke("workspace:fileTree", workspacePath);
  },

  // Sprint 5: session state badges
  sessionState: (workspacePath: string): Promise<{ open: boolean; harnessPhase: string | null }> => {
    return ipcRenderer.invoke("workspace:sessionState", workspacePath);
  },

  // Sprint 2: archive toggle
  archiveToggle: (id: string, archived: boolean): Promise<{ workspaces: Workspace[]; success: boolean }> => {
    return ipcRenderer.invoke("workspace:archiveToggle", id, archived);
  },

  // Sprint 1 UX Polish: home dir for tilde abbreviation
  homedir: (): Promise<string> => {
    return ipcRenderer.invoke("workspace:homedir");
  },

  // Sprint 1 UX Polish: open workspace folder in macOS Terminal.app
  openInTerminal: (workspacePath: string): Promise<{ success?: boolean; error?: string }> => {
    return ipcRenderer.invoke("workspace:openInTerminal", workspacePath);
  },

  // Sprint 1 UX Polish: open workspace folder in Cursor
  openInIDE: (workspacePath: string): Promise<{ success?: boolean; error?: string }> => {
    return ipcRenderer.invoke("workspace:openInIDE", workspacePath);
  },

  // Sprint 1 UX Polish: reveal in Finder
  revealInFinder: (workspacePath: string): Promise<{ success?: boolean; error?: string }> => {
    return ipcRenderer.invoke("workspace:revealInFinder", workspacePath);
  },

  // Sprint 2 (Dashboard design v2): git flow diagram source data.
  // Returns null on non-git / missing path / failure (renderer skips SVG).
  gitFlow: (workspacePath: string): Promise<GitFlowData | null> => {
    return ipcRenderer.invoke("workspace:gitFlow", workspacePath);
  },

  // Sprint 3 (Dashboard design v2): discovery banner — scan ~/dev, ~/work,
  // ~/projects for unregistered git repos.
  discoverCandidates: (): Promise<DiscoveryCandidate[]> => {
    return ipcRenderer.invoke("workspace:discoverCandidates");
  },

  // Sprint 3: batch add multiple workspace paths via a single IPC roundtrip.
  addWorkspacesBatch: (paths: string[]): Promise<BatchAddResult> => {
    return ipcRenderer.invoke("workspace:addBatch", paths);
  },
});
