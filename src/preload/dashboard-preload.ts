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
});
