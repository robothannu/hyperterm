/// <reference path="./global.d.ts" />
/// <reference path="./terminal-session.ts" />

// --- Pane Layout Types ---

interface PaneLeaf {
  type: "leaf";
  ptyId: number;
  session: TerminalSession;
  element: HTMLElement;
}

interface PaneSplit {
  type: "split";
  direction: "horizontal" | "vertical";
  ratio: number;
  children: [PaneNode, PaneNode];
  element: HTMLElement;
  divider: HTMLElement;
}

type PaneNode = PaneLeaf | PaneSplit;

interface Tab {
  id: number;
  root: PaneNode;
  container: HTMLElement;
  focusedPtyId: number;
}

// Persistence types
interface SavedPaneLeaf {
  type: "leaf";
  tmuxName: string;
}
interface SavedPaneSplit {
  type: "split";
  direction: "horizontal" | "vertical";
  ratio: number;
  children: [SavedPaneNode, SavedPaneNode];
}
type SavedPaneNode = SavedPaneLeaf | SavedPaneSplit;
interface SavedTab {
  label: string;
  cluster?: string;
  layout: SavedPaneNode;
}
interface SavedStateV2 {
  version: 3;
  tabs: SavedTab[];
  activeTabIndex: number;
}

interface Note {
  id: number;
  content: string;
  createdAt: string;
}

// --- Global State ---

const sessions = new Map<number, TerminalSession>();
const sessionTmuxNames = new Map<number, string>();
const tabMap = new Map<number, Tab>();
const tabLabels = new Map<number, string>();
const ptyToTab = new Map<number, number>();
const commandPollIntervals = new Map<number, ReturnType<typeof setInterval>>();
const tabClusters = new Map<number, string>();
let activeTabId: number | null = null;
let sessionCounter = 0;

const terminalPane = document.getElementById("terminal-pane")!;
const terminalList = document.getElementById("terminal-list")!;
const btnNew = document.getElementById("btn-new-terminal")!;

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

// --- Pane Tree Helpers ---

function findLeaf(node: PaneNode, ptyId: number): PaneLeaf | null {
  if (node.type === "leaf") return node.ptyId === ptyId ? node : null;
  return findLeaf(node.children[0], ptyId) || findLeaf(node.children[1], ptyId);
}

function findLeafParent(
  node: PaneNode,
  ptyId: number
): { parent: PaneSplit; index: 0 | 1 } | null {
  if (node.type === "leaf") return null;
  for (let i = 0; i < 2; i++) {
    const child = node.children[i as 0 | 1];
    if (child.type === "leaf" && child.ptyId === ptyId) {
      return { parent: node, index: i as 0 | 1 };
    }
    const found = findLeafParent(child, ptyId);
    if (found) return found;
  }
  return null;
}

function findSplitParent(
  root: PaneNode,
  target: PaneSplit
): { parent: PaneSplit; index: 0 | 1 } | null {
  if (root.type === "leaf") return null;
  for (let i = 0; i < 2; i++) {
    if (root.children[i] === target) {
      return { parent: root, index: i as 0 | 1 };
    }
    if (root.children[i].type === "split") {
      const found = findSplitParent(root.children[i], target);
      if (found) return found;
    }
  }
  return null;
}

function getAllLeaves(node: PaneNode): PaneLeaf[] {
  if (node.type === "leaf") return [node];
  return [...getAllLeaves(node.children[0]), ...getAllLeaves(node.children[1])];
}

function resizeAllPanes(node: PaneNode): void {
  if (node.type === "leaf") {
    node.session.fit();
    window.terminalAPI.resizePty(
      node.ptyId,
      node.session.getCols(),
      node.session.getRows()
    );
    return;
  }
  resizeAllPanes(node.children[0]);
  resizeAllPanes(node.children[1]);
}

