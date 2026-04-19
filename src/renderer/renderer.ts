/// <reference path="./global.d.ts" />
/// <reference path="./pane-types.d.ts" />
/// <reference path="./terminal-session.ts" />

// --- Global State ---

const sessions = new Map<number, TerminalSession>();
const sessionKeys = new Map<number, string>();
const tabMap = new Map<number, Tab>();
const tabLabels = new Map<number, string>();
const ptyToTab = new Map<number, number>();
const tabClusters = new Map<number, string>();
let activeTabId: number | null = null;
let sessionCounter = 0;

const terminalPane = document.getElementById("terminal-pane")!;
const terminalList = document.getElementById("terminal-list")!;
const btnNew = document.getElementById("btn-new-terminal")!;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function nextTerminalName(): string {
  sessionCounter++;
  return `Terminal ${sessionCounter}`;
}

// Cluster modal
const clusterModal = document.getElementById("cluster-modal")!;
const clusterInput = document.getElementById("cluster-input") as HTMLInputElement;
const clusterOk = document.getElementById("cluster-ok")!;
const clusterCancel = document.getElementById("cluster-cancel")!;
const clusterClear = document.getElementById("cluster-clear")!;

const helpModal = document.getElementById("help-modal")!;
const helpClose = document.getElementById("help-close")!;

const aboutModal = document.getElementById("about-modal")!;
const aboutClose = document.getElementById("about-close")!;

function showHelpGuide(): void {
  helpModal.classList.remove("hidden");
}

function closeHelpGuide(): void {
  helpModal.classList.add("hidden");
}

function showAbout(): void {
  aboutModal.classList.remove("hidden");
}

function closeAbout(): void {
  aboutModal.classList.add("hidden");
}

function showClusterDialog(currentName: string = ""): Promise<string | null> {
  return new Promise((resolve) => {
    clusterInput.value = currentName;
    clusterModal.classList.remove("hidden");
    clusterInput.focus();
    clusterInput.select();

    function cleanup() {
      clusterModal.classList.add("hidden");
      clusterOk.removeEventListener("click", onOk);
      clusterCancel.removeEventListener("click", onCancel);
      clusterClear.removeEventListener("click", onClear);
      clusterInput.removeEventListener("keydown", onKey);
      clusterModal.removeEventListener("click", onOverlay);
    }

    function onOk() {
      const name = clusterInput.value.trim();
      cleanup();
      resolve(name || null);
    }

    function onCancel() {
      cleanup();
      resolve(null);
    }

    function onClear() {
      cleanup();
      resolve(""); // Empty string means clear cluster
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Enter") {
        e.preventDefault();
        onOk();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    }

    function onOverlay(e: MouseEvent) {
      if (e.target === clusterModal) onCancel();
    }

    clusterOk.addEventListener("click", onOk);
    clusterCancel.addEventListener("click", onCancel);
    clusterClear.addEventListener("click", onClear);
    clusterInput.addEventListener("keydown", onKey);
    clusterModal.addEventListener("click", onOverlay);
  });
}

// --- Help & About Modals ---

helpClose.addEventListener("click", closeHelpGuide);
helpModal.addEventListener("click", (e) => {
  if (e.target === helpModal) closeHelpGuide();
});

aboutClose.addEventListener("click", closeAbout);
aboutModal.addEventListener("click", (e) => {
  if (e.target === aboutModal) closeAbout();
});

// --- Pane Focus ---

function setFocusedPane(ptyId: number): void {
  document
    .querySelectorAll(".pane-leaf.focused")
    .forEach((el) => el.classList.remove("focused"));

  for (const tab of tabMap.values()) {
    const leaf = findLeaf(tab.root, ptyId);
    if (leaf) {
      leaf.element.classList.add("focused");
      leaf.session.focus();
      tab.focusedPtyId = ptyId;
      break;
    }
  }
}

// --- Core Functions ---

