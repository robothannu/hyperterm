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
});
