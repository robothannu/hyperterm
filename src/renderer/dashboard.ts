/// <reference path="./global.d.ts" />
// Dashboard renderer — Sprint 4
// Loaded only in dashboard.html context (separate BrowserWindow).
// Communicates with main via window.dashboardAPI (exposed by dashboard-preload.ts).

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let workspaces: WorkspaceEntry[] = [];

// ---------------------------------------------------------------------------
// Toast helper
// ---------------------------------------------------------------------------

let toastTimer: ReturnType<typeof setTimeout> | null = null;

function showDashboardToast(message: string, variant: "ok" | "warn" | "err" = "ok"): void {
  const el = document.getElementById("toast") as HTMLElement;
  el.textContent = message;
  el.className = "visible " + variant;
  if (toastTimer !== null) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.className = "";
    toastTimer = null;
  }, 2800);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeDash(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

async function renderWorkspaces(): Promise<void> {
  const list = document.getElementById("workspace-list") as HTMLUListElement;
  const emptyState = document.getElementById("empty-state") as HTMLDivElement;

  list.innerHTML = "";

  if (workspaces.length === 0) {
    emptyState.style.display = "";
    return;
  }

  emptyState.style.display = "none";

  // Check path existence for all workspaces in parallel
  const api = window.dashboardAPI!;
  const existsResults = await Promise.all(
    workspaces.map((ws) => api.checkPathExists(ws.absolutePath))
  );

  workspaces.forEach((ws, i) => {
    const isMissing = !existsResults[i];
    const li = document.createElement("li");
    li.className = "ws-item" + (isMissing ? " missing" : "");
    li.dataset.id = ws.id;

    li.innerHTML = `
      <span class="ws-icon">${isMissing ? "&#9888;" : "&#128193;"}</span>
      <div class="ws-info">
        <span class="ws-name">${escapeDash(ws.name)}</span>
        <span class="ws-path">${escapeDash(ws.absolutePath)}</span>
      </div>
      <button class="btn-remove" data-id="${escapeDash(ws.id)}" title="Remove workspace">&times;</button>
    `;

    list.appendChild(li);
  });

  // Attach remove handlers
  list.querySelectorAll(".btn-remove").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = (btn as HTMLElement).dataset.id ?? "";
      void handleRemove(id);
    });
  });
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleAdd(): Promise<void> {
  const result = await window.dashboardAPI!.addWorkspace();
  if (result.cancelled) return;

  if (result.duplicate) {
    showDashboardToast("This folder is already in your workspace list.", "warn");
    return;
  }

  workspaces = result.workspaces;
  await renderWorkspaces();
  showDashboardToast("Workspace added.", "ok");
}

async function handleRemove(id: string): Promise<void> {
  const ws = workspaces.find((w) => w.id === id);
  if (!ws) return;

  const confirmed = window.confirm(
    `Remove "${ws.name}" from workspaces?\n\nThe original folder will not be deleted.`
  );
  if (!confirmed) return;

  workspaces = await window.dashboardAPI!.removeWorkspace(id);
  await renderWorkspaces();
  showDashboardToast("Workspace removed.", "ok");
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

(async () => {
  workspaces = await window.dashboardAPI!.listWorkspaces();
  await renderWorkspaces();

  const addBtn = document.getElementById("btn-add-workspace") as HTMLButtonElement;
  addBtn.addEventListener("click", () => { void handleAdd(); });
})();
