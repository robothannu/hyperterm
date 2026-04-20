/// <reference path="./global.d.ts" />
/// <reference path="./pane-types.d.ts" />

// --- Claude Code Hook State Machine + Global Status Counter ---

// Global counters for statusbar (working / waiting_approval / done-recently)
let _counterWorking = 0;
let _counterWaiting = 0;
let _counterDone = 0; // resets after 10s per item

function updateClaudeStatusCounter(): void {
  // Recount from live state
  let w = 0, a = 0;
  for (const tab of tabMap.values()) {
    for (const leaf of getAllLeaves(tab.root)) {
      if (leaf.agentState === "working") w++;
      else if (leaf.agentState === "waiting_approval") a++;
    }
  }
  _counterWorking = w;
  _counterWaiting = a;
  renderStatusCounter();
}

function renderStatusCounter(): void {
  const el = document.getElementById("claude-status-counter");
  if (!el) return;
  const parts: string[] = [];
  if (_counterWorking > 0) parts.push(`⚙${_counterWorking}`);
  if (_counterWaiting > 0) parts.push(`⚠${_counterWaiting}`);
  if (_counterDone > 0) parts.push(`✓${_counterDone}`);
  el.textContent = parts.join("  ");
  el.style.display = parts.length > 0 ? "" : "none";
}

function bumpDoneCounter(): void {
  _counterDone++;
  renderStatusCounter();
  setTimeout(() => { _counterDone = Math.max(0, _counterDone - 1); renderStatusCounter(); }, 10000);
}
// Receives hook events from main process via IPC.
// Maps session_id → pane, maintains per-pane agentState, updates UI markers.

// session_id → ptyId mapping
const hookSessionMap = new Map<string, number>();

// ptyId → hook state marker element (separate from Sprint 1 "● Claude" marker)
const hookStateMarkers = new Map<number, HTMLElement>();

// ---------------------------------------------------------------------------
// State machine transition
// ---------------------------------------------------------------------------

// Known hook event names
const KNOWN_HOOK_EVENTS = new Set([
  "PreToolUse",
  "PostToolUse",
  "UserPromptSubmit",
  "Notification",
  "Stop",
]);

function isPermissionNotification(message: string): boolean {
  // Claude Code Notification fires for two cases:
  //  - permission request: "Claude needs your permission to use X"
  //  - idle >60s: "Claude is waiting for your input"
  // Only the permission case should flip to waiting_approval.
  const m = message.toLowerCase();
  return m.includes("permission") || m.includes("needs your");
}

function transitionPaneState(leaf: PaneLeaf, event: string, message?: string): AgentHookState {
  const current = leaf.agentState;

  switch (event) {
    case "UserPromptSubmit":
      // User sent a prompt → Claude is now working (even for text-only responses
      // that never fire PreToolUse/PostToolUse)
      return "working";
    case "PreToolUse":
      return "working";
    case "PostToolUse":
      return "working";
    case "Notification":
      if (isPermissionNotification(message || "")) {
        return "waiting_approval";
      }
      // Idle-waiting notification: do not change state
      return current;
    case "Stop":
      return "idle";
    default:
      // Unknown event: log and preserve current state (AC4)
      console.warn("[hook-state] Unknown hook event received:", event);
      return current;
  }
}

// ---------------------------------------------------------------------------
// Marker helpers
// ---------------------------------------------------------------------------

function getOrCreateHookMarker(leaf: PaneLeaf): HTMLElement {
  if (hookStateMarkers.has(leaf.ptyId)) {
    return hookStateMarkers.get(leaf.ptyId)!;
  }
  const header = leaf.element.querySelector(".pane-header") as HTMLElement | null;
  const marker = document.createElement("span");
  marker.className = "hook-state-marker hidden";
  if (header) {
    header.appendChild(marker);
  }
  hookStateMarkers.set(leaf.ptyId, marker);
  return marker;
}

function applyHookMarker(leaf: PaneLeaf): void {
  const marker = getOrCreateHookMarker(leaf);
  marker.className = "hook-state-marker hidden";
  marker.textContent = "";

  switch (leaf.agentState) {
    case "working":
      marker.className = "hook-state-marker hook-state-working";
      marker.textContent = "⚙";
      marker.title = "Claude is working";
      break;
    case "waiting_approval":
      marker.className = "hook-state-marker hook-state-approval";
      marker.textContent = "⚠ Waiting";
      marker.title = "Claude is waiting for approval";
      break;
    case "idle":
    case "done":
      // No marker — hidden class is already set above
      break;
  }
}

function removeHookMarker(ptyId: number): void {
  const marker = hookStateMarkers.get(ptyId);
  if (marker) {
    marker.remove();
    hookStateMarkers.delete(ptyId);
  }
}

// ---------------------------------------------------------------------------
// Done glow (sidebar dot + pane header marker)
// ---------------------------------------------------------------------------