async function createPaneSession(
  parentElement: HTMLElement,
  cwd?: string
): Promise<PaneLeaf> {
  const paneElement = document.createElement("div");
  paneElement.className = "pane-leaf";
  parentElement.appendChild(paneElement);

  // Pane header showing session name
  const paneHeader = document.createElement("div");
  paneHeader.className = "pane-header";
  paneElement.appendChild(paneHeader);

  const paneTitle = document.createElement("span");
  paneTitle.className = "pane-title";
  paneTitle.textContent = "...";
  paneHeader.appendChild(paneTitle);

  const termContainer = document.createElement("div");
  termContainer.className = "terminal-container";
  paneElement.appendChild(termContainer);

  const session = new TerminalSession(termContainer);

  let cols: number;
  let rows: number;
  try {
    session.open();
    cols = session.getCols();
    rows = session.getRows();
  } catch (err) {
    // session.open() throws if xterm.js fails to initialize
    paneElement.remove();
    session.dispose();
    throw err;
  }

  let ptyId: number;
  let sessionKey: string;

  try {
    const result = await window.terminalAPI.createPty(cols, rows, cwd);
    ptyId = result.id;
    sessionKey = result.sessionKey;
  } catch (err) {
    // Clean up DOM and session on failure
    paneElement.remove();
    session.dispose();
    throw err;
  }

  sessions.set(ptyId, session);
  sessionKeys.set(ptyId, sessionKey);

  // Set initial pane title to "Terminal"
  paneTitle.textContent = "Terminal";

  // Double-click pane header to rename
  paneTitle.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    const current = paneTitle.textContent || "";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "pane-title-input";
    input.value = current;
    paneTitle.style.display = "none";
    paneHeader.insertBefore(input, paneTitle);
    input.focus();
    input.select();

    const commit = async () => {
      const newName = input.value.trim() || current;
      paneTitle.style.display = "";
      input.remove();
      paneTitle.textContent = newName;
      paneTitle.setAttribute("data-custom-name", "true");
      await saveSessionMetadata();
    };

    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); commit(); }
      else if (ev.key === "Escape") { ev.preventDefault(); paneTitle.style.display = ""; input.remove(); }
    });
    input.addEventListener("blur", commit);
    input.addEventListener("click", (ev) => ev.stopPropagation());
  });

  session.onData((data: string) => {
    window.terminalAPI.writePty(ptyId, data);
  });

  session.onResize((size: { cols: number; rows: number }) => {
    window.terminalAPI.resizePty(ptyId, size.cols, size.rows);
  });

  // Click to focus this pane (only when switching panes, not when already focused)
  paneElement.addEventListener("mousedown", () => {
    const tabId = ptyToTab.get(ptyId);
    if (tabId === undefined) return;
    const tab = tabMap.get(tabId);
    if (tab && tab.focusedPtyId !== ptyId) {
      setFocusedPane(ptyId);
    }
  });

  return { type: "leaf", ptyId, session, element: paneElement, agentStatus: false, agentState: "idle" };
}

async function createNewTab(
  label?: string,
  cwd?: string
): Promise<number | null> {
  const displayLabel = label || `Terminal ${sessionCounter}`;

  const tabContainer = document.createElement("div");
  tabContainer.className = "tab-container";
  terminalPane.appendChild(tabContainer);

  // Show this container for xterm measurement, hide others
  for (const t of tabMap.values()) t.container.style.display = "none";
  tabContainer.style.display = "flex";

  try {
    const leaf = await createPaneSession(tabContainer, cwd);
    const tabId = leaf.ptyId;
    ptyToTab.set(leaf.ptyId, tabId);

    const tab: Tab = {
      id: tabId,
      root: leaf,
      container: tabContainer,
      focusedPtyId: leaf.ptyId,
    };

    tabMap.set(tabId, tab);
    tabLabels.set(tabId, displayLabel);

    addSidebarEntry(tabId, displayLabel);
    switchToTab(tabId);
    await saveSessionMetadata();
    return tabId;
  } catch (err: unknown) {
    console.error("[renderer] Failed to create tab:", err instanceof Error ? err.message : String(err));
    tabContainer.remove();
    return null;
  }
}

function switchToTab(tabId: number): void {
  // Hide ALL other tabs to prevent leaking across groups
  for (const tab of tabMap.values()) {
    if (tab.id !== tabId) {
      tab.container.style.display = "none";
    }
  }

  const target = tabMap.get(tabId);
  if (target) {
    target.container.style.display = "flex";
    activeTabId = tabId;

    requestAnimationFrame(() => {
      resizeAllPanes(target.root);
      setFocusedPane(target.focusedPtyId);
    });
  }

  updateSidebarActive(tabId);
  // Refresh Changed Files panel for the newly active tab
  if (typeof refreshChangedFilesPanel === "function") {
    refreshChangedFilesPanel();
  }
}

