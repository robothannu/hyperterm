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
}

interface GitCacheEntry {
  cwd: string;
  projectRoot: string | null;
  info: GitInfo | null;
}

const tabGitCache = new Map<number, GitCacheEntry>();

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function escapeGitHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Sidebar git badge
// ---------------------------------------------------------------------------

function updateSidebarGitBadge(tabId: number, info: GitInfo | null): void {
  const li = document.querySelector(
    `#terminal-list [data-id="${tabId}"]`
  ) as HTMLElement | null;
  if (!li) return;

  let badge = li.querySelector(".sidebar-git-badge") as HTMLElement | null;

  if (!info) {
    badge?.remove();
    return;
  }

  if (!badge) {
    badge = document.createElement("div");
    badge.className = "sidebar-git-badge";
    // Insert after the terminal-entry's label row (append to li)
    li.appendChild(badge);
  }

  const branchText = escapeGitHtml(info.branch);
  const dirtyDot = info.dirty ? '<span class="git-dirty-dot" title="Uncommitted changes">●</span>' : "";
  badge.innerHTML = `<span class="git-branch-icon">⎇</span> ${branchText}${dirtyDot ? " " + dirtyDot : ""}`;
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
    tabGitCache.set(tabId, { cwd, projectRoot: null, info: null });
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
    const status = await window.terminalAPI.gitStatus(projectRoot);
    const info: GitInfo | null = status
      ? { branch: status.branch, dirty: status.dirty }
      : null;
    tabGitCache.set(tabId, { cwd, projectRoot, info });
    updateSidebarGitBadge(tabId, info);
  } catch {
    updateSidebarGitBadge(tabId, null);
  }
}

// ---------------------------------------------------------------------------
// Poll all tabs
// ---------------------------------------------------------------------------

async function pollAllGitStatus(): Promise<void> {
  const tabIds = Array.from(tabMap.keys());
  for (const tabId of tabIds) {
    await pollGitForTab(tabId);
  }
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

function startGitPolling(): void {
  if (gitPollTimer !== null) return;
  // Initial poll
  pollAllGitStatus();
  gitPollTimer = setInterval(() => {
    pollAllGitStatus();
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
