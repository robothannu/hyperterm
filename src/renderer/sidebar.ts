/// <reference path="./global.d.ts" />
/// <reference path="./pane-types.d.ts" />

// --- Sidebar Management ---
let draggedTabId: number | null = null;

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

  // Get tabs in DOM order
  const entries = Array.from(terminalList.querySelectorAll(".terminal-entry"));
  const orderedTabIds = entries.map(el => Number(el.getAttribute("data-id"))).filter(id => !isNaN(id));

  // Group tabs by cluster
  const clusters = new Map<string, number[]>();
  const noCluster: number[] = [];

  for (const tabId of orderedTabIds) {
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
  for (const [clusterName, tabIds] of clusters) {
    const header = document.createElement("li");
    header.className = "sidebar-cluster-header";
    header.textContent = clusterName;
    terminalList.appendChild(header);

    for (const tabId of tabIds) {
      const label = tabLabels.get(tabId) || `Terminal ${tabId}`;
      addSidebarEntryDOM(tabId, label);
    }
  }
}

function addSidebarEntryDOM(tabId: number, label: string): void {
  const li = document.createElement("li");
  li.dataset.id = String(tabId);
  li.className = "terminal-entry";
  li.draggable = true;
  li.innerHTML = `
    <div class="terminal-entry-row">
      <span class="terminal-label">${escapeHtml(label)}</span>
      <div class="terminal-entry-actions">
        <button class="btn-notes" title="Notes">&#9998;</button>
        <button class="btn-close" title="Close terminal">&times;</button>
      </div>
    </div>
  `;

  const labelEl = li.querySelector(".terminal-label") as HTMLSpanElement;

  li.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.closest(".terminal-label")) return;
    switchToTab(tabId);
  });

  labelEl.addEventListener("click", (e) => {
    if (e.detail === 2) {
      e.preventDefault();
      e.stopPropagation();
      startRename(tabId, li, labelEl);
    }
  });

  li.querySelector(".btn-notes")!.addEventListener("click", (e) => {
    e.stopPropagation();
    openNotesPanel(tabId);
  });

  li.querySelector(".btn-close")!.addEventListener("click", (e) => {
    e.stopPropagation();
    closeTab(tabId);
  });

  li.addEventListener("dragstart", (e) => {
    draggedTabId = tabId;
    li.style.opacity = "0.5";
    e.dataTransfer?.setData("text/plain", String(tabId));
  });

  li.addEventListener("dragend", () => {
    li.style.opacity = "1";
    draggedTabId = null;
  });

  li.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (draggedTabId === null || draggedTabId === tabId) return;
    li.style.borderTop = "2px solid #007aff";
  });

  li.addEventListener("dragleave", () => {
    li.style.borderTop = "";
  });

  li.addEventListener("drop", (e) => {
    e.preventDefault();
    li.style.borderTop = "";
    if (draggedTabId === null || draggedTabId === tabId) return;
    reorderTabs(draggedTabId, tabId);
  });

  terminalList.appendChild(li);
}

function startRename(
  tabId: number,
  li: HTMLLIElement,
  labelEl: HTMLSpanElement
): void {
  const currentName = labelEl.textContent || "";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "rename-input";
  input.value = currentName;

  labelEl.style.display = "none";
  const labelRow = labelEl.parentElement ?? li;
  labelRow.insertBefore(input, labelEl);
  input.focus();
  input.select();

  const commit = async () => {
    const newName = input.value.trim() || currentName;
    labelEl.textContent = newName;
    labelEl.style.display = "";
    input.remove();
    tabLabels.set(tabId, newName);
    await saveSessionMetadata();
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      labelEl.style.display = "";
      input.remove();
    }
  });

  input.addEventListener("blur", commit);
  input.addEventListener("click", (e) => e.stopPropagation());
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
