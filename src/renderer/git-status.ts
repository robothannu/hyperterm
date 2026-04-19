/// <reference path="./global.d.ts" />
/// <reference path="./pane-types.d.ts" />

// --- Git Status Polling ---
// Polls git status for each pane independently.
// Each pane's cwd is tracked separately in paneGitCache.
// Sidebar card-meta shows the focused pane's git info for the tab.

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

// Per-pane git cache: ptyId → GitCacheEntry
// Each pane tracks its own cwd/branch independently.
const paneGitCache = new Map<number, GitCacheEntry>();

// Tab-level cache kept for backward compat (changed-files-panel reads this).
// Updated to reflect the focused pane's git info after each poll.
const tabGitCache = new Map<number, GitCacheEntry>();

// Expose tab-level cache for changed-files-panel to read (avoids duplicate IPC)
function getGitCacheForTab(tabId: number): GitCacheEntry | undefined {
  return tabGitCache.get(tabId);
}

// Expose pane-level cache (for pane header CWD poll in renderer.ts)
function getGitCacheForPane(ptyId: number): GitCacheEntry | undefined {
  return paneGitCache.get(ptyId);
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
// Poll a single pane — updates paneGitCache[ptyId]
// ---------------------------------------------------------------------------

async function pollGitForPane(ptyId: number): Promise<GitCacheEntry> {
  let cwd: string;
  try {
    cwd = await window.terminalAPI.getCwd(ptyId);
  } catch {
    const empty: GitCacheEntry = { cwd: "", projectRoot: null, info: null, files: null, filesTs: 0 };
    paneGitCache.set(ptyId, empty);
    return empty;
  }

  if (!cwd) {
    const empty: GitCacheEntry = { cwd: "", projectRoot: null, info: null, files: null, filesTs: 0 };
    paneGitCache.set(ptyId, empty);
    return empty;
  }

  // Check existing pane cache
  const cached = paneGitCache.get(ptyId);
  let projectRoot: string | null;

  if (cached && cached.cwd === cwd) {
    // Same dir — reuse cached root
    projectRoot = cached.projectRoot;
  } else {
    // cwd changed or first time — find root
    try {
      projectRoot = await window.terminalAPI.gitFindRoot(cwd);
    } catch {
      projectRoot = null;
    }
  }

  if (!projectRoot) {
    const entry: GitCacheEntry = { cwd, projectRoot: null, info: null, files: null, filesTs: 0 };
    paneGitCache.set(ptyId, entry);
    return entry;
  }

  // MRU: register this project root (only when root changes)
  const prevCached = paneGitCache.get(ptyId);
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
    const entry: GitCacheEntry = { cwd, projectRoot, info, files: files ?? null, filesTs: Date.now() };
    paneGitCache.set(ptyId, entry);
    return entry;
  } catch {
    const entry: GitCacheEntry = { cwd, projectRoot, info: null, files: null, filesTs: 0 };
    paneGitCache.set(ptyId, entry);
    return entry;
  }
}

// ---------------------------------------------------------------------------
// Poll a single tab — polls ALL panes independently, then updates sidebar
// ---------------------------------------------------------------------------

async function pollGitForTab(tabId: number): Promise<void> {
  const tab = tabMap.get(tabId);
  if (!tab) return;

  const leaves = getAllLeaves(tab.root);
  if (leaves.length === 0) return;

  // Poll all panes in parallel
  await Promise.all(leaves.map((leaf) => pollGitForPane(leaf.ptyId)));

  // Update each pane header with its own git info
  if (typeof updatePaneHeadersFromGitCache === "function") {
    updatePaneHeadersFromGitCache(tabId);
  }

  // Update sidebar pane sub-rows branch display for each pane
  if (typeof refreshSidebarPaneRowBranch === "function") {
    for (const leaf of leaves) {
      refreshSidebarPaneRowBranch(tabId, leaf.ptyId);
    }
  }

  // Sidebar card-meta: use focused pane's git info.
  // Rationale: focused pane is what the user is actively working in,
  // so its branch is the most relevant for the sidebar badge.
  const focusedLeaf = leaves.find((l) => l.ptyId === tab.focusedPtyId) ?? leaves[0];
  const focusedEntry = paneGitCache.get(focusedLeaf.ptyId);

  // Sync tab-level cache for changed-files-panel (uses focusedLeaf's data)
  if (focusedEntry) {
    tabGitCache.set(tabId, focusedEntry);
  }

  updateSidebarGitBadge(tabId, focusedEntry?.info ?? null);
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
  // Also clear all pane caches for this tab
  const tab = tabMap.get(tabId);
  if (tab) {
    for (const leaf of getAllLeaves(tab.root)) {
      paneGitCache.delete(leaf.ptyId);
    }
  }
}

// ---------------------------------------------------------------------------
// Public: cleanup per-pane cache when a pane is closed
// ---------------------------------------------------------------------------

function cleanupPaneGitCache(ptyId: number): void {
  paneGitCache.delete(ptyId);
  console.log(`[git-status] pane cache cleaned for ptyId=${ptyId}`);
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
