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

// Current active settings — updated by settings-modal.ts when user changes values.
// Used by createPaneSession to apply font/theme to newly created terminals.
// eslint-disable-next-line no-var
var activeSessionSettings: { fontSize: number; theme: "dark" | "light" } = {
  fontSize: 14,
  theme: "dark",
};

const terminalPane = document.getElementById("terminal-pane")!;
const terminalList = document.getElementById("terminal-list")!;
const btnNew = document.getElementById("btn-new-terminal")!;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Toast notification (uses .hook-toast CSS class family defined in styles.css)
function showToast(message: string, variant: "error" | "warn" | "ok" | "done" = "error"): void {
  const el = document.createElement("div");
  el.className = `hook-toast hook-toast-${variant}`;
  el.textContent = message;
  document.body.appendChild(el);
  el.addEventListener("animationend", () => el.remove());
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

// Helper: shorten home dir to ~
function shortenCwd(cwd: string): string {
  const home = cwd.startsWith("/Users/") || cwd.startsWith("/home/")
    ? cwd.replace(/^\/(?:Users|home)\/[^/]+/, "~")
    : cwd;
  return home || "~";
}

// Helper: shorten branch name for pane header (max 26 chars)
function shortBranchName(b: string): string {
  return b.length > 26 ? b.slice(0, 24) + "…" : b;
}

async function createPaneSession(
  parentElement: HTMLElement,
  cwd?: string
): Promise<PaneLeaf> {
  const paneElement = document.createElement("div");
  paneElement.className = "pane-leaf";
  parentElement.appendChild(paneElement);

  // Rich pane header: status-dot · cwd · branch · title | mini buttons
  const paneHeader = document.createElement("div");
  paneHeader.className = "pane-header";
  paneElement.appendChild(paneHeader);

  // Status dot
  const headerDot = document.createElement("span");
  headerDot.className = "ph-dot";
  paneHeader.appendChild(headerDot);

  // CWD
  const cwdEl = document.createElement("span");
  cwdEl.className = "ph-cwd";
  cwdEl.textContent = cwd ? shortenCwd(cwd) : "~";
  paneHeader.appendChild(cwdEl);

  // Branch (hidden until git info available)
  const branchSep = document.createElement("span");
  branchSep.className = "ph-sep";
  branchSep.textContent = "·";
  branchSep.style.display = "none";
  paneHeader.appendChild(branchSep);

  const branchEl = document.createElement("span");
  branchEl.className = "ph-branch";
  branchEl.style.display = "none";
  paneHeader.appendChild(branchEl);

  // Title separator
  const titleSep = document.createElement("span");
  titleSep.className = "ph-sep";
  titleSep.textContent = "·";
  paneHeader.appendChild(titleSep);

  // Pane title (dblclick to rename)
  const paneTitle = document.createElement("span");
  paneTitle.className = "pane-title";
  paneTitle.textContent = "...";
  paneHeader.appendChild(paneTitle);

  // Right mini buttons
  const miniRight = document.createElement("div");
  miniRight.className = "ph-right";

  const btnClear = document.createElement("button");
  btnClear.className = "ph-mini";
  btnClear.title = "Clear";
  btnClear.innerHTML = `<svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M3 5h10M6 5V3h4v2M5 5l0.7 9h4.6L11 5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  const btnSplit = document.createElement("button");
  btnSplit.className = "ph-mini";
  btnSplit.title = "Split";
  btnSplit.innerHTML = `<svg width="11" height="11" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="1.5" width="13" height="13" rx="1.5" stroke="currentColor" stroke-width="1.2"/><line x1="8" y1="1.5" x2="8" y2="14.5" stroke="currentColor" stroke-width="1.2"/></svg>`;

  const btnClose = document.createElement("button");
  btnClose.className = "ph-mini";
  btnClose.title = "Close";
  btnClose.innerHTML = `<svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`;

  miniRight.appendChild(btnClear);
  miniRight.appendChild(btnSplit);
  miniRight.appendChild(btnClose);
  paneHeader.appendChild(miniRight);

  const termContainer = document.createElement("div");
  termContainer.className = "terminal-container";
  paneElement.appendChild(termContainer);

  const session = new TerminalSession(termContainer);

  let cols: number;
  let rows: number;
  try {
    session.open();
    // Apply current font size and theme from active settings
    session.setFontSize(activeSessionSettings.fontSize);
    session.setTheme(activeSessionSettings.theme);
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

  // Set initial pane title
  paneTitle.textContent = "Terminal";

  // Wire mini buttons
  btnClear.addEventListener("click", (e) => {
    e.stopPropagation();
    session.write("\x0c"); // Ctrl+L
  });

  btnSplit.addEventListener("click", (e) => {
    e.stopPropagation();
    splitFocusedPane("horizontal");
  });

  btnClose.addEventListener("click", (e) => {
    e.stopPropagation();
    closePaneByPtyId(ptyId);
  });

  // Double-click pane title to rename
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

  // Periodic CWD update for pane header
  let cwdPollTimer: ReturnType<typeof setInterval> | null = null;
  function startCwdPoll(): void {
    if (cwdPollTimer !== null) return;
    cwdPollTimer = setInterval(async () => {
      try {
        const newCwd = await window.terminalAPI.getCwd(ptyId);
        if (newCwd) cwdEl.textContent = shortenCwd(newCwd);
        // Update branch from per-pane git cache
        if (typeof getGitCacheForPane === "function") {
          const cache = getGitCacheForPane(ptyId);
          if (cache?.info?.branch) {
            branchEl.textContent = "⎇ " + shortBranchName(cache.info.branch);
            branchEl.style.display = "";
            branchSep.style.display = "";
          } else {
            branchEl.style.display = "none";
            branchSep.style.display = "none";
          }
        }
      } catch {
        // ignore
      }
    }, 3000);
  }

  function stopCwdPoll(): void {
    if (cwdPollTimer !== null) {
      clearInterval(cwdPollTimer);
      cwdPollTimer = null;
    }
  }

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
    // Update CWD immediately on focus
    window.terminalAPI.getCwd(ptyId).then((newCwd) => {
      if (newCwd) cwdEl.textContent = shortenCwd(newCwd);
    }).catch(() => {/* ignore */});
  });

  // Start CWD polling after pty is ready
  startCwdPoll();

  // Register cleanup for CWD poll (called from closePaneByPtyId path)
  paneElement.addEventListener("pane-destroy", () => stopCwdPoll(), { once: true });

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
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[renderer] Failed to create tab:", msg);
    // Remove the partially-created container so no phantom entry appears in the DOM
    tabContainer.remove();
    // Ensure state maps have no leftover entries for this failed tab
    // (tabMap, tabLabels, tabClusters, ptyToTab are not yet set at this point,
    //  but guard cleanups in case future refactors move things around)
    // Restore visibility of previously active tab
    if (activeTabId !== null) {
      const prevTab = tabMap.get(activeTabId);
      if (prevTab) prevTab.container.style.display = "flex";
    } else if (tabMap.size > 0) {
      // Re-show last tab
      const lastTabId = Array.from(tabMap.keys()).pop()!;
      const lastTab = tabMap.get(lastTabId)!;
      lastTab.container.style.display = "flex";
    }
    // Notify user
    showToast(`터미널 생성 실패: ${msg}`, "error");
    return null;
  }
}

// --- Titlebar: group name + branch ---
const tbGroupNameEl = document.getElementById("tb-group-name");
const tbBranchNameEl = document.getElementById("tb-branch-name");

function updateTitlebarGroupName(tabId: number): void {
  if (!tbGroupNameEl) return;
  const label = tabLabels.get(tabId) || `Terminal ${tabId}`;
  tbGroupNameEl.textContent = label;
}

function updateTitlebarBranch(branch: string | null): void {
  if (!tbBranchNameEl) return;
  tbBranchNameEl.textContent = branch || "—";
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
  // Update titlebar group name
  updateTitlebarGroupName(tabId);
  // Sync toolbar preset highlight to the newly active tab
  if (typeof syncToolbarToTab === "function") syncToolbarToTab(tabId);
  // Refresh Changed Files panel for the newly active tab
  refreshChangedFilesPanel();
  // On-demand git poll for newly active tab (updates badge within one cycle)
  pollGitOnTabSwitch(tabId);
  // Immediately apply cached git branch to pane headers (SHOULD FIX from Sprint 1)
  updatePaneHeadersFromGitCache(tabId);
}

// Update branch info in pane headers using paneGitCache (per-pane, synchronous read)
function updatePaneHeadersFromGitCache(tabId: number): void {
  const tab = tabMap.get(tabId);
  if (!tab) return;

  const leaves = getAllLeaves(tab.root);
  for (const leaf of leaves) {
    const branchEl = leaf.element.querySelector(".ph-branch") as HTMLElement | null;
    const branchSep = leaf.element.querySelectorAll(".ph-sep")[0] as HTMLElement | null;
    if (!branchEl) continue;

    // Use per-pane cache if available, otherwise fall back to tab-level cache
    let branch: string | null = null;
    if (typeof getGitCacheForPane === "function") {
      const paneCache = getGitCacheForPane(leaf.ptyId);
      branch = paneCache?.info?.branch ?? null;
    } else if (typeof getGitCacheForTab === "function") {
      const tabCache = getGitCacheForTab(tabId);
      branch = tabCache?.info?.branch ?? null;
    }

    const branchText = branch ? "⎇ " + shortBranchName(branch) : null;
    if (branchText) {
      branchEl.textContent = branchText;
      branchEl.style.display = "";
      if (branchSep) branchSep.style.display = "";
    } else {
      branchEl.style.display = "none";
      if (branchSep) branchSep.style.display = "none";
    }
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

  // Create new pane — if this fails, restore the original leaf in the DOM
  let newLeaf: PaneLeaf;
  try {
    newLeaf = await createPaneSession(splitElement);
  } catch (err) {
    // Undo the DOM manipulation: put leaf back where splitElement is
    splitElement.replaceWith(leaf.element);
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[renderer] Failed to split pane:", msg);
    showToast(`Pane 분할 실패: ${msg}`, "error");
    return;
  }
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

  // Update sidebar count pill
  if (typeof updateSidebarCountPill === "function") {
    updateSidebarCountPill(tab.id);
  }

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

  // Capture the leaf element before tree mutation for pane-destroy event
  const closingLeaf = findLeaf(tab.root, ptyId);

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

  // Clean up closed pane — dispatch pane-destroy to stop CWD poll
  if (closingLeaf) {
    closingLeaf.element.dispatchEvent(new Event("pane-destroy", { bubbles: false }));
  }
  window.terminalAPI.destroyPty(ptyId);
  sessions.get(ptyId)?.dispose();
  sessions.delete(ptyId);
  sessionKeys.delete(ptyId);
  ptyToTab.delete(ptyId);
  cleanupPaneAgentMarker(ptyId);
  cleanupPaneHookMarker(ptyId);
  // Clean up per-pane git cache
  if (typeof cleanupPaneGitCache === "function") {
    cleanupPaneGitCache(ptyId);
  }

  // Update sidebar count pill
  if (typeof updateSidebarCountPill === "function") {
    updateSidebarCountPill(tabId);
  }

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

  // Delete notes for this tab (fire-and-forget — catch to prevent unhandled rejection)
  const firstLeaf = getAllLeaves(tab.root)[0];
  if (firstLeaf) {
    const sk = sessionKeys.get(firstLeaf.ptyId);
    if (sk) window.terminalAPI.deleteSessionNotes(sk).catch((e) => {
      console.warn("[renderer] deleteSessionNotes failed (ignored):", e);
    });
  }
  sessionNotesCache.delete(tabId);

  // Destroy all panes
  for (const leaf of getAllLeaves(tab.root)) {
    // Stop CWD poll before cleanup
    leaf.element.dispatchEvent(new Event("pane-destroy", { bubbles: false }));
    cleanupPaneAgentMarker(leaf.ptyId);
    cleanupPaneHookMarker(leaf.ptyId);
    window.terminalAPI.destroyPty(leaf.ptyId);
    leaf.session.dispose();
    sessions.delete(leaf.ptyId);
    sessionKeys.delete(leaf.ptyId);
    ptyToTab.delete(leaf.ptyId);
    // Clean up per-pane git cache
    if (typeof cleanupPaneGitCache === "function") {
      cleanupPaneGitCache(leaf.ptyId);
    }
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
        layoutPreset: typeof getTabLayoutPreset === "function" ? getTabLayoutPreset(tabId) : undefined,
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
    if (savedTab.layoutPreset && typeof setTabLayoutPreset === "function") {
      setTabLayoutPreset(tabId, savedTab.layoutPreset);
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
  teardownKeybindings();

  // Teardown sidebar delegation (sidebar.ts)
  teardownSidebarDelegation();
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
