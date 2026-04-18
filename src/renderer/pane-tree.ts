/// <reference path="./global.d.ts" />
/// <reference path="./pane-types.d.ts" />

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
