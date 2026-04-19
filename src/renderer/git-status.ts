/// <reference path="./global.d.ts" />
/// <reference path="./pane-types.d.ts" />

// --- Git Status Polling ---
// Polls git status for each tab's active pane cwd every 5 seconds.
// Updates sidebar git badge (branch + dirty dot).

const GIT_POLL_INTERVAL_MS = 5000;
let gitPollTimer: ReturnType<typeof setInterval> | null = null;

// Cache: tabId → { cwd, projectRoot, info }
// cwd가 달라지면 재탐색한다.
interface GitInfo {
  branch: string;
  dirty: boolean;
  dirtyCount: number;
  ahead: number;
}

interface GitCacheEntry {
  cwd: string;
  projectRoot: string | null;
  info: GitInfo | null;
  files: { path: string; x: string; y: string }[] | null;
  filesTs: number;
}

const tabGitCache = new Map<number, GitCacheEntry>();

// Expose cache for changed-files-panel to read (avoids duplicate IPC)
function getGitCacheForTab(tabId: number): GitCacheEntry | undefined {
  return tabGitCache.get(tabId);
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Sidebar git badge
// ---------------------------------------------------------------------------

function shortBranch(b: string): string {
  return b.length > 26 ? b.slice(0, 24) + "…" : b;
}

function updateSidebarGitBadge(tabId: number, info: GitInfo | null): void {
  const li = document.querySelector(
    `#terminal-list [data-id="${tabId}"]`
  ) as HTMLElement | null;
  if (!li) return;

  // Update the .card-meta element (new rich card layout)
  const metaEl = li.querySelector(".card-meta") as HTMLElement | null;
  const gitEl = li.querySelector(".card-meta-git") as HTMLElement | null;
  const changesEl = li.querySelector(".card-meta-changes") as HTMLElement | null;
  const aheadEl = li.querySelector(".card-meta-ahead") as HTMLElement | null;

  if (metaEl) {
    if (!info) {
      metaEl.style.display = "none";
    } else {
      metaEl.style.display = "";
      if (gitEl) {
        gitEl.innerHTML = `<svg width="10" height="10" viewBox="0 0 16 16" fill="none" style="flex:none;opacity:0.7"><circle cx="4" cy="4" r="1.5" stroke="currentColor" stroke-width="1.2"/><circle cx="4" cy="12" r="1.5" stroke="currentColor" stroke-width="1.2"/><circle cx="12" cy="8" r="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M4 5.5v5M5.5 12h3a2.5 2.5 0 002.5-2.5v0" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg><span>${escapeHtml(shortBranch(info.branch))}</span>`;
      }
      if (changesEl) {
        if (info.dirty && info.dirtyCount > 0) {
          changesEl.textContent = `●${info.dirtyCount}`;
          changesEl.style.display = "";
        } else {
          changesEl.style.display = "none";
        }
      }
      if (aheadEl) {
        if (info.ahead > 0) {
          aheadEl.textContent = `↑${info.ahead}`;
          aheadEl.style.display = "";
        } else {
          aheadEl.style.display = "none";
        }
      }
    }
  }

  // Legacy .sidebar-git-badge fallback (kept for backward compat, hidden in new layout)
  let badge = li.querySelector(".sidebar-git-badge") as HTMLElement | null;
  if (!info) {
    badge?.remove();
    if (tabId === activeTabId && typeof updateTitlebarBranch === "function") {
      updateTitlebarBranch(null);
    }
    return;
  }

  // Update titlebar branch for the active tab
  if (tabId === activeTabId && typeof updateTitlebarBranch === "function") {
    updateTitlebarBranch(info.branch);
    // Also update pane header branch elements for the active tab
    if (typeof updatePaneHeadersFromGitCache === "function") {
      updatePaneHeadersFromGitCache(tabId);
    }
  }
}

// ---------------------------------------------------------------------------
// Poll a single tab
// ---------------------------------------------------------------------------

async function pollGitForTab(tabId: number): Promise<void> {
  const tab = tabMap.get(tabId);
  if (!tab) return;

  // Get active pane's cwd — use the first leaf if no explicit active leaf
  const leaves = getAllLeaves(tab.root);
  if (leaves.length === 0) return;

  const leaf = leaves[0];
  let cwd: string;
  try {
    cwd = await window.terminalAPI.getCwd(leaf.ptyId);
  } catch {
    return;
  }

  if (!cwd) return;

  // Check cache — cwd가 같을 때만 캐시된 projectRoot 재사용
  const cached = tabGitCache.get(tabId);
  let projectRoot: string | null;

  if (cached && cached.cwd === cwd) {
    // 같은 디렉터리 — 캐시된 root 재사용, status만 갱신
    projectRoot = cached.projectRoot;
  } else {
    // cwd 변경 또는 첫 탐색 — root 재탐색
    try {
      projectRoot = await window.terminalAPI.gitFindRoot(cwd);
    } catch {
      projectRoot = null;
    }
  }

  if (!projectRoot) {
    tabGitCache.set(tabId, { cwd, projectRoot: null, info: null, files: null, filesTs: 0 });
    updateSidebarGitBadge(tabId, null);
    return;
  }

  // MRU: register this project root (only when root changes)
  const prevCached = tabGitCache.get(tabId);
  if (!prevCached || prevCached.projectRoot !== projectRoot) {
    if (typeof addMruProject === "function") {
      addMruProject(projectRoot).catch(() => {/* ignore */});
    }
  }

  try {
    const [status, files] = await Promise.all([
      window.terminalAPI.gitStatus(projectRoot),
      window.terminalAPI.gitFiles(projectRoot).catch(() => null as { path: string; x: string; y: string }[] | null),
    ]);
    const info: GitInfo | null = status
      ? {
          branch: status.branch,
          dirty: status.dirty,
          dirtyCount: status.stagedCount + status.unstagedCount + status.untrackedCount,
          ahead: status.aheadCount ?? 0,
        }
      : null;
    tabGitCache.set(tabId, { cwd, projectRoot, info, files: files ?? null, filesTs: Date.now() });
    updateSidebarGitBadge(tabId, info);
  } catch {
    updateSidebarGitBadge(tabId, null);
  }
}

// ---------------------------------------------------------------------------
// Poll only the active tab (called by periodic timer)
// ---------------------------------------------------------------------------

async function pollActiveGitStatus(): Promise<void> {
  if (activeTabId === null) return;
  console.log(`[git-status] polling active tab ${activeTabId}`);
  await pollGitForTab(activeTabId);
}

// ---------------------------------------------------------------------------
// Public: invalidate cache for a tab (e.g. when cwd changes)
// ---------------------------------------------------------------------------

function invalidateGitCache(tabId: number): void {
  tabGitCache.delete(tabId);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Poll on tab switch: immediately refresh git status for newly active tab
// ---------------------------------------------------------------------------

function pollGitOnTabSwitch(tabId: number): void {
  console.log(`[git-status] on-demand poll for tab ${tabId} (tab switch)`);
  pollGitForTab(tabId).catch(() => {/* ignore */});
}

function startGitPolling(): void {
  if (gitPollTimer !== null) return;
  // Initial poll for active tab
  pollActiveGitStatus();
  gitPollTimer = setInterval(() => {
    pollActiveGitStatus();
  }, GIT_POLL_INTERVAL_MS);
}

function stopGitPolling(): void {
  if (gitPollTimer !== null) {
    clearInterval(gitPollTimer);
    gitPollTimer = null;
  }
}

// Clean up when a tab is removed
function cleanupGitBadge(tabId: number): void {
  tabGitCache.delete(tabId);
  updateSidebarGitBadge(tabId, null);
}
