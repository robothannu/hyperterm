/// <reference path="./global.d.ts" />
/// <reference path="./pane-types.d.ts" />

/**
 * pinned-ui — Sprint 3: Pinned group PTY UX
 *
 * Manages pin/unpin toggle UI and the pinned PTY lifecycle from the renderer.
 *
 * Loaded as a plain <script> tag after sidebar.ts and renderer.ts.
 * Functions are declared globally and called by renderer.ts and sidebar.ts.
 *
 * Architecture:
 *   - Pinned groups use daemon-owned PTYs (live across app restarts).
 *   - On pin toggle: warn user if PTY is active → confirm → create daemon PTY.
 *   - On app restore: reconcile → ATTACH daemon PTY or Sprint 1 fallback.
 *   - On unpin: kill daemon PTY.
 *   - On group delete: kill daemon PTY (orphan guard).
 */

// ---------------------------------------------------------------------------
// Pinned tab state — localPtyId of active streaming connection per tabId
// (tabId → localPtyId proxy). Only set while app is running with a stream.
// ---------------------------------------------------------------------------

const pinnedLocalPtyIds = new Map<number, number>(); // tabId → localPtyId

// F2: per-tab onData disposable for the daemon-routing handler.
// Stored separately so we can dispose it on unpin.
const pinnedOnDataDisposables = new Map<number, { dispose(): void }>(); // tabId → disposable

// ---------------------------------------------------------------------------
// Visual helpers
// ---------------------------------------------------------------------------

const PIN_ICON_PINNED = "📌";
const PIN_ICON_UNPINNED = "📍";

/** Update the pin icon in a sidebar entry. */
function updatePinIcon(tabId: number, pinned: boolean): void {
  const li = document.querySelector(
    `#terminal-list [data-id="${tabId}"]`
  ) as HTMLElement | null;
  if (!li) return;

  let pinEl = li.querySelector(".tab-pin-btn") as HTMLElement | null;
  if (!pinEl) return;

  pinEl.textContent = pinned ? PIN_ICON_PINNED : PIN_ICON_UNPINNED;
  pinEl.title = pinned ? "Pinned (click to unpin)" : "Click to pin this group";
  li.classList.toggle("tab-pinned", pinned);
}

// ---------------------------------------------------------------------------
// F1/F2 Wiring helpers
// ---------------------------------------------------------------------------

/**
 * Wire a pinned PTY stream to an xterm session.
 * F1: Register session in pinnedSessions so daemon output (localPtyId) reaches xterm.
 * F2: Dispose the local-PTY onData handler and replace with daemon-routing handler.
 *
 * After this call:
 *  - daemon data → main.ts pty:data (localPtyId) → pinnedSessions.get(localPtyId) → xterm
 *  - user keystroke → new onData → writePinnedPty(localPtyId) → daemon
 */
function wirePinnedSession(tabId: number, localPtyId: number, leaf: PaneLeaf): void {
  // F1: register session for daemon output routing
  pinnedSessions.set(localPtyId, leaf.session);

  // F2: replace local-PTY onData with daemon-routing handler
  // Dispose existing local-PTY handler first to prevent double-send
  if (leaf.onDataDisposable) {
    leaf.onDataDisposable.dispose();
  }
  const daemonOnData = leaf.session.onData((data: string) => {
    window.terminalAPI.writePinnedPty(localPtyId, data);
  });
  // Update leaf.onDataDisposable so future unpins can dispose this too
  leaf.onDataDisposable = daemonOnData;
  pinnedOnDataDisposables.set(tabId, daemonOnData);

  console.log(
    `[pinned-ui] wirePinnedSession: tabId=${tabId} localPtyId=${localPtyId} ptyId=${leaf.ptyId}`
  );
}

/**
 * Unwire pinned session on unpin.
 * Dispose daemon onData, remove from pinnedSessions, restore local-PTY handler.
 */