async function splitFocusedPane(
  direction: "horizontal" | "vertical"
): Promise<void> {
  if (activeTabId === null) return;
  const tab = tabMap.get(activeTabId);
  if (!tab) return;

  const focusedPty = tab.focusedPtyId;
  const leaf = findLeaf(tab.root, focusedPty);
  if (!leaf) return;

  // Create split container
  const splitElement = document.createElement("div");
  splitElement.className = `pane-split ${direction}`;

  // Replace leaf in DOM with split, then put leaf inside split
  leaf.element.replaceWith(splitElement);
  splitElement.appendChild(leaf.element);

  // Add divider
  const divider = document.createElement("div");
  divider.className = `pane-divider ${direction}`;
  splitElement.appendChild(divider);

  // Create new pane
  const newLeaf = await createPaneSession(splitElement);
  ptyToTab.set(newLeaf.ptyId, tab.id);

  // Build split node
  const splitNode: PaneSplit = {
    type: "split",
    direction,
    ratio: 0.5,
    children: [leaf, newLeaf],
    element: splitElement,
    divider,
  };
  applyRatio(splitNode);

  // Update tree
  const parentInfo = findLeafParent(tab.root, focusedPty);
  if (parentInfo) {
    parentInfo.parent.children[parentInfo.index] = splitNode;
  } else {
    tab.root = splitNode;
  }

  setupDividerDrag(splitNode);

  requestAnimationFrame(() => {
    resizeAllPanes(tab.root);
    setFocusedPane(newLeaf.ptyId);
  });

  await saveSessionMetadata();
}

function closePaneByPtyId(ptyId: number): void {
  const tabId = ptyToTab.get(ptyId);
  if (tabId === undefined) return;

  const tab = tabMap.get(tabId);
  if (!tab) return;

  // If root is the only pane, close the whole tab
  if (tab.root.type === "leaf" && tab.root.ptyId === ptyId) {
    closeTab(tabId);
    return;
  }

  // Find parent split
  const parentInfo = findLeafParent(tab.root, ptyId);
  if (!parentInfo) return;

  const siblingIndex = parentInfo.index === 0 ? 1 : 0;
  const sibling = parentInfo.parent.children[siblingIndex];

  // Replace split element with sibling in DOM and reset flex so it fills the space
  sibling.element.style.flex = "1 1 0px";
  parentInfo.parent.element.replaceWith(sibling.element);

  // Update tree
  const grandParent = findSplitParent(tab.root, parentInfo.parent);
  if (grandParent) {
    grandParent.parent.children[grandParent.index] = sibling;
  } else {
    tab.root = sibling;
  }

  // Clean up closed pane
  window.terminalAPI.destroyPty(ptyId);
  sessions.get(ptyId)?.dispose();
  sessions.delete(ptyId);
  sessionKeys.delete(ptyId);
  ptyToTab.delete(ptyId);
  cleanupPaneAgentMarker(ptyId);
  cleanupPaneHookMarker(ptyId);

  // Update focus
  const leaves = getAllLeaves(tab.root);
  if (leaves.length > 0) {
    tab.focusedPtyId = leaves[0].ptyId;
    requestAnimationFrame(() => {
      resizeAllPanes(tab.root);
      setFocusedPane(tab.focusedPtyId);
    });
  }

  saveSessionMetadata();
}

function closeTab(tabId: number): void {
  const tab = tabMap.get(tabId);
  if (!tab) return;

  // Close notes panel if open for this tab
  if (notesPanelTabId === tabId) closeNotesPanel();

  // Delete notes for this tab
  const firstLeaf = getAllLeaves(tab.root)[0];
  if (firstLeaf) {
    const sk = sessionKeys.get(firstLeaf.ptyId);
    if (sk) window.terminalAPI.deleteSessionNotes(sk);
  }
  sessionNotesCache.delete(tabId);

  // Destroy all panes
  for (const leaf of getAllLeaves(tab.root)) {
    cleanupPaneAgentMarker(leaf.ptyId);
    cleanupPaneHookMarker(leaf.ptyId);
    window.terminalAPI.destroyPty(leaf.ptyId);
    leaf.session.dispose();
    sessions.delete(leaf.ptyId);
    sessionKeys.delete(leaf.ptyId);
    ptyToTab.delete(leaf.ptyId);
  }

  tab.container.remove();
  tabMap.delete(tabId);
  tabLabels.delete(tabId);
  tabClusters.delete(tabId);
  removeSidebarEntry(tabId);
  cleanupGitBadge(tabId);

  if (activeTabId === tabId) {
    activeTabId = null;
    const remaining = Array.from(tabMap.keys());
    if (remaining.length > 0) {
      switchToTab(remaining[remaining.length - 1]);
    }
  }

  if (tabMap.size === 0) {
    activeTabId = null;
    tabLabels.clear();
    tabClusters.clear();
    sessionKeys.clear();
    sessionNotesCache.clear();
    if (notesPanelTabId !== null) closeNotesPanel();
    terminalList.innerHTML = "";
  }

  saveSessionMetadata();
}