function applyRatio(split: PaneSplit): void {
  const c1 = split.children[0].element;
  const c2 = split.children[1].element;
  c1.style.flex = `${split.ratio} 1 0px`;
  c2.style.flex = `${1 - split.ratio} 1 0px`;
}

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
  tmuxSession?: string
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
  session.open();

  const cols = session.getCols();
  const rows = session.getRows();

  const result = await window.terminalAPI.createPty(
    cols,
    rows,
    undefined,
    tmuxSession
  );
  const ptyId = result.id;
  const tmuxName = result.tmuxName;

  sessions.set(ptyId, session);
  sessionTmuxNames.set(ptyId, tmuxName);

  // Set initial pane title to tmux session name (only if user hasn't set a custom name)
  window.terminalAPI.getTmuxSessionName(tmuxName).then((name) => {
    if (!paneTitle.hasAttribute("data-custom-name")) {
      paneTitle.textContent = name;
    }
  }).catch(() => {
    // Keep "..." if getTmuxSessionName fails and no custom name is set
  });

  // Poll current pane command and update title (unless custom name set)
  const commandPollInterval = setInterval(async () => {
    if (paneTitle.hasAttribute("data-custom-name")) {
      clearInterval(commandPollInterval);
      commandPollIntervals.delete(ptyId);
      return;
    }
    try {
      const cmd = await window.terminalAPI.getPaneCommand(tmuxName);
      // Show command name if not default shell (bash/zsh), otherwise show session name
      const defaultShells = ["bash", "zsh", "sh", "dash", "fish"];
      if (cmd && !defaultShells.includes(cmd)) {
        paneTitle.textContent = cmd;
      } else {
        const name = await window.terminalAPI.getTmuxSessionName(tmuxName);
        paneTitle.textContent = name;
      }
    } catch {
      // ignore polling errors
    }
  }, 500);
  commandPollIntervals.set(ptyId, commandPollInterval);

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

      // Sync tmux session name
      const oldTmux = sessionTmuxNames.get(ptyId);
      if (oldTmux) {
        const actualName = await window.terminalAPI.renameTmuxSession(oldTmux, newName);
        sessionTmuxNames.set(ptyId, actualName);
        paneTitle.textContent = actualName;
        paneTitle.setAttribute("data-custom-name", "true");
        saveSessionMetadata();
      } else {
        paneTitle.textContent = newName;
        paneTitle.setAttribute("data-custom-name", "true");
      }
    };

    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); commit(); }
      else if (ev.key === "Escape") { ev.preventDefault(); paneTitle.style.display = ""; input.remove(); }
    });
    input.addEventListener("blur", commit);
    input.addEventListener("click", (ev) => ev.stopPropagation());
  });

  session.onData((data: string) => {
    window.terminalAPI.exitCopyMode(tmuxName);
    window.terminalAPI.writePty(ptyId, data);
  });

  // Scroll: capture wheel events before xterm.js and proxy to tmux scrollback
  termContainer.addEventListener("wheel", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const direction = e.deltaY < 0 ? "up" : "down";
    const lines = Math.max(1, Math.round(Math.abs(e.deltaY) / 25));
    window.terminalAPI.scrollTmux(tmuxName, direction, lines);
  }, { capture: true, passive: false });

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

  return { type: "leaf", ptyId, session, element: paneElement };
}

async function createNewTab(
  label?: string,
  tmuxSession?: string
): Promise<number | null> {
  const displayLabel = label || `Terminal ${sessionCounter}`;

  const tabContainer = document.createElement("div");
  tabContainer.className = "tab-container";
  terminalPane.appendChild(tabContainer);

  // Show this container for xterm measurement, hide others
  for (const t of tabMap.values()) t.container.style.display = "none";
  tabContainer.style.display = "flex";

  try {
    const leaf = await createPaneSession(tabContainer, tmuxSession);
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
    saveSessionMetadata();
    return tabId;
  } catch (err: any) {
    console.error("[renderer] Failed to create tab:", err?.message || err);
    tabContainer.remove();
    return null;
  }
}

