// dashboard-autorefresh.ts — auto-refresh timer for Dashboard window
//
// Design:
//   - Single active interval at all times (invariant: at most 1 _timerId active)
//   - Pauses when document is hidden (background / minimized) — zero background load
//   - On user action: resetAutoRefresh() delays the next tick so the action's
//     own loadAndRender() call isn't immediately followed by another tick
//   - Each refresh cycle logs duration + workspace count (AC #7 monitoring)
//
// Interval: DASHBOARD_REFRESH_MS constant (60 000 ms default). Change here to
// adjust globally — or override via the numeric constant before shipping.

const DASHBOARD_REFRESH_MS = 60_000;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

var _timerId: ReturnType<typeof setInterval> | null = null;
var _cycleCount = 0;

// ---------------------------------------------------------------------------
// Internal tick
// ---------------------------------------------------------------------------

function _tick(): void {
  _cycleCount += 1;
  var cycleN = _cycleCount;
  var t0 = performance.now();

  // loadAndRender is registered by dashboard.ts boot section
  var renderFn = (window as any).__dashboardLoadAndRender as (() => Promise<void>) | undefined;
  if (typeof renderFn !== "function") {
    console.warn("[dashboard-refresh] __dashboardLoadAndRender not registered — skipping tick");
    return;
  }

  void renderFn().then(() => {
    var ms = Math.round(performance.now() - t0);
    var wsCount = ((window as any).__dashboardWorkspaceCount as number | undefined) ?? "?";
    console.log(`[dashboard-refresh] cycle ${cycleN} — ${ms}ms — ${wsCount} workspaces`);
  }).catch((err: unknown) => {
    console.error("[dashboard-refresh] cycle error:", err);
  });
}

// ---------------------------------------------------------------------------
// Timer control (exported as globals for dashboard.ts to call)
// ---------------------------------------------------------------------------

function startAutoRefresh(): void {
  if (_timerId !== null) return; // invariant: only 1 active timer
  _timerId = setInterval(_tick, DASHBOARD_REFRESH_MS);
}

function stopAutoRefresh(): void {
  if (_timerId === null) return;
  clearInterval(_timerId);
  _timerId = null;
}

// Stop + start so the next tick is DASHBOARD_REFRESH_MS after the user action.
// Call this immediately after any user action that already called loadAndRender().
function resetAutoRefresh(): void {
  stopAutoRefresh();
  startAutoRefresh();
}

// ---------------------------------------------------------------------------
// Visibility handler
// ---------------------------------------------------------------------------

function setupVisibilityHandler(): void {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      // Page hidden — pause timer entirely (zero background load)
      stopAutoRefresh();
      console.log("[dashboard-refresh] paused (hidden)");
    } else {
      // Page visible again — immediate 1 refresh then restart timer
      var renderFn = (window as any).__dashboardLoadAndRender as (() => Promise<void>) | undefined;
      if (typeof renderFn === "function") {
        void renderFn().catch((err: unknown) => {
          console.error("[dashboard-refresh] visibility refresh error:", err);
        });
      }
      resetAutoRefresh();
      console.log("[dashboard-refresh] resumed (visible)");
    }
  });
}

// ---------------------------------------------------------------------------
// Public entry point — called once from dashboard.ts boot section
// ---------------------------------------------------------------------------

function setupAutoRefresh(): void {
  setupVisibilityHandler();
  if (!document.hidden) {
    startAutoRefresh();
  }
}

// Expose to window so dashboard.ts can call via (window as any) after this
// script loads (dashboard-autorefresh.js is listed before dashboard.js in
// dashboard.html, so these symbols are available when dashboard.ts runs).
(window as any).setupAutoRefresh = setupAutoRefresh;
(window as any).resetAutoRefresh = resetAutoRefresh;
