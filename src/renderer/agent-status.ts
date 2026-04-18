/// <reference path="./global.d.ts" />
/// <reference path="./pane-types.d.ts" />

// --- Agent Status Polling ---
// Polls getAgentStatus for each pane in the active tab every 2.5 seconds.
// Updates pane header markers and sidebar tab markers.

const AGENT_POLL_INTERVAL_MS = 2500;
let agentPollTimer: ReturnType<typeof setInterval> | null = null;

// Map of ptyId → the marker element inside the pane header
const paneAgentMarkers = new Map<number, HTMLElement>();

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

  let dot = li.querySelector(".sidebar-agent-dot") as HTMLElement | null;
  if (hasAgent) {
    if (!dot) {
      dot = document.createElement("span");
      dot.className = "sidebar-agent-dot";
      dot.title = "Claude is running";
      // Insert before the label element (inside .terminal-entry-row)
      const row = li.querySelector(".terminal-entry-row");
      const labelEl = li.querySelector(".terminal-label");
      if (labelEl && row) {
        row.insertBefore(dot, labelEl);
      } else if (row) {
        row.prepend(dot);
      } else {
        li.prepend(dot);
      }
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
  const tab = tabMap.get(activeTabId);
  if (!tab) return;

  const leaves = getAllLeaves(tab.root);
  let tabHasAgent = false;

  for (const leaf of leaves) {
    try {
      const result = await window.terminalAPI.getAgentStatus(leaf.ptyId);
      setPaneAgentStatus(leaf, result.isClaudeRunning);
      if (result.isClaudeRunning) tabHasAgent = true;
    } catch {
      // IPC failed — treat as not running
      setPaneAgentStatus(leaf, false);
    }
  }

  updateSidebarAgentMarker(activeTabId, tabHasAgent);
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
}
