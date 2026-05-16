/// <reference path="./global.d.ts" />
/// <reference path="./pane-types.d.ts" />

// --- Codex Agent Status Polling (Sprint 2: Sidebar Running marker) ---
//
// Polls getCodexStatus for each codex pane every 30 seconds.
// Updates the sidebar tab dot, pane header marker, and pane sub-row state when
// Codex is active.
//
// ISOLATION RULES:
//  - Reads tabMap (shared global from renderer.ts) — read-only.
//  - Calls setSidebarDotState / setSidebarPaneRowState from sidebar.ts.
//  - Never touches Claude hook-state or Claude pane markers.
//  - All errors caught silently (console.warn only) — Claude polling unaffected (AC 4).

const CODEX_POLL_INTERVAL_MS = 30_000;
let codexPollTimer: ReturnType<typeof setInterval> | null = null;

// Track previous codex running state per tab / pane to avoid redundant DOM updates.
const prevCodexRunningByTab = new Map<number, boolean>();
const prevCodexRunningByPty = new Map<number, boolean>();
const codexDoneTimers = new Map<number, ReturnType<typeof setTimeout>>();
const codexMarkers = new Map<number, HTMLElement>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Determine which panes are Codex panes by checking the PTY ID range used by
 * the Codex manager (50000+). Returns a Map of tabId → PaneLeaf[] for all
 * leaves that belong to Codex sessions.
 */
function getCodexLeaves(): Map<number, PaneLeaf[]> {
  const result = new Map<number, PaneLeaf[]>();
  for (const [tabId, tab] of tabMap.entries()) {
    const leaves = getAllLeaves(tab.root);
    const codexLeaves = leaves.filter((leaf) => leaf.ptyId >= 50000);
    if (codexLeaves.length > 0) {
      result.set(tabId, codexLeaves);
    }
  }
  return result;
}

function getOrCreateCodexMarker(leaf: PaneLeaf): HTMLElement {
  const existing = codexMarkers.get(leaf.ptyId);
  if (existing) return existing;

  const header = leaf.element.querySelector(".pane-header") as HTMLElement | null;
  const marker = document.createElement("span");
  marker.className = "agent-marker codex-marker hidden";
  marker.textContent = "● Codex";
  marker.title = "Codex is running";

  if (header) {
    header.appendChild(marker);
  }
  codexMarkers.set(leaf.ptyId, marker);
  return marker;
}

function removeCodexMarker(ptyId: number): void {
  const marker = codexMarkers.get(ptyId);
  if (marker) {
    marker.remove();
    codexMarkers.delete(ptyId);
  }
}

function clearCodexDoneTimer(ptyId: number): void {
  const timer = codexDoneTimers.get(ptyId);
  if (timer) {
    clearTimeout(timer);
    codexDoneTimers.delete(ptyId);
  }
}

function setCodexPaneMarker(leaf: PaneLeaf, running: boolean): void {
  const marker = getOrCreateCodexMarker(leaf);
  if (running) {
    marker.classList.remove("hidden");
  } else {
    marker.classList.add("hidden");
  }
}

function setCodexPaneRowState(tabId: number, ptyId: number, state: "idle" | "running" | "done"): void {
  if (typeof setSidebarPaneRowState === "function") {
    setSidebarPaneRowState(tabId, ptyId, state);
  }
}

function setCodexLeafState(tabId: number, leaf: PaneLeaf, running: boolean): void {
  const ptyId = leaf.ptyId;
  const hadPrev = prevCodexRunningByPty.has(ptyId);
  const prev = prevCodexRunningByPty.get(ptyId) ?? false;

  // Leave the shared Claude fields alone. Codex keeps its own marker/state
  // so hook-state does not treat Codex panes as Claude panes.
  setCodexPaneMarker(leaf, running);

  if (running) {
    clearCodexDoneTimer(ptyId);
    setCodexPaneRowState(tabId, ptyId, "running");
    prevCodexRunningByPty.set(ptyId, true);
    return;
  }

  if (hadPrev && prev) {
    setCodexPaneRowState(tabId, ptyId, "done");
    clearCodexDoneTimer(ptyId);
    codexDoneTimers.set(
      ptyId,
      setTimeout(() => {
        setCodexPaneRowState(tabId, ptyId, "idle");
        codexDoneTimers.delete(ptyId);
      }, 8000),
    );
  } else if (!hadPrev) {
    setCodexPaneRowState(tabId, ptyId, "idle");
  }

  prevCodexRunningByPty.set(ptyId, false);
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
    for (const [tabId, wasRunning] of prevCodexRunningByTab.entries()) {
      if (wasRunning) {
        updateSidebarCodexMarker(tabId, false);
      }
    }
    prevCodexRunningByTab.clear();
    return;
  }

  console.log(`[agent-status-codex] polling ${codexLeafMap.size} codex tab(s)`);

  // Seed: mark all known codex tabs; tabs with no leaves → not running
  const tabRunning = new Map<number, boolean>();
  const leafRunning = new Map<number, boolean>();
  for (const tabId of codexLeafMap.keys()) {
    tabRunning.set(tabId, false);
  }

  // Poll each codex pane — failures are isolated per pane (AC 4)
  const pollPromises: Promise<void>[] = [];
  for (const [tabId, leaves] of codexLeafMap.entries()) {
    for (const leaf of leaves) {
      const ptyId = leaf.ptyId;
      const p = (async () => {
        try {
          const status = await window.terminalAPI.getCodexStatus(ptyId);
          if (status?.isCodexRunning) {
            leafRunning.set(ptyId, true);
            tabRunning.set(tabId, true);
          } else {
            leafRunning.set(ptyId, false);
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
    const prev = prevCodexRunningByTab.get(tabId) ?? false;
    if (isRunning !== prev) {
      updateSidebarCodexMarker(tabId, isRunning);
    }
    prevCodexRunningByTab.set(tabId, isRunning);
  }

  // Update pane markers + sub-row states per Codex leaf.
  for (const [tabId, leaves] of codexLeafMap.entries()) {
    for (const leaf of leaves) {
      const isRunning = leafRunning.get(leaf.ptyId) ?? false;
      setCodexLeafState(tabId, leaf, isRunning);
    }
  }

  // Clear markers for tabs that disappeared from codexLeafMap
  for (const [tabId] of prevCodexRunningByTab.entries()) {
    if (!tabRunning.has(tabId)) {
      updateSidebarCodexMarker(tabId, false);
      prevCodexRunningByTab.delete(tabId);
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
  prevCodexRunningByTab.clear();
  prevCodexRunningByPty.clear();
  for (const timer of codexDoneTimers.values()) {
    clearTimeout(timer);
  }
  codexDoneTimers.clear();
  for (const marker of codexMarkers.values()) {
    marker.remove();
  }
  codexMarkers.clear();
}

// Cleanup when a pane is removed — reset tracking for that pane
function cleanupCodexPaneMarker(ptyId: number): void {
  clearCodexDoneTimer(ptyId);
  prevCodexRunningByPty.delete(ptyId);
  removeCodexMarker(ptyId);
}

// Cleanup when a tab is removed — reset tab-level dot cache
function cleanupCodexTabMarker(tabId: number): void {
  prevCodexRunningByTab.delete(tabId);
}
