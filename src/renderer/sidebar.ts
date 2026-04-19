/// <reference path="./global.d.ts" />
/// <reference path="./pane-types.d.ts" />

// --- Sidebar Management ---
// Event delegation: ONE set of listeners on #terminal-list, dispatched by target traversal.
// Per-entry state (draggedTabId) is kept as module variables.

let draggedTabId: number | null = null;

// ---------------------------------------------------------------------------
// Card dot state helper — called by agent-status.ts and hook-state.ts
// ---------------------------------------------------------------------------

function applySidebarDotState(dotEl: HTMLElement): void {
  const state = dotEl.getAttribute("data-state") || "idle";
  dotEl.className = "card-dot-status";
  switch (state) {
    case "running":
      dotEl.classList.add("dot-running");
      dotEl.title = "Claude is running";
      break;
    case "waiting":
      dotEl.classList.add("dot-waiting");
      dotEl.title = "Waiting for approval";
      break;
    case "done":
      dotEl.classList.add("dot-done-flash");
      dotEl.title = "Done";
      break;
    default:
      dotEl.classList.add("dot-idle");
      dotEl.title = "Idle";
      break;
  }
}

function setSidebarDotState(tabId: number, state: "idle" | "running" | "waiting" | "done"): void {
  const li = document.querySelector(`#terminal-list [data-id="${tabId}"]`) as HTMLElement | null;
  if (!li) return;
  const dotEl = li.querySelector(".card-dot-status") as HTMLElement | null;
  if (!dotEl) return;
  dotEl.setAttribute("data-state", state);
  applySidebarDotState(dotEl);
}

// Update count pill with pane count for a tab
function updateSidebarCountPill(tabId: number): void {
  const li = document.querySelector(`#terminal-list [data-id="${tabId}"]`) as HTMLElement | null;
  if (!li) return;
  const pill = li.querySelector(".card-count-pill") as HTMLElement | null;
  if (!pill) return;

  const tab = tabMap.get(tabId);
  if (!tab) return;
  const count = getAllLeaves(tab.root).length;
  pill.textContent = String(count);
  // Reset to default style (agent-status may override later)
  pill.className = "card-count-pill";
}

// ---------------------------------------------------------------------------
// Event delegation — attached once to #terminal-list
// ---------------------------------------------------------------------------

