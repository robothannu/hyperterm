import { contextBridge, ipcRenderer } from "electron";

interface Workspace {
  id: string;
  name: string;
  absolutePath: string;
  addedAt: string;
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
});