function switchToTab(tabId: number): void {
  if (activeTabId !== null && activeTabId !== tabId) {
    const current = tabMap.get(activeTabId);
    if (current) current.container.style.display = "none";
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

  saveSessionMetadata();
}

function setupDividerDrag(splitNode: PaneSplit): void {
  splitNode.divider.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();

    const isHoriz = splitNode.direction === "horizontal";
    const cursorStyle = isHoriz ? "col-resize" : "row-resize";
    document.body.style.cursor = cursorStyle;
    document.body.style.userSelect = "none";

    // Overlay prevents terminal panes from capturing mouse events during resize
    const overlay = document.createElement("div");
    overlay.style.cssText = `position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;cursor:${cursorStyle}`;
    document.body.appendChild(overlay);

    const onMove = (e: MouseEvent) => {
      const rect = splitNode.element.getBoundingClientRect();
      let ratio = isHoriz
        ? (e.clientX - rect.left) / rect.width
        : (e.clientY - rect.top) / rect.height;
      ratio = Math.max(0.1, Math.min(0.9, ratio));
      splitNode.ratio = ratio;
      applyRatio(splitNode);
      resizeAllPanes(splitNode);
    };

    const onUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      overlay.remove();
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      saveSessionMetadata();
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
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
  const interval = commandPollIntervals.get(ptyId);
  if (interval) {
    clearInterval(interval);
    commandPollIntervals.delete(ptyId);
  }
  window.terminalAPI.destroyPty(ptyId);
  sessions.get(ptyId)?.dispose();
  sessions.delete(ptyId);
  sessionTmuxNames.delete(ptyId);
  ptyToTab.delete(ptyId);

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
    const tmuxName = sessionTmuxNames.get(firstLeaf.ptyId);
    if (tmuxName) window.terminalAPI.deleteSessionNotes(tmuxName);
  }
  sessionNotesCache.delete(tabId);

  // Destroy all panes
  for (const leaf of getAllLeaves(tab.root)) {
    const interval = commandPollIntervals.get(leaf.ptyId);
    if (interval) {
      clearInterval(interval);
      commandPollIntervals.delete(leaf.ptyId);
    }
    window.terminalAPI.destroyPty(leaf.ptyId);
    leaf.session.dispose();
    sessions.delete(leaf.ptyId);
    sessionTmuxNames.delete(leaf.ptyId);
    ptyToTab.delete(leaf.ptyId);
  }

  tab.container.remove();
  tabMap.delete(tabId);
  tabLabels.delete(tabId);
  removeSidebarEntry(tabId);

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
    sessionTmuxNames.clear();
    sessionNotesCache.clear();
    if (notesPanelTabId !== null) closeNotesPanel();
    terminalList.innerHTML = "";
  }

  saveSessionMetadata();
}

// --- Session Persistence ---

function serializePaneTree(node: PaneNode): SavedPaneNode {
  if (node.type === "leaf") {
    return { type: "leaf", tmuxName: sessionTmuxNames.get(node.ptyId) || "" };
  }
  return {
    type: "split",
    direction: node.direction,
    ratio: node.ratio,
    children: [
      serializePaneTree(node.children[0]),
      serializePaneTree(node.children[1]),
    ],
  };
}

async function saveSessionMetadata(): Promise<void> {
  const tabIds = Array.from(tabMap.keys());
  if (tabIds.length === 0) return;

  let activeTabIndex = 0;
  const savedTabs: SavedTab[] = [];

  for (let i = 0; i < tabIds.length; i++) {
    const tabId = tabIds[i];
    if (tabId === activeTabId) activeTabIndex = i;
    const tab = tabMap.get(tabId)!;
    savedTabs.push({
      label: tabLabels.get(tabId) || `Terminal ${i + 1}`,
      cluster: tabClusters.get(tabId),
      layout: serializePaneTree(tab.root),
    });
  }

  const state: SavedStateV2 = { version: 3, tabs: savedTabs, activeTabIndex };
  await window.terminalAPI.saveSessions(JSON.stringify(state));
}

function getLeafTmuxNames(node: SavedPaneNode): string[] {
  if (node.type === "leaf") return [node.tmuxName];
  return [
    ...getLeafTmuxNames(node.children[0]),
    ...getLeafTmuxNames(node.children[1]),
  ];
}

