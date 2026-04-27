/// <reference path="./global.d.ts" />

// Sidebar dashboard button — Sprint 4
// Wires up #btn-dashboard to open the Workspace Dashboard window via IPC.

(function initDashboardSidebarButton() {
  const btn = document.getElementById("btn-dashboard") as HTMLButtonElement | null;
  if (!btn) {
    console.warn("[dashboard-sidebar] #btn-dashboard not found in DOM");
    return;
  }

  btn.addEventListener("click", () => {
    window.terminalAPI.openDashboard();
  });
})();