// --- Session Persistence ---

async function serializePaneTree(node: PaneNode): Promise<SavedPaneNode> {
  if (node.type === "leaf") {
    let cwd: string | undefined;
    try { cwd = await window.terminalAPI.getCwd(node.ptyId); } catch { /* ok */ }
    return { type: "leaf", sessionKey: sessionKeys.get(node.ptyId) || "", cwd };
  }
  const [c0, c1] = await Promise.all([
    serializePaneTree(node.children[0]),
    serializePaneTree(node.children[1]),
  ]);
  return { type: "split", direction: node.direction, ratio: node.ratio, children: [c0, c1] };
}

// Pending write for debounce
let _saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let _pendingSave: (() => Promise<void>) | null = null;

async function saveSessionMetadata(): Promise<void> {
  if (_saveDebounceTimer !== null) clearTimeout(_saveDebounceTimer);
  _pendingSave = async () => {
    const tabIds = Array.from(tabMap.keys());
    if (tabIds.length === 0) {
      await window.terminalAPI.saveSessions(JSON.stringify({ version: 3, tabs: [], activeTabIndex: 0 }));
      return;
    }
    let activeTabIndex = 0;
    const savedTabs: SavedTab[] = [];
    for (let i = 0; i < tabIds.length; i++) {
      const tabId = tabIds[i];
      if (tabId === activeTabId) activeTabIndex = i;
      const tab = tabMap.get(tabId)!;
      savedTabs.push({
        label: tabLabels.get(tabId) || `Terminal ${i + 1}`,
        cluster: tabClusters.get(tabId),
        layout: await serializePaneTree(tab.root),
      });
    }
    const state: SavedStateV2 = { version: 3, tabs: savedTabs, activeTabIndex };
    await window.terminalAPI.saveSessions(JSON.stringify(state));
  };
  _saveDebounceTimer = setTimeout(async () => {
    _saveDebounceTimer = null;
    if (_pendingSave) { await _pendingSave(); _pendingSave = null; }
  }, 200);
}

async function flushSessionMetadata(): Promise<void> {
  if (_saveDebounceTimer !== null) { clearTimeout(_saveDebounceTimer); _saveDebounceTimer = null; }
  if (_pendingSave) { await _pendingSave(); _pendingSave = null; }
}

async function restorePaneTree(
  node: SavedPaneNode,
  parentElement: HTMLElement,
  tabId: number
): Promise<PaneNode> {
  if (node.type === "leaf") {
    const leaf = await createPaneSession(parentElement, node.cwd);
    ptyToTab.set(leaf.ptyId, tabId);
    return leaf;
  }

  const splitElement = document.createElement("div");
  splitElement.className = `pane-split ${node.direction}`;
  parentElement.appendChild(splitElement);

  const child1 = await restorePaneTree(node.children[0], splitElement, tabId);

  const divider = document.createElement("div");
  divider.className = `pane-divider ${node.direction}`;
  splitElement.appendChild(divider);

  const child2 = await restorePaneTree(node.children[1], splitElement, tabId);

  const splitNode: PaneSplit = {
    type: "split",
    direction: node.direction,
    ratio: node.ratio,
    children: [child1, child2],
    element: splitElement,
    divider,
  };

  applyRatio(splitNode);
  setupDividerDrag(splitNode);
  return splitNode;
}

async function restoreFromSaved(): Promise<boolean> {
  let savedState: SavedStateV2 | null = null;
  try {
    const raw = await window.terminalAPI.loadSessions();
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.version === 2 || parsed.version === 3) {
        savedState = parsed;
      }
    }
  } catch {
    /* ignore */
  }

  if (!savedState || savedState.tabs.length === 0) return false;

  // Clear sidebar before restoring
  terminalList.innerHTML = "";

  for (const savedTab of savedState.tabs) {
    sessionCounter++;
    const tabContainer = document.createElement("div");
    tabContainer.className = "tab-container";
    terminalPane.appendChild(tabContainer);

    for (const t of tabMap.values()) t.container.style.display = "none";
    tabContainer.style.display = "flex";

    const rootNode = await restorePaneTree(
      savedTab.layout,
      tabContainer,
      -1
    );

    const leaves = getAllLeaves(rootNode);
    if (leaves.length === 0) continue;
    const tabId = leaves[0].ptyId;

    // Fix up tabId in ptyToTab
    for (const leaf of leaves) {
      ptyToTab.set(leaf.ptyId, tabId);
    }

    const tab: Tab = {
      id: tabId,
      root: rootNode,
      container: tabContainer,
      focusedPtyId: tabId,
    };

    tabMap.set(tabId, tab);
    tabLabels.set(tabId, savedTab.label);
    if (savedTab.cluster) {
      tabClusters.set(tabId, savedTab.cluster);
    }
    addSidebarEntry(tabId, savedTab.label);
  }

  // Switch to previously active tab
  const tabIds = Array.from(tabMap.keys());
  if (savedState.activeTabIndex < tabIds.length) {
    switchToTab(tabIds[savedState.activeTabIndex]);
  } else if (tabIds.length > 0) {
    switchToTab(tabIds[0]);
  }

  return tabMap.size > 0;
}

