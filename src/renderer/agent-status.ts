/// <reference path="./global.d.ts" />
/// <reference path="./pane-types.d.ts" />

// --- Agent Status Polling ---
// Polls getAgentStatus for each pane in the active tab every 2.5 seconds.
// Updates pane header markers and sidebar tab markers.

const AGENT_POLL_INTERVAL_MS = 2500;
let agentPollTimer: ReturnType<typeof setInterval> | null = null;

// ---------------------------------------------------------------------------
// IPC failure tracking
// ---------------------------------------------------------------------------

const AGENT_IPC_FAIL_THRESHOLD = 3;
let agentIpcFailCount = 0;
let agentIpcThrottleWarned = false; // throttle: warn once per failure run

function setAgentIpcErrorIndicator(visible: boolean): void {
  const statusbar = document.getElementById("statusbar");
  if (!statusbar) return;

  let indicator = document.getElementById("agent-ipc-error") as HTMLElement | null;
  if (visible) {
    if (!indicator) {
      indicator = document.createElement("span");
      indicator.id = "agent-ipc-error";
      indicator.className = "agent-ipc-error";
      indicator.title = "Agent status polling failed — IPC error";
      indicator.textContent = "⚠ agent IPC";
      // Insert before the spacer
      const spacer = statusbar.querySelector(".statusbar-spacer");
      if (spacer) {
        statusbar.insertBefore(indicator, spacer);
      } else {
        statusbar.prepend(indicator);
      }
    }
  } else {
    indicator?.remove();
  }
}

function recordAgentIpcSuccess(): void {
  if (agentIpcFailCount > 0) {
    agentIpcFailCount = 0;
    agentIpcThrottleWarned = false;
    setAgentIpcErrorIndicator(false);
  }
}

function recordAgentIpcFailure(): void {
  agentIpcFailCount++;
  if (agentIpcFailCount >= AGENT_IPC_FAIL_THRESHOLD) {
    setAgentIpcErrorIndicator(true);
    if (!agentIpcThrottleWarned) {
      agentIpcThrottleWarned = true;
      console.warn(
        `[agent-status] getAgentStatus IPC failed ${agentIpcFailCount} consecutive times — polling degraded`
      );
    }
  }
}

// Map of ptyId → the marker element inside the pane header
const paneAgentMarkers = new Map<number, HTMLElement>();
// Track previous running state per ptyId for activity logging
const prevAgentRunning = new Map<number, boolean>();

// ---------------------------------------------------------------------------
// Marker helpers
// ---------------------------------------------------------------------------

function getOrCreatePaneMarker(leaf: PaneLeaf): HTMLElement {
  if (paneAgentMarkers.has(leaf.ptyId)) {
    return paneAgentMarkers.get(leaf.ptyId)!;
  }
  const header = leaf.element.querySelector(".pane-header") as HTMLElement | null;
  if (!header) {
    // Fallback: create one (should not happen in practice)
    const marker = document.createElement("span");
    marker.className = "agent-marker hidden";
    paneAgentMarkers.set(leaf.ptyId, marker);
    return marker;
  }
  const marker = document.createElement("span");
  marker.className = "agent-marker hidden";
  marker.textContent = "● Claude";
  header.appendChild(marker);
  paneAgentMarkers.set(leaf.ptyId, marker);
  return marker;
}

function removePaneMarker(ptyId: number): void {
  const marker = paneAgentMarkers.get(ptyId);
  if (marker) {
    marker.remove();
    paneAgentMarkers.delete(ptyId);
  }
}

function setPaneAgentStatus(leaf: PaneLeaf, active: boolean): void {
  leaf.agentStatus = active;
  const marker = getOrCreatePaneMarker(leaf);
  if (active) {
    marker.classList.remove("hidden");
  } else {
    marker.classList.add("hidden");
  }
}

// ---------------------------------------------------------------------------
// Sidebar tab marker
// ---------------------------------------------------------------------------

