/// <reference path="./global.d.ts" />
/// <reference path="./pane-types.d.ts" />

// --- App Startup ---
// This file is loaded last so all module functions are available.

// Auto-refresh usage every 5 minutes
usageRefreshInterval = setInterval(() => {
  refreshUsage();
}, 5 * 60 * 1000);

(async () => {
  try {
    const restored = await restoreFromSaved();
    if (!restored) {
      await createNewTab();
    }
    // Load usage data
    refreshUsage();
    // Start Claude agent status polling
    startAgentPolling();
    // Start git status polling
    startGitPolling();
    // Init Changed Files panel
    initChangedFilesPanel();
    // Init Diff Viewer
    initDiffViewer();
    // Init hook state machine (Sprint 5)
    initHookState();
    // Show hook install banner if needed (Sprint 5)
    initHookInstallBanner();
    // Init Sidebar MRU (Sprint 6)
    initSidebarMru();
    // Init Settings Modal (Sprint 6)
    initSettingsModal();
  } catch (err) {
    console.error("Init error:", err);
  }
})();
