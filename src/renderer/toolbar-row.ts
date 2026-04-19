/// <reference path="./global.d.ts" />
/// <reference path="./pane-types.d.ts" />

// === Layout Presets ===
// Toolbar row with segmented layout preset control.
// Placed inside #terminal-pane BEFORE .tab-container elements.

type LayoutPresetName = "single" | "split" | "triple" | "quad";

interface LayoutPresetDef {
  name: LayoutPresetName;
  paneCount: number;
  title: string;
  svgPath: string;
}

const LAYOUT_PRESETS: LayoutPresetDef[] = [
  {
    name: "single",
    paneCount: 1,
    title: "Single pane",
    svgPath: `<rect x="1" y="1" width="14" height="10" rx="1.5" stroke="currentColor" stroke-width="1.2" fill="none"/>`,
  },
  {
    name: "split",
    paneCount: 2,
    title: "Split vertical (2 panes)",
    svgPath: `<rect x="1" y="1" width="14" height="10" rx="1.5" stroke="currentColor" stroke-width="1.2" fill="none"/><line x1="8" y1="1" x2="8" y2="11" stroke="currentColor" stroke-width="1.2"/>`,
  },
  {
    name: "triple",
    paneCount: 3,
    title: "3 panes",
    svgPath: `<rect x="1" y="1" width="14" height="10" rx="1.5" stroke="currentColor" stroke-width="1.2" fill="none"/><line x1="8" y1="1" x2="8" y2="11" stroke="currentColor" stroke-width="1.2"/><line x1="8" y1="6" x2="15" y2="6" stroke="currentColor" stroke-width="1.2"/>`,
  },
  {
    name: "quad",
    paneCount: 4,
    title: "4 panes",
    svgPath: `<rect x="1" y="1" width="14" height="10" rx="1.5" stroke="currentColor" stroke-width="1.2" fill="none"/><line x1="8" y1="1" x2="8" y2="11" stroke="currentColor" stroke-width="1.2"/><line x1="8" y1="4.3" x2="15" y2="4.3" stroke="currentColor" stroke-width="1.2"/><line x1="8" y1="7.7" x2="15" y2="7.7" stroke="currentColor" stroke-width="1.2"/>`,
  },
];

// Per-tab preset tracking (tabId → preset name)
const tabLayoutPresets = new Map<number, LayoutPresetName>();

let toolbarRow: HTMLElement | null = null;
let layoutBtns: HTMLButtonElement[] = [];

function initToolbarRow(): void {
  // Build the toolbar row element
  toolbarRow = document.createElement("div");
  toolbarRow.id = "toolbar-row";

  const spacer = document.createElement("div");
  spacer.className = "toolbar-spacer";
  toolbarRow.appendChild(spacer);

  // Segmented control container
  const layoutsEl = document.createElement("div");
  layoutsEl.className = "layouts";
  toolbarRow.appendChild(layoutsEl);

  // Create buttons
  layoutBtns = LAYOUT_PRESETS.map((preset) => {
    const btn = document.createElement("button");
    btn.className = "layout-btn";
    btn.title = preset.title;
    btn.dataset.preset = preset.name;
    btn.innerHTML = `<svg width="16" height="12" viewBox="0 0 16 12" fill="none">${preset.svgPath}</svg>`;
    btn.addEventListener("click", () => applyLayoutPreset(preset.name));
    layoutsEl.appendChild(btn);
    return btn;
  });

  // Insert before first .tab-container, or append if none
  const terminalPane = document.getElementById("terminal-pane")!;
  const firstTabContainer = terminalPane.querySelector(".tab-container");
  if (firstTabContainer) {
    terminalPane.insertBefore(toolbarRow, firstTabContainer);
  } else {
    terminalPane.appendChild(toolbarRow);
  }
}

function updateToolbarPresetHighlight(presetName: LayoutPresetName | null): void {
  for (const btn of layoutBtns) {
    if (btn.dataset.preset === presetName) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  }
}

// Called from switchToTab (renderer.ts) to sync toolbar state
function syncToolbarToTab(tabId: number): void {
  const preset = tabLayoutPresets.get(tabId) ?? null;
  updateToolbarPresetHighlight(preset);
}

// Called from saveSessionMetadata to get the current preset for a tab
function getTabLayoutPreset(tabId: number): string | undefined {
  return tabLayoutPresets.get(tabId);
}

// Called from restoreFromSaved to set preset (without applying DOM changes, tree already restored)
function setTabLayoutPreset(tabId: number, presetName: string): void {
  if (isLayoutPresetName(presetName)) {
    tabLayoutPresets.set(tabId, presetName);
  }
}

function isLayoutPresetName(name: string): name is LayoutPresetName {
  return name === "single" || name === "split" || name === "triple" || name === "quad";
}

