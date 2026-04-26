/// <reference path="./global.d.ts" />
/// <reference path="./pane-types.d.ts" />

// --- Subagent Indicator (Sprint 3) ---
// Aggregates subagent counts per group (tab) and renders a purple dot + count badge
// in the sidebar. Hover shows a popover with per-agent details.
//
// Constraints:
//  - Uses only Sprint 2 IPC: onSubagentStatus + getSubagentSnapshot
//  - No new IPC channels
//  - Group count = sum of activeCount across all PTYs belonging to that group (multi-pane aware)

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// ptyId → SubagentStatusPayload (last known)
const subagentPtyState = new Map<number, SubagentStatusPayload>();

// Active popover reference (at most one open at a time)
let activePopover: HTMLElement | null = null;
let activePopoverTabId: number | null = null;

// ---------------------------------------------------------------------------
// Helpers: elapsed time string
// ---------------------------------------------------------------------------

function formatElapsed(startedAt: number): string {
  const elapsed = Math.floor((Date.now() - startedAt) / 1000);
  if (elapsed < 60) return `${elapsed}s`;
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  return `${m}m${s > 0 ? ` ${s}s` : ""}`;
}

// ---------------------------------------------------------------------------
// Aggregate: compute group-level count + agent list for a tab
// ---------------------------------------------------------------------------

interface GroupSubagentInfo {
  count: number;
  agents: Array<{
    agent_type?: string;
    task_description?: string;
    started_at: number;
  }>;
}

function getGroupInfo(tabId: number): GroupSubagentInfo {
  const tab = tabMap.get(tabId);
  if (!tab) return { count: 0, agents: [] };

  const leaves = getAllLeaves(tab.root);
  let totalCount = 0;
  const allAgents: GroupSubagentInfo["agents"] = [];

  for (const leaf of leaves) {
    const payload = subagentPtyState.get(leaf.ptyId);
    if (payload && payload.activeCount > 0) {
      totalCount += payload.activeCount;
      allAgents.push(...payload.agents);
    }
  }

  return { count: totalCount, agents: allAgents };
}

// ---------------------------------------------------------------------------
// DOM: get or create indicator container inside a sidebar li
// ---------------------------------------------------------------------------

function getOrCreateIndicatorSlot(li: HTMLElement): HTMLElement {
  let slot = li.querySelector(".subagent-indicator-slot") as HTMLElement | null;
  if (!slot) {
    slot = document.createElement("span");
    slot.className = "subagent-indicator-slot";
    // Insert after .tab-notif (grid-column 4), before .terminal-entry-actions
    // The grid has 5 columns: [dot][label][count-pill][tab-notif][actions]
    // We append into .terminal-entry-row after tab-notif
    const row = li.querySelector(".terminal-entry-row") as HTMLElement | null;
    if (row) {
      const actions = row.querySelector(".terminal-entry-actions");
      if (actions) {
        row.insertBefore(slot, actions);
      } else {
        row.appendChild(slot);
      }
    }
  }
  return slot;
}

// ---------------------------------------------------------------------------
// DOM: render indicator into the slot
// ---------------------------------------------------------------------------

function renderIndicator(tabId: number): void {
  const li = document.querySelector(
    `#terminal-list [data-id="${tabId}"]`
  ) as HTMLElement | null;
  if (!li) return;

  const { count, agents } = getGroupInfo(tabId);

  const slot = getOrCreateIndicatorSlot(li);

  if (count === 0) {
    // AC3.1: count=0 → hide
    slot.style.display = "none";
    slot.innerHTML = "";
    // Close popover if it was for this tab
    if (activePopoverTabId === tabId) {
      closePopover();
    }
    return;
  }

  slot.style.display = "inline-flex";
  slot.innerHTML = "";

  // Dot
  const dot = document.createElement("span");
  dot.className = "sa-dot";
  slot.appendChild(dot);

  // Count badge: only when count >= 2 (AC3.1)
  if (count >= 2) {
    const badge = document.createElement("span");
    badge.className = "sa-count";
    badge.textContent = String(count);
    slot.appendChild(badge);
  }

  // Hover events — attach to the slot element
  slot.onmouseenter = () => openPopover(tabId, slot, agents);
  slot.onmouseleave = (e) => {
    // Don't close if mouse is moving into the popover itself
    const related = e.relatedTarget as Node | null;
    if (activePopover && related && activePopover.contains(related)) return;
    closePopover();
  };

  // If popover was open for this tab, refresh it
  if (activePopoverTabId === tabId && activePopover) {
    refreshPopoverContent(activePopover, agents);
  }
}