function initSidebarDelegation(): void {
  // Guard: only install once (safe to call again after hot-reload without effect)
  if ((terminalList as any).__delegationInstalled) return;
  (terminalList as any).__delegationInstalled = true;

  // Helper: walk up from target to find the closest .terminal-entry li
  function closestEntry(el: EventTarget | null): HTMLLIElement | null {
    if (!(el instanceof Element)) return null;
    return el.closest(".terminal-entry") as HTMLLIElement | null;
  }

  // Helper: get tabId from li
  function getTabId(li: HTMLLIElement): number | null {
    const id = Number(li.dataset.id);
    return isNaN(id) ? null : id;
  }

  // --- click ---
  terminalList.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;

    // btn-close
    if (target.closest(".btn-close")) {
      const li = closestEntry(target);
      if (!li) return;
      const tabId = getTabId(li);
      if (tabId === null) return;
      e.stopPropagation();
      closeTab(tabId);
      return;
    }

    // btn-notes
    if (target.closest(".btn-notes")) {
      const li = closestEntry(target);
      if (!li) return;
      const tabId = getTabId(li);
      if (tabId === null) return;
      e.stopPropagation();
      openNotesPanel(tabId);
      return;
    }

    // rename-input (ignore clicks inside active rename field)
    if (target.closest(".rename-input")) return;

    // entry click → switch tab
    const li = closestEntry(target);
    if (!li) return;
    const tabId = getTabId(li);
    if (tabId === null) return;
    switchToTab(tabId);
  });

  // --- dblclick (rename) ---
  terminalList.addEventListener("dblclick", (e) => {
    const target = e.target as HTMLElement;
    const labelEl = target.closest(".terminal-label") as HTMLSpanElement | null;
    if (!labelEl) return;
    const li = closestEntry(labelEl);
    if (!li) return;
    const tabId = getTabId(li);
    if (tabId === null) return;
    e.preventDefault();
    e.stopPropagation();
    startRename(tabId, li, labelEl);
  });

  // --- drag events ---
  terminalList.addEventListener("dragstart", (e) => {
    const li = closestEntry(e.target);
    if (!li) return;
    const tabId = getTabId(li);
    if (tabId === null) return;
    draggedTabId = tabId;
    li.style.opacity = "0.5";
    e.dataTransfer?.setData("text/plain", String(tabId));
  });

  terminalList.addEventListener("dragend", (e) => {
    const li = closestEntry(e.target);
    if (li) li.style.opacity = "1";
    draggedTabId = null;
  });

  terminalList.addEventListener("dragover", (e) => {
    const li = closestEntry(e.target);
    if (!li) return;
    const tabId = getTabId(li);
    if (tabId === null) return;
    e.preventDefault();
    if (draggedTabId === null || draggedTabId === tabId) return;
    li.style.borderTop = "2px solid #007aff";
  });

  terminalList.addEventListener("dragleave", (e) => {
    const li = closestEntry(e.target);
    if (li) li.style.borderTop = "";
  });

  terminalList.addEventListener("drop", (e) => {
    const li = closestEntry(e.target);
    if (!li) return;
    const tabId = getTabId(li);
    if (tabId === null) return;
    e.preventDefault();
    li.style.borderTop = "";
    if (draggedTabId === null || draggedTabId === tabId) return;
    reorderTabs(draggedTabId, tabId);
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function addSidebarEntry(tabId: number, label: string): void {
  addSidebarEntryDOM(tabId, label);
  // Check for existing notes
  const sk = getTabSessionKey(tabId);
  if (sk) {
    window.terminalAPI.loadNotes(sk).then((notes) => {
      if (notes.length > 0) {
        sessionNotesCache.set(tabId, notes);
        updateNoteIndicator(tabId, true);
      }
    });
  }
}

function reorderTabs(fromTabId: number, toTabId: number): void {
  const fromLi = terminalList.querySelector(`[data-id="${fromTabId}"]`);
  const toLi = terminalList.querySelector(`[data-id="${toTabId}"]`);
  if (!fromLi || !toLi || fromLi === toLi) return;

  // Get current order of sidebar entries
  const entries = Array.from(terminalList.querySelectorAll(".terminal-entry")) as HTMLLIElement[];
  const fromIndex = entries.findIndex(el => el.dataset.id === String(fromTabId));
  const toIndex = entries.findIndex(el => el.dataset.id === String(toTabId));
  if (fromIndex === -1 || toIndex === -1) return;

  // Reorder in DOM
  if (fromIndex < toIndex) {
    toLi.parentNode?.insertBefore(fromLi, toLi.nextSibling);
  } else {
    toLi.parentNode?.insertBefore(fromLi, toLi);
  }

  // Update active indicator if needed
  if (activeTabId !== null) {
    updateSidebarActive(activeTabId);
  }

  saveSessionMetadata();
}

function renderSidebar(): void {
  terminalList.innerHTML = "";

  // Get tabs in DOM order (at render time, tabMap keys are the source of truth)
  const tabIds = Array.from(tabMap.keys());

  // Group tabs by cluster
  const clusters = new Map<string, number[]>();
  const noCluster: number[] = [];

  for (const tabId of tabIds) {
    const cluster = tabClusters.get(tabId);
    if (cluster) {
      if (!clusters.has(cluster)) clusters.set(cluster, []);
      clusters.get(cluster)!.push(tabId);
    } else {
      noCluster.push(tabId);
    }
  }

  // Render no-cluster tabs first
  for (const tabId of noCluster) {
    const label = tabLabels.get(tabId) || `Terminal ${tabId}`;
    addSidebarEntryDOM(tabId, label);
  }

  // Render clusters
  for (const [clusterName, clusterTabIds] of clusters) {
    const header = document.createElement("li");
    header.className = "sidebar-cluster-header";
    header.textContent = clusterName;
    terminalList.appendChild(header);

    for (const tabId of clusterTabIds) {
      const label = tabLabels.get(tabId) || `Terminal ${tabId}`;
      addSidebarEntryDOM(tabId, label);
    }
  }
}

function addSidebarEntryDOM(tabId: number, label: string): void {
  // Ensure delegation is installed (idempotent)
  initSidebarDelegation();

  const li = document.createElement("li");
  li.dataset.id = String(tabId);
  li.className = "terminal-entry";
  li.draggable = true;

  // Project card layout:
  // Row 1: [dot-status] [name + tab-notif] [count pill] [actions]
  // Row 2: [meta: git + changes + ahead]
  li.innerHTML = `
    <div class="terminal-entry-row">
      <span class="card-dot-status" title="idle"></span>
      <span class="terminal-label">${escapeHtml(label)}</span>
      <span class="tab-notif hidden"></span>
      <span class="card-count-pill">1</span>
      <div class="terminal-entry-actions">
        <button class="btn-notes" title="Notes">&#9998;</button>
        <button class="btn-close" title="Close terminal">&times;</button>
      </div>
    </div>
    <div class="card-meta" style="display:none">
      <span class="card-meta-git"></span>
      <span class="card-meta-changes" style="display:none"></span>
      <span class="card-meta-ahead" style="display:none"></span>
    </div>
  `;

  // No per-entry event listeners — all handled by delegation above
  terminalList.appendChild(li);
}

function startRename(
  tabId: number,
  li: HTMLLIElement,
  labelEl: HTMLSpanElement
): void {
  // Use tabLabels map as source of truth (textContent may include injected elements)
  const currentName = tabLabels.get(tabId) || labelEl.textContent || "";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "rename-input";
  input.value = currentName;

  labelEl.style.display = "none";
  const labelRow = labelEl.parentElement ?? li;
  labelRow.insertBefore(input, labelEl);

  // Delay focus so double-click event chain completes before we steal focus
  setTimeout(() => {
    input.focus();
    input.select();
  }, 0);

  let committed = false;
  const commit = async () => {
    if (committed) return;
    committed = true;
    const newName = input.value.trim() || currentName;
    labelEl.textContent = newName;
    labelEl.style.display = "";
    input.remove();
    tabLabels.set(tabId, newName);
    // Update titlebar if this is the active tab
    if (tabId === activeTabId && typeof updateTitlebarGroupName === "function") {
      updateTitlebarGroupName(tabId);
    }
    await saveSessionMetadata();
  };

  const cancel = () => {
    if (committed) return;
    committed = true;
    labelEl.style.display = "";
    input.remove();
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    else if (e.key === "Escape") { e.preventDefault(); cancel(); }
  });

  input.addEventListener("blur", commit);
  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("mousedown", (e) => e.stopPropagation());
}

function removeSidebarEntry(tabId: number): void {
  terminalList.querySelector(`[data-id="${tabId}"]`)?.remove();
}

function updateSidebarActive(tabId: number): void {
  terminalList.querySelectorAll(".terminal-entry").forEach((el) => {
    el.classList.toggle(
      "active",
      (el as HTMLElement).dataset.id === String(tabId)
    );
  });
}

// ---------------------------------------------------------------------------
// Teardown — called from beforeunload / onBeforeQuit
// ---------------------------------------------------------------------------

function teardownSidebarDelegation(): void {
  // The delegation listeners are on terminalList (persistent DOM element).
  // On reload the entire JS context is destroyed; on quit we just log.
  // We mark the flag cleared so reinit works after a soft reload if needed.
  (terminalList as any).__delegationInstalled = false;
  console.log("[sidebar] delegation teardown");
}
