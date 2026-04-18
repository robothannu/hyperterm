/// <reference path="./global.d.ts" />
/// <reference path="./pane-types.d.ts" />

// --- Global Keyboard Shortcuts ---

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
  // Cmd+Arrow: navigate between panes (internal pane tree focus)
  if (activeTabId !== null && e.metaKey && !e.shiftKey) {
    const tab = tabMap.get(activeTabId);
    if (tab) {
      const leaves = getAllLeaves(tab.root);
      if (leaves.length > 1) {
        const currentIndex = leaves.findIndex((l) => l.ptyId === tab.focusedPtyId);
        let nextIndex = -1;

        if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          nextIndex = currentIndex > 0 ? currentIndex - 1 : leaves.length - 1;
        } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          nextIndex = currentIndex < leaves.length - 1 ? currentIndex + 1 : 0;
        }

        if (nextIndex >= 0) {
          e.preventDefault();
          setFocusedPane(leaves[nextIndex].ptyId);
          return;
        }
      }
    }
  }

  // Cmd+1..9: switch to nth tab
  if (e.metaKey && !e.shiftKey && !e.ctrlKey && /^[1-9]$/.test(e.key)) {
    const idx = parseInt(e.key, 10) - 1;
    const ids = Array.from(tabMap.keys());
    if (idx < ids.length) {
      e.preventDefault();
      switchToTab(ids[idx]);
    }
    return;
  }

  // Cmd+Shift+] / Cmd+Shift+[: next/prev tab
  if (e.metaKey && e.shiftKey && (e.key === "]" || e.key === "[")) {
    e.preventDefault();
    const ids = Array.from(tabMap.keys());
    if (ids.length < 2) return;
    const cur = ids.indexOf(activeTabId!);
    const next = e.key === "]"
      ? (cur + 1) % ids.length
      : (cur - 1 + ids.length) % ids.length;
    switchToTab(ids[next]);
    return;
  }

  // Cmd+Shift+A: jump to oldest waiting_approval tab
  if ((e.key === "a" || e.key === "A") && e.metaKey && e.shiftKey) {
    e.preventDefault();
    for (const [tabId, tab] of tabMap.entries()) {
      const leaves = getAllLeaves(tab.root);
      if (leaves.some((l) => l.agentState === "waiting_approval")) {
        switchToTab(tabId);
        return;
      }
    }
    showHookToast("승인 대기 중인 Claude 없음", "done");
    return;
  }

  // Cmd+Shift+E: toggle Changed Files panel
  if ((e.key === "e" || e.key === "E") && e.metaKey && e.shiftKey) {
    e.preventDefault();
    toggleChangedFilesPanel();
    return;
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
