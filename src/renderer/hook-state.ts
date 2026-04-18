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

function transitionPaneState(leaf: PaneLeaf, event: string, message?: string): AgentHookState {
  const current = leaf.agentState;
  let next: AgentHookState = current;

  switch (event) {
    case "PreToolUse":
      next = "working";
      break;
    case "PostToolUse":
      next = "working";
      break;
    case "Notification":
      // Notification = Claude가 사용자 주의를 요하는 이벤트 → 항상 waiting_approval
      // (message 필드 유무/내용과 무관하게 승인 대기로 처리)
      next = "waiting_approval";
      break;
    case "Stop":
      next = "idle";
      break;
  }

  return next;
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
      marker.textContent = "⚠ 승인 필요";
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

  // Sidebar dot: green glow for 8s
  const li = document.querySelector(`#terminal-list [data-id="${tabId}"]`) as HTMLElement | null;
  if (li) {
    let dot = li.querySelector(".sidebar-agent-dot") as HTMLElement | null;
    if (!dot) {
      dot = document.createElement("span");
      dot.className = "sidebar-agent-dot";
      const row = li.querySelector(".terminal-entry-row");
      const labelEl = li.querySelector(".terminal-label");
      if (labelEl && row) row.insertBefore(dot, labelEl);
      else if (row) row.prepend(dot);
    }
    dot.classList.remove("dot-pulse");
    dot.classList.add("dot-done");
    setTimeout(() => { dot!.classList.remove("dot-done"); }, 8000);
  }

  // Pane header: ✓ 완료 marker for 5s
  const marker = getOrCreateHookMarker(leaf);
  marker.className = "hook-state-marker hook-state-done";
  marker.textContent = "✓ 완료";
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
// Sidebar agent dot pulse for waiting_approval
// ---------------------------------------------------------------------------

function updateSidebarDotPulse(tabId: number, pulse: boolean): void {
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

  // Find first Claude-running pane not yet mapped to any session_id
  const mappedPtyIds = new Set(hookSessionMap.values());
  for (const [tabId, tab] of tabMap.entries()) {
    const leaves = getAllLeaves(tab.root);
    for (const leaf of leaves) {
      if (leaf.agentStatus && !mappedPtyIds.has(leaf.ptyId)) {
        // Assign this session_id to this pane
        hookSessionMap.set(sessionId, leaf.ptyId);
        leaf.hookSessionId = sessionId;
        return { leaf, tabId };
      }
    }
  }

  // Fallback: if no Claude-running pane found, try any pane in the active tab
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
    showHookToast(`⚠ Claude가 입력을 기다립니다 — ${tabLabel}`, "warn");
    updateSidebarDotPulse(tabId, true);
    window.terminalAPI.notifyApproval();
    updateClaudeStatusCounter();
    logActivity({ type: "waiting_approval", tabId, tabLabel });
  }

  if (prevState !== "working" && newState === "working") {
    updateClaudeStatusCounter();
  }

  if (prevState !== "idle" && prevState !== "done" && newState === "idle") {
    showHookToast(`✓ Claude 완료 — ${tabLabel}`, "done");
    updateSidebarDotPulse(tabId, false);
    showDoneGlow(tabId, leaf);
    updateClaudeStatusCounter();
    logActivity({ type: "done", tabId, tabLabel });
  }

  if (prevState === "waiting_approval" && newState !== "waiting_approval") {
    updateSidebarDotPulse(tabId, false);
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