function unwirePinnedSession(tabId: number, localPtyId: number, leaf: PaneLeaf): void {
  // Dispose daemon onData
  const daemonDisposable = pinnedOnDataDisposables.get(tabId);
  if (daemonDisposable) {
    daemonDisposable.dispose();
    pinnedOnDataDisposables.delete(tabId);
  }
  // Update leaf.onDataDisposable to avoid stale reference
  leaf.onDataDisposable = undefined;

  // F1: remove from pinnedSessions
  pinnedSessions.delete(localPtyId);

  // F2 restore: re-register local-PTY handler so keyboard works normally again
  const ptyId = leaf.ptyId;
  const newDisposable = leaf.session.onData((data: string) => {
    window.terminalAPI.writePty(ptyId, data);
  });
  leaf.onDataDisposable = newDisposable;

  console.log(
    `[pinned-ui] unwirePinnedSession: tabId=${tabId} localPtyId=${localPtyId} ptyId=${ptyId}`
  );
}

// ---------------------------------------------------------------------------
// Pin toggle logic
// ---------------------------------------------------------------------------

/**
 * Toggle pin state for a tab.
 * - If currently unpinned: spawn daemon PTY (may prompt if active shell)
 * - If currently pinned: kill daemon PTY
 */
async function togglePinTab(tabId: number): Promise<void> {
  const tab = tabMap.get(tabId);
  if (!tab) return;

  if (tab.pinned) {
    // Unpin: kill daemon PTY
    await unpinTab(tabId);
  } else {
    // Pin: spawn daemon PTY
    await pinTab(tabId);
  }
}

