/// <reference path="./global.d.ts" />
/// <reference path="./pane-types.d.ts" />

// --- Codex Agent Status Polling (Sprint 2: Sidebar Running marker) ---
//
// Polls getCodexStatus for each codex-tab pane every 30 seconds.
// Updates the sidebar tab dot to "codex-running" (blue) when codex is active.
//
// ISOLATION RULES:
//  - Reads tabMap (shared global from renderer.ts) — read-only.
//  - Calls setSidebarDotState from sidebar.ts — separate state key "codex-running".
//  - Never modifies agentStatus on PaneLeaf (that is Claude-only).
//  - Never touches agent-status.ts state or functions.
//  - All errors caught silently (console.warn only) — Claude polling unaffected (AC 4).

const CODEX_POLL_INTERVAL_MS = 30_000;
let codexPollTimer: ReturnType<typeof setInterval> | null = null;

// Track previous codex running state per tabId to avoid redundant DOM updates
const prevCodexRunning = new Map<number, boolean>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Determine which tabs are codex tabs by checking Tab.codexCwd and by
 * checking if any pane ptyId is >= 50000 (codex PTY ID range).
 * Returns a Map of tabId → ptyId[] for all leaves that are codex sessions.
 */
function getCodexLeaves(): Map<number, number[]> {
  const result = new Map<number, number[]>();
  for (const [tabId, tab] of tabMap.entries()) {
    // A tab is a codex tab if it has codexCwd set, OR if any leaf ptyId >= 50000
    const isCodexTab = !!tab.codexCwd;
    const leaves = getAllLeaves(tab.root);
    const codexLeafIds = leaves
      .map((l) => l.ptyId)
      .filter((id) => id >= 50000 || isCodexTab);
    if (codexLeafIds.length > 0) {
      result.set(tabId, codexLeafIds);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Codex sidebar marker
// ---------------------------------------------------------------------------

function updateSidebarCodexMarker(tabId: number, isRunning: boolean): void {
  const li = document.querySelector(
    `#terminal-list [data-id="${tabId}"]`
  ) as HTMLElement | null;
  if (!li) return;

  const dotStatus = li.querySelector(".card-dot-status") as HTMLElement | null;
  if (!dotStatus) return;

  const currentState = dotStatus.getAttribute("data-state") || "idle";

  if (isRunning) {
    // Only override if not in hook-managed states (waiting / done)
    if (currentState !== "waiting" && currentState !== "done") {
      setSidebarDotState(tabId, "codex-running");
    }
  } else {
    // Only clear codex-running; do not touch Claude-running or hook states
    if (currentState === "codex-running") {
      setSidebarDotState(tabId, "idle");
    }
  }
}

// ---------------------------------------------------------------------------
// Poll loop
// ---------------------------------------------------------------------------

async function pollCodexStatus(): Promise<void> {
  // AC 3: skip immediately if no codex tabs exist — no IPC calls
  const codexLeafMap = getCodexLeaves();
  if (codexLeafMap.size === 0) {
    // Clear any stale markers for tabs that are no longer codex tabs
    for (const [tabId, wasRunning] of prevCodexRunning.entries()) {
      if (wasRunning) {
        updateSidebarCodexMarker(tabId, false);
      }
    }
    prevCodexRunning.clear();
    return;
  }

  console.log(`[agent-status-codex] polling ${codexLeafMap.size} codex tab(s)`);

  // Seed: mark all known codex tabs; tabs with no leaves → not running
  const tabRunning = new Map<number, boolean>();
  for (const tabId of codexLeafMap.keys()) {
    tabRunning.set(tabId, false);
  }

  // Poll each codex pane — failures are isolated per pane (AC 4)
  const pollPromises: Promise<void>[] = [];
  for (const [tabId, ptyIds] of codexLeafMap.entries()) {
    for (const ptyId of ptyIds) {
      const p = (async () => {
        try {
          const status = await window.terminalAPI.getCodexStatus(ptyId);
          if (status?.isCodexRunning) {
            tabRunning.set(tabId, true);
          }
        } catch (err) {
          // AC 4: silent failure — only warn, never propagate
          console.warn(`[agent-status-codex] getCodexStatus(${ptyId}) failed:`, err);
        }
      })();
      pollPromises.push(p);
    }
  }

  // Wait for all polls independently (not Promise.all — each has its own try/catch)
  await Promise.allSettled(pollPromises);

  // Update sidebar markers + track prev state
  for (const [tabId, isRunning] of tabRunning.entries()) {
    const prev = prevCodexRunning.get(tabId) ?? false;
    if (isRunning !== prev) {
      updateSidebarCodexMarker(tabId, isRunning);
    }
    prevCodexRunning.set(tabId, isRunning);
  }

  // Clear markers for tabs that disappeared from codexLeafMap
  for (const [tabId] of prevCodexRunning.entries()) {
    if (!tabRunning.has(tabId)) {
      updateSidebarCodexMarker(tabId, false);
      prevCodexRunning.delete(tabId);
    }
  }
}

// ---------------------------------------------------------------------------
// Lifecycle — called from init.ts after all modules are loaded
// ---------------------------------------------------------------------------

function startCodexPolling(): void {
  if (codexPollTimer !== null) return;
  // Run immediately on start, then every 30s
  pollCodexStatus();
  codexPollTimer = setInterval(() => {
    pollCodexStatus();
  }, CODEX_POLL_INTERVAL_MS);
  console.log("[agent-status-codex] polling started (30s interval)");
}

function stopCodexPolling(): void {
  if (codexPollTimer !== null) {
    clearInterval(codexPollTimer);
    codexPollTimer = null;
  }
  prevCodexRunning.clear();
}

// Cleanup when a pane is removed — reset tracking for that pane's tab
function cleanupCodexTabMarker(tabId: number): void {
  prevCodexRunning.delete(tabId);
}