// ---------------------------------------------------------------------------
// Popover
// ---------------------------------------------------------------------------

function openPopover(
  tabId: number,
  anchorEl: HTMLElement,
  agents: GroupSubagentInfo["agents"]
): void {
  // Reuse existing popover if same tab
  if (activePopoverTabId === tabId && activePopover) {
    refreshPopoverContent(activePopover, agents);
    return;
  }
  closePopover();

  if (agents.length === 0) return;

  const popover = document.createElement("div");
  popover.className = "sa-popover";
  popover.setAttribute("role", "tooltip");

  refreshPopoverContent(popover, agents);

  // Keep popover open when mouse is inside it
  popover.addEventListener("mouseenter", () => {
    // No-op: closing is handled by mouseleave on slot
  });
  popover.addEventListener("mouseleave", () => {
    closePopover();
  });

  document.body.appendChild(popover);
  activePopover = popover;
  activePopoverTabId = tabId;

  // Position relative to anchor
  positionPopover(popover, anchorEl);
}

function positionPopover(popover: HTMLElement, anchorEl: HTMLElement): void {
  const rect = anchorEl.getBoundingClientRect();
  // Show to the right of the sidebar (which is on the left)
  const top = rect.bottom + 4;
  const left = rect.left;

  popover.style.top = `${top}px`;
  popover.style.left = `${left}px`;

  // Ensure popover doesn't go off-screen to the right
  requestAnimationFrame(() => {
    const pw = popover.offsetWidth;
    const vw = window.innerWidth;
    if (left + pw > vw - 8) {
      popover.style.left = `${Math.max(8, vw - pw - 8)}px`;
    }
  });
}

function refreshPopoverContent(
  popover: HTMLElement,
  agents: GroupSubagentInfo["agents"]
): void {
  popover.innerHTML = "";

  if (agents.length === 0) {
    closePopover();
    return;
  }

  const title = document.createElement("div");
  title.className = "sa-popover-title";
  title.textContent = `${agents.length} active subagent${agents.length !== 1 ? "s" : ""}`;
  popover.appendChild(title);

  for (const agent of agents) {
    const row = document.createElement("div");
    row.className = "sa-popover-row";

    const bullet = document.createElement("span");
    bullet.className = "sa-popover-bullet";
    bullet.textContent = "▸";

    const info = document.createElement("span");
    info.className = "sa-popover-info";

    const type = agent.agent_type || "general-purpose";
    const desc = agent.task_description
      ? truncate(agent.task_description, 40)
      : "";
    const elapsed = formatElapsed(agent.started_at);

    info.textContent = desc ? `${type} · ${desc} (${elapsed})` : `${type} (${elapsed})`;

    row.appendChild(bullet);
    row.appendChild(info);
    popover.appendChild(row);
  }
}

function closePopover(): void {
  if (activePopover) {
    activePopover.remove();
    activePopover = null;
  }
  activePopoverTabId = null;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

// ---------------------------------------------------------------------------
// Update all group indicators
// ---------------------------------------------------------------------------

function updateAllIndicators(): void {
  for (const tabId of tabMap.keys()) {
    renderIndicator(tabId);
  }
}

// ---------------------------------------------------------------------------
// IPC integration
// ---------------------------------------------------------------------------

function handleSubagentStatus(payload: SubagentStatusPayload): void {
  subagentPtyState.set(Number(payload.ptyId), payload);

  // Find which tab owns this pty
  const tabId = ptyToTab.get(Number(payload.ptyId));
  if (tabId !== undefined) {
    renderIndicator(tabId);
  }
}

// ---------------------------------------------------------------------------
// PTY cleanup (called from renderer when pane is destroyed)
// ---------------------------------------------------------------------------

function cleanupSubagentForPty(ptyId: number): void {
  subagentPtyState.delete(ptyId);
  // Re-render the owning group (ptyToTab may already be cleaned up, so scan all)
  updateAllIndicators();
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function initSubagentIndicator(): Promise<void> {
  // Load initial snapshot
  try {
    const snapshot = await window.terminalAPI.getSubagentSnapshot();
    for (const payload of snapshot) {
      subagentPtyState.set(Number(payload.ptyId), payload);
    }
  } catch (e) {
    console.warn("[subagent-indicator] Failed to load snapshot:", e);
  }

  // Subscribe to live updates
  window.terminalAPI.onSubagentStatus((payload: SubagentStatusPayload) => {
    handleSubagentStatus(payload);
  });

  // Initial render
  updateAllIndicators();
}