// Build a PaneNode tree from existing leaves + newly created ones.
// leaves: existing leaves in order. newLeaves: newly created leaves.
// Returns the root PaneNode and all leaf ptyIds in use.
function buildPresetTree(
  presetName: LayoutPresetName,
  existingLeaves: PaneLeaf[],
  container: HTMLElement
): { root: PaneNode; leavesUsed: PaneLeaf[] } {
  switch (presetName) {
    case "single":
      return buildSingleTree(existingLeaves[0], container);
    case "split":
      return buildSplitTree(existingLeaves[0], existingLeaves[1], container);
    case "triple":
      return buildTripleTree(existingLeaves[0], existingLeaves[1], existingLeaves[2], container);
    case "quad":
      return buildQuadTree(existingLeaves[0], existingLeaves[1], existingLeaves[2], existingLeaves[3], container);
  }
}

// single: just 1 leaf directly in container
function buildSingleTree(leaf: PaneLeaf, container: HTMLElement): { root: PaneNode; leavesUsed: PaneLeaf[] } {
  // Detach from any previous parent, attach to container
  leaf.element.style.flex = "1 1 0px";
  container.appendChild(leaf.element);
  return { root: leaf, leavesUsed: [leaf] };
}

// split: horizontal split, 2 leaves
function buildSplitTree(left: PaneLeaf, right: PaneLeaf, container: HTMLElement): { root: PaneNode; leavesUsed: PaneLeaf[] } {
  const splitEl = document.createElement("div");
  splitEl.className = "pane-split horizontal";
  container.appendChild(splitEl);

  left.element.style.flex = "0.5 1 0px";
  splitEl.appendChild(left.element);

  const divider = document.createElement("div");
  divider.className = "pane-divider horizontal";
  splitEl.appendChild(divider);

  right.element.style.flex = "0.5 1 0px";
  splitEl.appendChild(right.element);

  const splitNode: PaneSplit = {
    type: "split",
    direction: "horizontal",
    ratio: 0.5,
    children: [left, right],
    element: splitEl,
    divider,
  };
  setupDividerDrag(splitNode);

  return { root: splitNode, leavesUsed: [left, right] };
}

// triple: left leaf | right vertical-split (top/bottom)
function buildTripleTree(
  left: PaneLeaf,
  topRight: PaneLeaf,
  bottomRight: PaneLeaf,
  container: HTMLElement
): { root: PaneNode; leavesUsed: PaneLeaf[] } {
  // Outer horizontal split
  const outerSplitEl = document.createElement("div");
  outerSplitEl.className = "pane-split horizontal";
  container.appendChild(outerSplitEl);

  // Left pane
  left.element.style.flex = "0.5 1 0px";
  outerSplitEl.appendChild(left.element);

  const outerDivider = document.createElement("div");
  outerDivider.className = "pane-divider horizontal";
  outerSplitEl.appendChild(outerDivider);

  // Right vertical split
  const rightSplitEl = document.createElement("div");
  rightSplitEl.className = "pane-split vertical";
  rightSplitEl.style.flex = "0.5 1 0px";
  outerSplitEl.appendChild(rightSplitEl);

  topRight.element.style.flex = "0.5 1 0px";
  rightSplitEl.appendChild(topRight.element);

  const rightDivider = document.createElement("div");
  rightDivider.className = "pane-divider vertical";
  rightSplitEl.appendChild(rightDivider);

  bottomRight.element.style.flex = "0.5 1 0px";
  rightSplitEl.appendChild(bottomRight.element);

  const rightSplitNode: PaneSplit = {
    type: "split",
    direction: "vertical",
    ratio: 0.5,
    children: [topRight, bottomRight],
    element: rightSplitEl,
    divider: rightDivider,
  };
  setupDividerDrag(rightSplitNode);

  const outerSplitNode: PaneSplit = {
    type: "split",
    direction: "horizontal",
    ratio: 0.5,
    children: [left, rightSplitNode],
    element: outerSplitEl,
    divider: outerDivider,
  };
  setupDividerDrag(outerSplitNode);

  return { root: outerSplitNode, leavesUsed: [left, topRight, bottomRight] };
}