function showDoneGlow(tabId: number, leaf: PaneLeaf): void {
  bumpDoneCounter();

  // Sidebar card dot: done state for 8s
  if (typeof setSidebarDotState === "function") {
    setSidebarDotState(tabId, "done");
    setTimeout(() => {
      setSidebarDotState(tabId, "idle");
    }, 8000);
  }

  // Legacy sidebar-agent-dot fallback
  const li = document.querySelector(`#terminal-list [data-id="${tabId}"]`) as HTMLElement | null;
  if (li) {
    const dot = li.querySelector(".sidebar-agent-dot") as HTMLElement | null;
    if (dot) {
      dot.classList.remove("dot-pulse");
      dot.classList.add("dot-done");
      setTimeout(() => { dot.classList.remove("dot-done"); }, 8000);
    }
  }

  // Pane header: ✓ 완료 marker for 5s
  const marker = getOrCreateHookMarker(leaf);
  marker.className = "hook-state-marker hook-state-done";
  marker.textContent = "✓ Done";
  setTimeout(() => {
    if (leaf.agentState === "idle") {
      marker.className = "hook-state-marker hidden";
      marker.textContent = "";
    }
  }, 5000);
}

// ---------------------------------------------------------------------------
// Toast notification helper
// ---------------------------------------------------------------------------

function showHookToast(message: string, variant: "warn" | "done"): void {
  const el = document.createElement("div");
  el.className = `hook-toast hook-toast-${variant}`;
  el.textContent = message;
  document.body.appendChild(el);
  el.addEventListener("animationend", () => el.remove());
}

// ---------------------------------------------------------------------------
// Tab notification badge (alarm format next to group name)
// ---------------------------------------------------------------------------

function setTabNotifBadge(tabId: number, state: "approval" | "working" | "done" | "clear"): void {
  const li = document.querySelector(`#terminal-list [data-id="${tabId}"]`) as HTMLElement | null;
  if (!li) return;
  const badge = li.querySelector(".tab-notif") as HTMLElement | null;
  if (!badge) return;

  badge.className = "tab-notif";
  switch (state) {
    case "approval":
      badge.textContent = "⚠ Waiting";
      badge.classList.add("notif-approval");
      break;
    case "working":
      badge.textContent = "⚙ Running";
      badge.classList.add("notif-working");
      break;
    case "done":
      badge.textContent = "✓ Done";
      badge.classList.add("notif-done");
      break;
    case "clear":
      badge.classList.add("hidden");
      badge.textContent = "";
      break;
  }
}

// ---------------------------------------------------------------------------
// Sidebar agent dot pulse for waiting_approval
// ---------------------------------------------------------------------------

function updateSidebarDotPulse(tabId: number, pulse: boolean): void {
  // Update card-dot-status (new rich card)
  if (typeof setSidebarDotState === "function") {
    setSidebarDotState(tabId, pulse ? "waiting" : "idle");
  }

  // Legacy sidebar-agent-dot fallback
  const li = document.querySelector(
    `#terminal-list [data-id="${tabId}"]`
  ) as HTMLElement | null;
  if (!li) return;
  const dot = li.querySelector(".sidebar-agent-dot") as HTMLElement | null;
  if (!dot) return;
  if (pulse) {
    dot.classList.add("dot-pulse");
  } else {
    dot.classList.remove("dot-pulse");
  }
}

// ---------------------------------------------------------------------------
// Sidebar tab highlight for waiting_approval
// ---------------------------------------------------------------------------

function updateSidebarHookHighlight(tabId: number): void {
  const li = document.querySelector(
    `#terminal-list [data-id="${tabId}"]`
  ) as HTMLElement | null;
  if (!li) return;

  const tab = tabMap.get(tabId);
  if (!tab) return;

  const leaves = getAllLeaves(tab.root);
  const hasApproval = leaves.some((l) => l.agentState === "waiting_approval");

  if (hasApproval) {
    li.classList.add("sidebar-tab-approval");
  } else {
    li.classList.remove("sidebar-tab-approval");
  }
}

// ---------------------------------------------------------------------------
// Session mapping: find pane for a session_id
// Strategy: if session_id is already mapped → use that pane.
// Otherwise: assign to the first unmapped Claude-running pane across all tabs.
// ---------------------------------------------------------------------------

function findLeafByPtyId(ptyId: number): { leaf: PaneLeaf; tabId: number } | null {
  for (const [tabId, tab] of tabMap.entries()) {
    const leaves = getAllLeaves(tab.root);
    const leaf = leaves.find((l) => l.ptyId === ptyId);
    if (leaf) return { leaf, tabId };
  }
  return null;
}