async function pinTab(tabId: number): Promise<void> {
  const tab = tabMap.get(tabId);
  if (!tab) return;

  const label = tabLabels.get(tabId) || `Terminal ${tabId}`;

  // Get current cwd from the first leaf
  const leaves = getAllLeaves(tab.root);
  if (leaves.length === 0) return;

  let cwd: string | undefined;
  try {
    cwd = await window.terminalAPI.getCwd(leaves[0].ptyId);
  } catch { /* use undefined */ }

  // Get terminal dimensions
  const cols = leaves[0].session.getCols?.() ?? 80;
  const rows = leaves[0].session.getRows?.() ?? 24;

  try {
    // Spawn daemon-owned PTY
    const { id: daemonPtyId, cwd: resolvedCwd } = await window.terminalAPI.createPinnedPty(
      cols,
      rows,
      cwd,
      label
    );

    tab.pinned = true;
    tab.daemonPtyId = daemonPtyId;

    // Attach streaming proxy
    const { localPtyId } = await window.terminalAPI.attachPinnedPty(daemonPtyId);
    pinnedLocalPtyIds.set(tabId, localPtyId);

    // F1/F2: wire daemon output → xterm and keyboard → daemon
    const primaryLeaf = leaves[0];
    wirePinnedSession(tabId, localPtyId, primaryLeaf);

    updatePinIcon(tabId, true);
    await saveSessionMetadata();

    showToast(`"${label}" pinned — PTY will survive app restarts`, "ok");
    console.log(
      `[pinned-ui] pinTab: tabId=${tabId} daemonPtyId=${daemonPtyId} localPtyId=${localPtyId} cwd=${resolvedCwd}`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[pinned-ui] pinTab failed:", msg);
    showToast(`Pin failed: ${msg}`, "error");
  }
}

async function unpinTab(tabId: number): Promise<void> {
  const tab = tabMap.get(tabId);
  if (!tab || !tab.pinned) return;

  const label = tabLabels.get(tabId) || `Terminal ${tabId}`;
  const daemonPtyId = tab.daemonPtyId;

  // Detach streaming proxy
  const localPtyId = pinnedLocalPtyIds.get(tabId);
  if (localPtyId !== undefined) {
    // F1/F2: unwire daemon routing before detach
    const leaves = getAllLeaves(tab.root);
    if (leaves.length > 0) {
      unwirePinnedSession(tabId, localPtyId, leaves[0]);
    } else {
      // No leaf accessible — just clean up Maps
      pinnedOnDataDisposables.get(tabId)?.dispose();
      pinnedOnDataDisposables.delete(tabId);
      pinnedSessions.delete(localPtyId);
    }
    window.terminalAPI.detachPinnedPty(localPtyId);
    pinnedLocalPtyIds.delete(tabId);
  }

  // Kill daemon PTY (orphan prevention)
  if (daemonPtyId) {
    await window.terminalAPI.killDaemonPty(daemonPtyId).catch((err) => {
      console.warn("[pinned-ui] killDaemonPty failed (orphan risk):", err);
    });
  }

  tab.pinned = false;
  tab.daemonPtyId = undefined;

  updatePinIcon(tabId, false);
  await saveSessionMetadata();

  showToast(`"${label}" unpinned`, "ok");
  console.log(`[pinned-ui] unpinTab: tabId=${tabId} daemonPtyId=${daemonPtyId ?? "none"}`);
}

// ---------------------------------------------------------------------------
// Group delete hook — kill orphan daemon PTY
// ---------------------------------------------------------------------------

/**
 * Called by closeTab (renderer.ts) before removing tab from tabMap.
 * If the group is pinned, kill daemon PTY immediately.
 */
async function cleanupPinnedOnDelete(tabId: number): Promise<void> {
  const tab = tabMap.get(tabId);
  if (!tab || !tab.pinned) return;

  const daemonPtyId = tab.daemonPtyId;

  // Detach streaming proxy
  const localPtyId = pinnedLocalPtyIds.get(tabId);
  if (localPtyId !== undefined) {
    // Clean up daemon onData disposable and pinnedSessions entry
    pinnedOnDataDisposables.get(tabId)?.dispose();
    pinnedOnDataDisposables.delete(tabId);
    pinnedSessions.delete(localPtyId);

    window.terminalAPI.detachPinnedPty(localPtyId);
    pinnedLocalPtyIds.delete(tabId);
  }

  // Kill daemon PTY
  if (daemonPtyId) {
    await window.terminalAPI.killDaemonPty(daemonPtyId).catch((err) => {
      console.warn("[pinned-ui] cleanupPinnedOnDelete: killDaemonPty failed:", err);
    });
    console.log(`[pinned-ui] cleanupPinnedOnDelete: killed daemon PTY ${daemonPtyId} for tabId=${tabId}`);
  }
}

// ---------------------------------------------------------------------------
// Detach on app quit (before-quit flow)
// ---------------------------------------------------------------------------

/**
 * Called from flushSessionMetadata / before-quit flow.
 * Detach all pinned streaming proxies so daemon PTYs survive.
 * (main.ts also calls PinnedBridge.detachAll() as safety net.)
 */
function detachAllPinnedStreams(): void {
  for (const [tabId, localPtyId] of pinnedLocalPtyIds.entries()) {
    try {
      // Dispose daemon onData handler (no need to restore — app is quitting)
      pinnedOnDataDisposables.get(tabId)?.dispose();
      pinnedSessions.delete(localPtyId);
      window.terminalAPI.detachPinnedPty(localPtyId);
      console.log(`[pinned-ui] detachAll: detached localPtyId=${localPtyId} for tabId=${tabId}`);
    } catch { /* ignore */ }
  }
  pinnedLocalPtyIds.clear();
  pinnedOnDataDisposables.clear();
}

// ---------------------------------------------------------------------------
// App restore: reconcile pinned tabs
// ---------------------------------------------------------------------------

/**
 * Called during restoreFromSaved, after sessions.json is loaded.
 * For each SavedTab with pinned=true:
 *   - If daemonPtyId exists in daemon LIST → ATTACH (reuse live PTY)
 *   - Otherwise → Sprint 1 fallback (snapshot + new PTY + divider)
 *     + toast "pinned session lost: daemon crashed" (once per restart)
 *
 * Returns a Map<daemonPtyId, daemonPtyId | null> for use in restorePaneTree.
 */
let _daemonCrashedNotified = false;

async function reconcilePinnedTabs(savedTabs: SavedTab[]): Promise<Map<string, string | null>> {
  const pinnedTabs = savedTabs.filter((t) => t.pinned && t.daemonPtyId);
  if (pinnedTabs.length === 0) {
    return new Map();
  }

  const expectedIds = pinnedTabs.map((t) => t.daemonPtyId!);
  let result: { canReattach: string[]; needFallback: string[] };

  try {
    result = await window.terminalAPI.pinnedReconcile(expectedIds);
  } catch (err) {
    console.warn("[pinned-ui] reconcile IPC failed:", err);
    result = { canReattach: [], needFallback: expectedIds };
  }

  // Build daemonPtyId → daemonPtyId | null map for reattach.
  // F5: use daemonPtyId as key (unique) instead of label (collision risk).
  const reattachSet = new Set(result.canReattach);
  const resultMap = new Map<string, string | null>();

  for (const tab of pinnedTabs) {
    if (tab.daemonPtyId) {
      if (reattachSet.has(tab.daemonPtyId)) {
        resultMap.set(tab.daemonPtyId, tab.daemonPtyId);
      } else {
        resultMap.set(tab.daemonPtyId, null); // fallback
      }
    }
  }

  // Show "daemon crashed" toast once if any fallbacks
  if (result.needFallback.length > 0 && !_daemonCrashedNotified) {
    _daemonCrashedNotified = true;
    showToast("pinned session lost: daemon crashed", "warn");
    console.warn("[pinned-ui] reconcile: daemon crash fallback for", result.needFallback);
  }

  console.log(
    `[pinned-ui] reconcile: ${result.canReattach.length} reattach, ${result.needFallback.length} fallback`
  );
  return resultMap;
}

// ---------------------------------------------------------------------------
// Attach after restore (called from restoreFromSaved for pinned tabs)
// ---------------------------------------------------------------------------

/**
 * After a pinned tab's pane tree is restored (Sprint 1 path used for display),
 * attach a streaming proxy so new keystrokes go to the daemon PTY.
 *
 * The tab's ptyId is the "localPtyId" from attachPinnedPty — but the tab was
 * already created by createPaneSession (standard path). So we need to:
 * 1. Attach pinned stream → get new localPtyId
 * 2. Wire write/resize for the tab's actual xterm session to go via pinned path
 *
 * This wiring is done by patching the session callbacks in renderer.ts.
 * Since we can't easily patch after the fact, we use a different approach:
 * the tab.daemonPtyId is set, and createPinnedPaneSession is called instead
 * of createPaneSession for pinned tabs during restore.
 *
 * See restorePinnedPaneTree below.
 */
async function attachRestoredPinnedTab(tabId: number, daemonPtyId: string): Promise<void> {
  const tab = tabMap.get(tabId);
  if (!tab) return;

  try {
    const { localPtyId } = await window.terminalAPI.attachPinnedPty(daemonPtyId);
    pinnedLocalPtyIds.set(tabId, localPtyId);
    tab.pinned = true;
    tab.daemonPtyId = daemonPtyId;

    // F3: wire daemon output → xterm and keyboard → daemon (same as pinTab)
    const leaves = getAllLeaves(tab.root);
    if (leaves.length > 0) {
      wirePinnedSession(tabId, localPtyId, leaves[0]);
    }

    updatePinIcon(tabId, true);
    console.log(
      `[pinned-ui] attachRestoredPinnedTab: tabId=${tabId} daemonPtyId=${daemonPtyId} localPtyId=${localPtyId}`
    );
  } catch (err) {
    console.warn(`[pinned-ui] attachRestoredPinnedTab failed for ${daemonPtyId}:`, err);
    // fallback: treat as non-pinned (Sprint 1 display already there)
  }
}

// ---------------------------------------------------------------------------
// Sidebar delegation hook — handle pin button clicks
// (called from initSidebarDelegation in sidebar.ts)
// ---------------------------------------------------------------------------

/**
 * Handle a click on .tab-pin-btn inside a terminal-entry.
 * Returns true if the event was consumed.
 */
function handlePinButtonClick(target: HTMLElement): boolean {
  const pinBtn = target.closest(".tab-pin-btn") as HTMLElement | null;
  if (!pinBtn) return false;

  const li = target.closest(".terminal-entry") as HTMLLIElement | null;
  if (!li) return false;

  const tabId = Number(li.dataset.id);
  if (isNaN(tabId)) return false;

  togglePinTab(tabId);
  return true;
}