function updateSidebarAgentMarker(tabId: number, hasAgent: boolean): void {
  const li = document.querySelector(
    `#terminal-list [data-id="${tabId}"]`
  ) as HTMLElement | null;
  if (!li) return;

  // Update the card-dot-status visual indicator
  const dotStatus = li.querySelector(".card-dot-status") as HTMLElement | null;
  if (dotStatus) {
    if (hasAgent) {
      dotStatus.setAttribute("data-state", "running");
    } else {
      // Only clear if not in waiting state (hook-state manages that)
      const currentState = dotStatus.getAttribute("data-state");
      if (currentState === "running") {
        dotStatus.setAttribute("data-state", "idle");
      }
    }
    applySidebarDotState(dotStatus);
  }

  // Legacy sidebar-agent-dot: keep a hidden marker for backward compat
  let dot = li.querySelector(".sidebar-agent-dot") as HTMLElement | null;
  if (hasAgent) {
    if (!dot) {
      dot = document.createElement("span");
      dot.className = "sidebar-agent-dot hidden";
      dot.title = "Claude is running";
      li.appendChild(dot);
    }
  } else {
    dot?.remove();
  }
}

// ---------------------------------------------------------------------------
// Poll loop
// ---------------------------------------------------------------------------

async function pollAgentStatus(): Promise<void> {
  if (activeTabId === null) return;

  // Poll all tabs, not just the active one, so that inactive tab panes
  // don't accumulate stale agentStatus=true values.
  const FAIL_SENTINEL = Symbol("ipc_fail");

  // Collect all leaves across every tab (preserve tab association)
  const allEntries: Array<{ tabId: number; leaf: PaneLeaf }> = [];
  for (const [tabId, tab] of tabMap.entries()) {
    for (const leaf of getAllLeaves(tab.root)) {
      allEntries.push({ tabId, leaf });
    }
  }

  if (allEntries.length === 0) return;

  console.log(`[agent-status] polling ${allEntries.length} pane(s) across ${tabMap.size} tab(s)`);

  // Burst-poll all panes at once
  const results = await Promise.all(
    allEntries.map(({ leaf }) =>
      window.terminalAPI.getAgentStatus(leaf.ptyId).catch(() => FAIL_SENTINEL)
    )
  );

  // Track IPC health
  const anySuccess = results.some((r) => r !== FAIL_SENTINEL);
  if (anySuccess) {
    recordAgentIpcSuccess();
  } else if (allEntries.length > 0) {
    recordAgentIpcFailure();
  }

  // Update each pane's agentStatus + pane header marker only
  // (setSidebarPaneRowState is NOT called here — that is hook-state's responsibility)
  let activeTabHasAgent = false;
  for (let i = 0; i < allEntries.length; i++) {
    const { tabId, leaf } = allEntries[i];
    const raw = results[i];
    const result = raw === FAIL_SENTINEL ? null : (raw as { isClaudeRunning: boolean; claudePid: number | null } | null);
    const isRunning = result?.isClaudeRunning ?? false;
    prevAgentRunning.set(leaf.ptyId, isRunning);
    setPaneAgentStatus(leaf, isRunning);
    if (tabId === activeTabId && isRunning) activeTabHasAgent = true;
  }

  // Sidebar top marker: active tab only
  updateSidebarAgentMarker(activeTabId, activeTabHasAgent);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function startAgentPolling(): void {
  if (agentPollTimer !== null) return;
  agentPollTimer = setInterval(() => {
    pollAgentStatus();
  }, AGENT_POLL_INTERVAL_MS);
  // Run immediately on start
  pollAgentStatus();
}

function stopAgentPolling(): void {
  if (agentPollTimer !== null) {
    clearInterval(agentPollTimer);
    agentPollTimer = null;
  }
}

// Clean up markers when a pane is removed
function cleanupPaneAgentMarker(ptyId: number): void {
  removePaneMarker(ptyId);
  prevAgentRunning.delete(ptyId);
}