// quad: left leaf | right 3-stack (top/mid/bottom)
function buildQuadTree(
  left: PaneLeaf,
  top: PaneLeaf,
  mid: PaneLeaf,
  bot: PaneLeaf,
  container: HTMLElement
): { root: PaneNode; leavesUsed: PaneLeaf[] } {
  const outerSplitEl = document.createElement("div");
  outerSplitEl.className = "pane-split horizontal";
  container.appendChild(outerSplitEl);

  left.element.style.flex = "0.5 1 0px";
  outerSplitEl.appendChild(left.element);

  const outerDivider = document.createElement("div");
  outerDivider.className = "pane-divider horizontal";
  outerSplitEl.appendChild(outerDivider);

  // Right: vertical split (top | mid+bot)
  const rightOuterEl = document.createElement("div");
  rightOuterEl.className = "pane-split vertical";
  rightOuterEl.style.flex = "0.5 1 0px";
  outerSplitEl.appendChild(rightOuterEl);

  top.element.style.flex = "0.333 1 0px";
  rightOuterEl.appendChild(top.element);

  const topDivider = document.createElement("div");
  topDivider.className = "pane-divider vertical";
  rightOuterEl.appendChild(topDivider);

  // mid+bot split
  const midBotEl = document.createElement("div");
  midBotEl.className = "pane-split vertical";
  midBotEl.style.flex = "0.667 1 0px";
  rightOuterEl.appendChild(midBotEl);

  mid.element.style.flex = "0.5 1 0px";
  midBotEl.appendChild(mid.element);

  const midDivider = document.createElement("div");
  midDivider.className = "pane-divider vertical";
  midBotEl.appendChild(midDivider);

  bot.element.style.flex = "0.5 1 0px";
  midBotEl.appendChild(bot.element);

  const midBotNode: PaneSplit = {
    type: "split",
    direction: "vertical",
    ratio: 0.5,
    children: [mid, bot],
    element: midBotEl,
    divider: midDivider,
  };
  setupDividerDrag(midBotNode);

  const rightOuterNode: PaneSplit = {
    type: "split",
    direction: "vertical",
    ratio: 0.333,
    children: [top, midBotNode],
    element: rightOuterEl,
    divider: topDivider,
  };
  setupDividerDrag(rightOuterNode);

  const outerNode: PaneSplit = {
    type: "split",
    direction: "horizontal",
    ratio: 0.5,
    children: [left, rightOuterNode],
    element: outerSplitEl,
    divider: outerDivider,
  };
  setupDividerDrag(outerNode);

  return { root: outerNode, leavesUsed: [left, top, mid, bot] };
}

async function applyLayoutPreset(presetName: LayoutPresetName): Promise<void> {
  if (typeof activeTabId === "undefined" || activeTabId === null) return;
  const tabId = activeTabId;
  const tab = tabMap.get(tabId);
  if (!tab) return;

  const preset = LAYOUT_PRESETS.find((p) => p.name === presetName)!;
  const needed = preset.paneCount;

  // 1. Collect current leaves
  let leaves = getAllLeaves(tab.root);
  const currentCount = leaves.length;

  // 2. Create new panes if needed
  if (needed > currentCount) {
    for (let i = currentCount; i < needed; i++) {
      try {
        // Create a temporary off-screen container to pass to createPaneSession
        const newLeaf = await createPaneSession(tab.container);
        ptyToTab.set(newLeaf.ptyId, tabId);
        leaves.push(newLeaf);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        showToast(`Pane 생성 실패: ${msg}`, "error");
        return;
      }
    }
  }

  // 3. Close excess panes (innermost/last first), but never all of them
  if (currentCount > needed) {
    // Close the panes that won't be used (last ones in order)
    const toClose = leaves.slice(needed);
    // Remove them from our working list
    leaves = leaves.slice(0, needed);

    for (const leaf of toClose) {
      // Manually destroy without calling closePaneByPtyId to avoid closeTab side effects
      // We've already removed them from our leaves list so tree re-build won't include them
      leaf.element.dispatchEvent(new Event("pane-destroy", { bubbles: false }));
      window.terminalAPI.destroyPty(leaf.ptyId);
      leaf.session.dispose();
      sessions.delete(leaf.ptyId);
      sessionKeys.delete(leaf.ptyId);
      ptyToTab.delete(leaf.ptyId);
      if (typeof cleanupPaneAgentMarker === "function") cleanupPaneAgentMarker(leaf.ptyId);
      if (typeof cleanupPaneHookMarker === "function") cleanupPaneHookMarker(leaf.ptyId);
      leaf.element.remove();
    }
  }

  // 4. Clear the container of existing pane tree elements (split wrappers, dividers)
  // Detach all leaf elements temporarily, remove all children, re-append
  for (const leaf of leaves) {
    if (leaf.element.parentElement) {
      leaf.element.parentElement.removeChild(leaf.element);
    }
  }
  // Clear remaining DOM in container (old split dividers / wrapper divs)
  while (tab.container.firstChild) {
    tab.container.removeChild(tab.container.firstChild);
  }

  // 5. Build new tree structure
  const { root } = buildPresetTree(presetName, leaves, tab.container);

  // 6. Update tab root
  tab.root = root;

  // 7. Set focus to first leaf
  const newLeaves = getAllLeaves(tab.root);
  if (newLeaves.length > 0) {
    tab.focusedPtyId = newLeaves[0].ptyId;
  }

  // 8. Track preset
  tabLayoutPresets.set(tabId, presetName);
  updateToolbarPresetHighlight(presetName);

  // 9. Update sidebar count pill
  if (typeof updateSidebarCountPill === "function") {
    updateSidebarCountPill(tabId);
  }

  // 10. Resize + focus
  requestAnimationFrame(() => {
    resizeAllPanes(tab.root);
    if (newLeaves.length > 0) {
      setFocusedPane(tab.focusedPtyId);
    }
  });

  // 11. Save
  await saveSessionMetadata();
}