function findOrAssignLeaf(sessionId: string): { leaf: PaneLeaf; tabId: number } | null {
  // Already mapped?
  if (hookSessionMap.has(sessionId)) {
    const ptyId = hookSessionMap.get(sessionId)!;
    return findLeafByPtyId(ptyId);
  }

  // New session_id: search for an unmapped Claude-running pane.
  // AC2: active tab is searched FIRST, then other tabs as fallback.
  const mappedPtyIds = new Set(hookSessionMap.values());

  // Build ordered tab iteration: active tab first, then the rest
  const orderedTabIds: number[] = [];
  if (activeTabId !== null && tabMap.has(activeTabId)) {
    orderedTabIds.push(activeTabId);
  }
  for (const tabId of tabMap.keys()) {
    if (tabId !== activeTabId) {
      orderedTabIds.push(tabId);
    }
  }

  for (const tabId of orderedTabIds) {
    const tab = tabMap.get(tabId)!;
    const leaves = getAllLeaves(tab.root);
    for (const leaf of leaves) {
      if (leaf.agentStatus && !mappedPtyIds.has(leaf.ptyId)) {
        hookSessionMap.set(sessionId, leaf.ptyId);
        leaf.hookSessionId = sessionId;
        return { leaf, tabId };
      }
    }
  }

  // Fallback: no Claude-running pane found — assign to first pane of active tab
  if (activeTabId !== null) {
    const tab = tabMap.get(activeTabId);
    if (tab) {
      const leaves = getAllLeaves(tab.root);
      if (leaves.length > 0) {
        const leaf = leaves[0];
        hookSessionMap.set(sessionId, leaf.ptyId);
        leaf.hookSessionId = sessionId;
        return { leaf, tabId: activeTabId };
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main event handler
// ---------------------------------------------------------------------------

function handleHookEvent(evt: HookEvent): void {
  // Reject unknown events before any state mutation (AC4)
  if (!KNOWN_HOOK_EVENTS.has(evt.event)) {
    console.warn("[hook-state] Unknown hook event received:", evt.event);
    return;
  }

  const sessionId = evt.session_id || "";

  const found = findOrAssignLeaf(sessionId);
  if (!found) {
    console.warn("[hook-state] No pane found for session_id:", sessionId);
    return;
  }

  const { leaf, tabId } = found;
  const message = evt.message || "";

  const newState = transitionPaneState(leaf, evt.event, message);
  const prevState = leaf.agentState;
  leaf.agentState = newState;

  applyHookMarker(leaf);
  updateSidebarHookHighlight(tabId);

  const tabLabel = tabLabels.get(tabId) || `Terminal ${tabId}`;

  if (prevState !== "waiting_approval" && newState === "waiting_approval") {
    showHookToast(`⚠ Waiting for input — ${tabLabel}`, "warn");
    updateSidebarDotPulse(tabId, true);
    setTabNotifBadge(tabId, "approval");
    if (typeof setSidebarPaneRowState === "function") {
      setSidebarPaneRowState(tabId, leaf.ptyId, "waiting");
    }
    window.terminalAPI.notifyApproval();
    updateClaudeStatusCounter();
  }

  if (prevState !== "working" && newState === "working") {
    setTabNotifBadge(tabId, "working");
    if (typeof setSidebarPaneRowState === "function") {
      setSidebarPaneRowState(tabId, leaf.ptyId, "running");
    }
    updateClaudeStatusCounter();
  }

  if (prevState !== "idle" && prevState !== "done" && newState === "idle") {
    showHookToast(`✓ Done — ${tabLabel}`, "done");
    updateSidebarDotPulse(tabId, false);
    setTabNotifBadge(tabId, "done");
    setTimeout(() => setTabNotifBadge(tabId, "clear"), 5000);
    // Sub-row: show "done" immediately, then revert to "idle" after 8s
    if (typeof setSidebarPaneRowState === "function") {
      setSidebarPaneRowState(tabId, leaf.ptyId, "done");
      const _tabId = tabId;
      const _ptyId = leaf.ptyId;
      setTimeout(() => {
        if (typeof setSidebarPaneRowState === "function") {
          setSidebarPaneRowState(_tabId, _ptyId, "idle");
        }
      }, 8000);
    }
    updateClaudeStatusCounter();
  }

  if (prevState === "waiting_approval" && newState !== "waiting_approval") {
    updateSidebarDotPulse(tabId, false);
    // Sub-row: clear waiting state (will be overwritten by working/idle transitions above if applicable)
    if (typeof setSidebarPaneRowState === "function" && newState !== "working" && newState !== "idle") {
      setSidebarPaneRowState(tabId, leaf.ptyId, "idle");
    }
  }

  // Clean up session mapping when Claude stops
  if (evt.event === "Stop" && sessionId) {
    hookSessionMap.delete(sessionId);
    leaf.hookSessionId = undefined;
  }
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

function initHookState(): void {
  window.terminalAPI.onHookEvent((evt) => {
    handleHookEvent(evt);
  });
}

// Clean up when a pane is destroyed
function cleanupPaneHookMarker(ptyId: number): void {
  removeHookMarker(ptyId);
  // Remove any session_id mapping pointing to this ptyId
  for (const [sessionId, mappedPtyId] of hookSessionMap.entries()) {
    if (mappedPtyId === ptyId) {
      hookSessionMap.delete(sessionId);
    }
  }
}
