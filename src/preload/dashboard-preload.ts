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
});