// --- Context Menu ---

const contextMenu = document.getElementById("terminal-context-menu")!;

function showContextMenu(x: number, y: number): void {
  contextMenu.classList.remove("hidden");
  const menuRect = contextMenu.getBoundingClientRect();
  const finalX = Math.min(x, window.innerWidth - menuRect.width - 4);
  const finalY = Math.min(y, window.innerHeight - menuRect.height - 4);
  contextMenu.style.left = `${finalX}px`;
  contextMenu.style.top = `${finalY}px`;
}

function hideContextMenu(): void {
  contextMenu.classList.add("hidden");
}

terminalPane.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  if (activeTabId === null) return;
  showContextMenu(e.clientX, e.clientY);
});

document.addEventListener("mousedown", (e) => {
  if (!contextMenu.contains(e.target as Node)) hideContextMenu();
});

contextMenu.addEventListener("click", async (e) => {
  const target = (e.target as HTMLElement).closest(
    ".context-menu-item"
  ) as HTMLElement | null;
  if (!target || activeTabId === null) return;

  const action = target.dataset.action;
  hideContextMenu();

  switch (action) {
    case "split-horizontal":
      await splitFocusedPane("horizontal");
      break;
    case "split-vertical":
      await splitFocusedPane("vertical");
      break;
    case "close-pane": {
      const tab = tabMap.get(activeTabId);
      if (tab) closePaneByPtyId(tab.focusedPtyId);
      break;
    }
  }
});

// --- Global IPC Listeners ---

window.terminalAPI.onPtyData((id: number, data: string) => {
  sessions.get(id)?.write(data);
});

window.terminalAPI.onPtyExit((id: number, _exitCode: number) => {
  closePaneByPtyId(id);
});

// --- Resize Handling ---

const resizeObserver = new ResizeObserver(() => {
  if (activeTabId !== null) {
    const tab = tabMap.get(activeTabId);
    if (tab) resizeAllPanes(tab.root);
  }
});
resizeObserver.observe(terminalPane);

// --- Lifecycle Teardown ---

function _teardownAll(): void {
  resizeObserver.disconnect();
  console.log("[renderer] ResizeObserver disconnected");

  if (usageRefreshInterval !== null) {
    clearInterval(usageRefreshInterval);
    usageRefreshInterval = null;
    console.log("[renderer] usageRefreshInterval cleared");
  }

  stopAgentPolling();
  console.log("[renderer] agent polling stopped");

  stopGitPolling();
  console.log("[renderer] git polling stopped");

  // Teardown global keydown handler (keybindings.ts)
  if (typeof teardownKeybindings === "function") {
    teardownKeybindings();
  }

  // Teardown sidebar delegation (sidebar.ts)
  if (typeof teardownSidebarDelegation === "function") {
    teardownSidebarDelegation();
  }
}

// Reload / window close (Cmd+R, window unload)
window.addEventListener("beforeunload", () => {
  _teardownAll();
});

// --- Save on Close ---

let usageRefreshInterval: ReturnType<typeof setInterval> | null = null;

window.terminalAPI.onBeforeQuit(async () => {
  await flushSessionMetadata();
  _teardownAll();
  console.log("[renderer] quitReady");
  window.terminalAPI.quitReady();
});

// --- Help Menu IPC ---

window.terminalAPI.onHelpGuide(() => {
  showHelpGuide();
});

window.terminalAPI.onHelpAbout(() => {
  showAbout();
});

// --- Init button ---
// NOTE: app startup (restoreFromSaved, refreshUsage) is called from init.js
// which loads last so all module functions are available.

btnNew.addEventListener("click", () => {
  createNewTab(nextTerminalName());
});