async function restorePaneTree(
  node: SavedPaneNode,
  parentElement: HTMLElement,
  tabId: number
): Promise<PaneNode> {
  if (node.type === "leaf") {
    const leaf = await createPaneSession(parentElement, node.tmuxName);
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

async function restoreFromTmux(): Promise<boolean> {
  const tmuxAvailable = await window.terminalAPI.isTmuxAvailable();
  if (!tmuxAvailable) return false;

  const liveSessions = await window.terminalAPI.listTmuxSessions();
  if (liveSessions.length === 0) return false;

  // Load saved state
  let savedState: SavedStateV2 | null = null;
  try {
    const raw = await window.terminalAPI.loadSessions();
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.version === 2) {
        savedState = parsed;
      } else if (parsed.sessions) {
        // Convert V1 → V3
        savedState = {
          version: 3,
          tabs: parsed.sessions.map((s: any) => ({
            label: s.label,
            layout: { type: "leaf", tmuxName: s.tmuxName } as SavedPaneLeaf,
          })),
          activeTabIndex: parsed.activeIndex || 0,
        };
      }
    }
  } catch {
    /* ignore */
  }

  const restoredTmuxNames = new Set<string>();

  if (savedState) {
    for (const savedTab of savedState.tabs) {
      const names = getLeafTmuxNames(savedTab.layout);
      const allAlive = names.every((n) => liveSessions.includes(n));

      if (!allAlive) {
        // Restore surviving sessions as individual tabs
        for (const name of names) {
          if (liveSessions.includes(name)) {
            sessionCounter++;
            await createNewTab(savedTab.label, name);
            restoredTmuxNames.add(name);
          }
        }
        continue;
      }

      // Restore full layout
      sessionCounter++;
      const tabContainer = document.createElement("div");
      tabContainer.className = "tab-container";
      terminalPane.appendChild(tabContainer);

      for (const t of tabMap.values()) t.container.style.display = "none";
      tabContainer.style.display = "flex";

      // Use a temporary tabId (first ptyId will be determined during tree restoration)
      const rootNode = await restorePaneTree(
        savedTab.layout,
        tabContainer,
        -1
      );

      const leaves = getAllLeaves(rootNode);
      const tabId = leaves[0].ptyId;

      // Fix up tabId in ptyToTab
      for (const leaf of leaves) {
        ptyToTab.set(leaf.ptyId, tabId);
        restoredTmuxNames.add(sessionTmuxNames.get(leaf.ptyId) || "");
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
  }

  // Restore orphaned live sessions not in saved state
  for (const name of liveSessions) {
    if (!restoredTmuxNames.has(name)) {
      sessionCounter++;
      await createNewTab(name, name);
    }
  }

  // Switch to previously active tab
  const tabIds = Array.from(tabMap.keys());
  if (savedState && savedState.activeTabIndex < tabIds.length) {
    switchToTab(tabIds[savedState.activeTabIndex]);
  } else if (tabIds.length > 0) {
    switchToTab(tabIds[0]);
  }

  return tabMap.size > 0;
}

// --- Notes Panel ---

const notesPanel = document.getElementById("notes-panel")!;
const notesTitle = document.getElementById("notes-title")!;
const notesList = document.getElementById("notes-list")!;
const notesInput = document.getElementById(
  "notes-input"
) as HTMLTextAreaElement;
const notesAddBtn = document.getElementById("notes-add")!;
const notesCloseBtn = document.getElementById("notes-close")!;

let notesPanelTabId: number | null = null;
const sessionNotesCache = new Map<number, Note[]>();

function getTabTmuxName(tabId: number): string | null {
  const tab = tabMap.get(tabId);
  if (!tab) return null;
  const leaves = getAllLeaves(tab.root);
  if (leaves.length === 0) return null;
  return sessionTmuxNames.get(leaves[0].ptyId) || null;
}

function openNotesPanel(tabId: number): void {
  notesPanelTabId = tabId;
  const label = tabLabels.get(tabId) || "Terminal";
  notesTitle.textContent = `Notes \u2014 ${label}`;
  notesPanel.classList.remove("hidden");
  notesInput.value = "";
  loadAndRenderNotes(tabId);
}

function closeNotesPanel(): void {
  notesPanel.classList.add("hidden");
  notesPanelTabId = null;
}

async function loadAndRenderNotes(tabId: number): Promise<void> {
  const tmuxName = getTabTmuxName(tabId);
  if (!tmuxName) return;

  const notes: Note[] = await window.terminalAPI.loadNotes(tmuxName);
  sessionNotesCache.set(tabId, notes);
  renderNotes(notes);
  updateNoteIndicator(tabId, notes.length > 0);
}

function renderNotes(notes: Note[]): void {
  if (notes.length === 0) {
    notesList.innerHTML = '<div class="notes-empty">No notes yet</div>';
    return;
  }

  notesList.innerHTML = "";
  for (let i = notes.length - 1; i >= 0; i--) {
    const note = notes[i];
    const item = document.createElement("div");
    item.className = "note-item";

    const date = new Date(note.createdAt);
    const timeStr = date.toLocaleString();

    item.innerHTML = `
      <div class="note-content">${escapeHtml(note.content)}</div>
      <div class="note-footer">
        <span class="note-time">${timeStr}</span>
        <button class="note-delete" data-id="${note.id}">Delete</button>
      </div>
    `;

    item.querySelector(".note-delete")!.addEventListener("click", () => {
      deleteNote(note.id);
    });

    notesList.appendChild(item);
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

async function addNote(): Promise<void> {
  const content = notesInput.value.trim();
  if (!content || notesPanelTabId === null) return;

  const tmuxName = getTabTmuxName(notesPanelTabId);
  if (!tmuxName) return;

  const notes = sessionNotesCache.get(notesPanelTabId) || [];
  const maxId = notes.reduce((max, n) => Math.max(max, n.id), 0);
  const newNote: Note = {
    id: maxId + 1,
    content,
    createdAt: new Date().toISOString(),
  };

  notes.push(newNote);
  await window.terminalAPI.saveNotes(tmuxName, notes);
  sessionNotesCache.set(notesPanelTabId, notes);
  renderNotes(notes);
  updateNoteIndicator(notesPanelTabId, true);
  notesInput.value = "";
  notesInput.focus();
}

async function deleteNote(noteId: number): Promise<void> {
  if (notesPanelTabId === null) return;

  const tmuxName = getTabTmuxName(notesPanelTabId);
  if (!tmuxName) return;

  let notes = sessionNotesCache.get(notesPanelTabId) || [];
  notes = notes.filter((n) => n.id !== noteId);
  await window.terminalAPI.saveNotes(tmuxName, notes);
  sessionNotesCache.set(notesPanelTabId, notes);
  renderNotes(notes);
  updateNoteIndicator(notesPanelTabId, notes.length > 0);
}

function updateNoteIndicator(tabId: number, hasNotes: boolean): void {
  const li = terminalList.querySelector(`[data-id="${tabId}"]`);
  const btn = li?.querySelector(".btn-notes");
  if (btn) btn.classList.toggle("has-notes", hasNotes);
}

notesCloseBtn.addEventListener("click", closeNotesPanel);
notesAddBtn.addEventListener("click", addNote);
notesInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    addNote();
  }
});

// --- Sidebar Management ---
let draggedTabId: number | null = null;

function addSidebarEntry(tabId: number, label: string): void {
  addSidebarEntryDOM(tabId, label);
  // Check for existing notes
  const tmuxName = getTabTmuxName(tabId);
  if (tmuxName) {
    window.terminalAPI.loadNotes(tmuxName).then((notes) => {
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
    <span class="terminal-label">${label}</span>
    <div class="terminal-entry-actions">
      <button class="btn-notes" title="Notes">&#9998;</button>
      <button class="btn-close" title="Close terminal">&times;</button>
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
  li.insertBefore(input, labelEl);
  input.focus();
  input.select();

  const commit = async () => {
    const newName = input.value.trim() || currentName;
    labelEl.textContent = newName;
    labelEl.style.display = "";
    input.remove();
    tabLabels.set(tabId, newName);
    saveSessionMetadata();
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

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    hideContextMenu();
  }
  // Cmd+Plus: increase font size
  if ((e.key === "+" || e.key === "=") && e.metaKey && !e.shiftKey) {
    e.preventDefault();
    for (const session of sessions.values()) {
      session.increaseFontSize();
    }
    return;
  }
  // Cmd+Minus: decrease font size
  if (e.key === "-" && e.metaKey) {
    e.preventDefault();
    for (const session of sessions.values()) {
      session.decreaseFontSize();
    }
    return;
  }
  // Cmd+0: reset font size
  if (e.key === "0" && e.metaKey) {
    e.preventDefault();
    for (const session of sessions.values()) {
      session.setFontSize(12);
    }
    return;
  }
  // Cmd+N: new terminal
  if (e.key === "n" && e.metaKey && !e.shiftKey && !e.ctrlKey) {
    e.preventDefault();
    createNewTab(nextTerminalName());
    return;
  }
  // Cmd+Arrow: navigate between panes
  if (activeTabId !== null) {
    const tab = tabMap.get(activeTabId);
    if (tab) {
      const tmuxName = sessionTmuxNames.get(tab.focusedPtyId);
      if (tmuxName) {
        if (e.key === "ArrowLeft" && e.metaKey && !e.shiftKey) {
          e.preventDefault();
          window.terminalAPI.navigatePane(tmuxName, "L");
          return;
        }
        if (e.key === "ArrowRight" && e.metaKey && !e.shiftKey) {
          e.preventDefault();
          window.terminalAPI.navigatePane(tmuxName, "R");
          return;
        }
        if (e.key === "ArrowUp" && e.metaKey && !e.shiftKey) {
          e.preventDefault();
          window.terminalAPI.navigatePane(tmuxName, "U");
          return;
        }
        if (e.key === "ArrowDown" && e.metaKey && !e.shiftKey) {
          e.preventDefault();
          window.terminalAPI.navigatePane(tmuxName, "D");
          return;
        }
      }
    }
  }

  // Cmd+Shift+G: set cluster/project name for current tab
  if (e.key === "g" && e.metaKey && e.shiftKey) {
    e.preventDefault();
    if (activeTabId === null) return;
    const currentTabId = activeTabId;
    const currentCluster = tabClusters.get(currentTabId) || "";
    showClusterDialog(currentCluster).then(name => {
      if (name === null) return;
      if (name === "") {
        tabClusters.delete(currentTabId);
      } else {
        tabClusters.set(currentTabId, name);
      }
      saveSessionMetadata();
      renderSidebar();
    });
    return;
  }
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

// --- Save on Close ---

window.terminalAPI.onBeforeQuit(async () => {
  await saveSessionMetadata();
  window.terminalAPI.quitReady();
});

// --- Usage Status Bar ---

const statusBarEl = document.getElementById("statusbar")!;
const usage5h = document.getElementById("usage-5h")!;
const usage7d = document.getElementById("usage-7d")!;
const usageSeps = statusBarEl.querySelectorAll(".usage-sep");
let usageLoading = false;

function getUsageColorClass(utilization: number): string {
  if (utilization >= 95) return "critical";
  if (utilization >= 80) return "warn";
  return "normal";
}

function formatResetTime(resetsAt: string | null): string {
  if (!resetsAt) return "";
  const date = new Date(resetsAt);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  if (diffMs <= 0) return "reset imminent";
  const diffD = Math.floor(diffMs / 86400000);
  const diffH = Math.floor((diffMs % 86400000) / 3600000);
  const diffM = Math.floor((diffMs % 3600000) / 60000);
  if (diffD > 0) return `${diffD}d ${diffH}h`;
  if (diffH > 0) return `${diffH}h ${diffM}m`;
  return `${diffM}m`;
}

function updateUsageMetric(
  el: HTMLElement,
  label: string,
  metric: { utilization: number; resets_at: string | null } | undefined
): void {
  if (!metric || metric.utilization == null) {
    el.innerHTML = `<span class="usage-label">${label}</span><span class="usage-bar-wrap"><span class="usage-bar"><span class="usage-bar-fill normal" style="width:0%"></span></span><span class="usage-pct">--</span></span><span class="usage-reset"></span>`;
    el.title = "";
    el.className = "usage-metric";
    return;
  }
  const pct = Math.round(metric.utilization);
  const colorClass = getUsageColorClass(metric.utilization);
  const pctClass = colorClass === 'critical' ? 'usage-critical' : colorClass === 'warn' ? 'usage-warn' : '';
  const resetText = formatResetTime(metric.resets_at);
  el.innerHTML = `<span class="usage-label">${label}</span><span class="usage-bar-wrap"><span class="usage-bar"><span class="usage-bar-fill ${colorClass}" style="width:${pct}%"></span></span><span class="usage-pct ${pctClass}">${pct}%</span></span><span class="usage-reset">${resetText}</span>`;
  el.title = "";
  el.className = "usage-metric";
}

async function refreshUsage(): Promise<void> {
  if (usageLoading) return;
  usageLoading = true;

  try {
    const result = await window.terminalAPI.fetchUsage();

    if (result.error) {
      const msg =
        result.error === "keychain" ? "not logged in" : "--";
      usage5h.textContent = `Usage: ${msg}`;
      usage5h.className = "usage-metric";
      usage5h.title = "";
      usage7d.textContent = "";
      usage7d.className = "usage-metric";
      usage7d.title = "";
      // Hide separators when showing error
      usageSeps.forEach((sep) => {
        (sep as HTMLElement).style.display = "none";
      });
      return;
    }

    if (result.data) {
      // Show separators
      usageSeps.forEach((sep) => {
        (sep as HTMLElement).style.display = "";
      });
      updateUsageMetric(usage5h, "5h", result.data.five_hour);
      updateUsageMetric(usage7d, "7d", result.data.seven_day);
    }
  } catch (err) {
    console.error("[renderer] Usage refresh failed:", err);
  } finally {
    usageLoading = false;
  }
}

statusBarEl.addEventListener("click", () => {
  refreshUsage();
});

// Auto-refresh every 5 minutes
setInterval(() => {
  refreshUsage();
}, 5 * 60 * 1000);

// --- Init ---

btnNew.addEventListener("click", () => {
  createNewTab(nextTerminalName());
});

(async () => {
  try {
    const restored = await restoreFromTmux();
    if (!restored) {
      await createNewTab();
    }
    // Load usage data
    refreshUsage();
  } catch (err) {
    console.error("Init error:", err);
  }
})();
