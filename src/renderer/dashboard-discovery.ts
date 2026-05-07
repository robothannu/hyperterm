/// <reference path="./global.d.ts" />

// ---------------------------------------------------------------------------
// Dashboard Discovery banner & modal — split out of dashboard.ts (Sprint 3).
// Loaded as a plain <script> after dashboard.js so it shares the global scope.
// State that lives here:
//   - _discoveryCandidates  (fetched on boot/refresh)
//   - _discoveryDismissed   (renderer-only, cleared on window close)
// dashboard.ts calls fetchDiscoveryCandidates() and renderDiscoveryBanner()
// from its render path; openDiscoveryModal()/closeDiscoveryModal() are wired
// here. ESC handler in dashboard.ts still calls closeDiscoveryModal() as part
// of a global keyup handler — declared in global.d.ts.
// ---------------------------------------------------------------------------

declare function dashEsc(s: string): string;
declare function abbreviateHomePath(absPath: string, homeDir: string): string;
declare function render(): void;
declare function loadAndRender(): Promise<void>;
declare function showDashboardToast(msg: string, variant?: "ok" | "warn" | "err"): void;
declare var _workspaces: WorkspaceEntry[];
declare var _filter: string;
declare var _search: string;
declare var _homeDir: string;

// Sprint 3: discovery banner state.
// _discoveryDismissed is renderer-only (cleared on window close).
var _discoveryCandidates: DashboardDiscoveryCandidate[] = [];
var _discoveryDismissed: boolean = false;

// Fetch candidate git repos from main process and store in module state.
// Safe to call multiple times — boot, refresh, and after batch add.
async function fetchDiscoveryCandidates(): Promise<void> {
  if (!window.dashboardAPI) return;
  try {
    var list = await window.dashboardAPI.discoverCandidates();
    _discoveryCandidates = Array.isArray(list) ? list : [];
    console.log(`[dashboard] discovery: ${_discoveryCandidates.length} candidate(s)`);
  } catch (err) {
    console.warn("[dashboard] discovery fetch failed:", err);
    _discoveryCandidates = [];
  }
}

function shouldShowDiscoveryBanner(): boolean {
  if (_discoveryDismissed) return false;
  if (_discoveryCandidates.length === 0) return false;
  if (_filter !== "all") return false;
  if (_search !== "") return false;
  return true;
}

function groupDiscoveryByRoot(
  candidates: DashboardDiscoveryCandidate[]
): { root: string; names: string[] }[] {
  var byRoot = new Map<string, string[]>();
  for (var c of candidates) {
    var arr = byRoot.get(c.root);
    if (!arr) {
      arr = [];
      byRoot.set(c.root, arr);
    }
    arr.push(c.name);
  }
  var out: { root: string; names: string[] }[] = [];
  byRoot.forEach((names, root) => out.push({ root, names }));
  return out;
}

function buildDiscoveryTitle(candidates: DashboardDiscoveryCandidate[]): string {
  var groups = groupDiscoveryByRoot(candidates);
  var rootSpans = groups
    .map((g) => `<span class="mono">${dashEsc(abbreviateHomePath(g.root, _homeDir))}</span>`)
    .join(", ");
  var n = candidates.length;
  var label = n === 1 ? "repository" : "repositories";
  return `Found ${n} git ${label} in ${rootSpans}`;
}

function buildDiscoverySub(candidates: DashboardDiscoveryCandidate[]): string {
  var MAX_NAMES = 5;
  var names = candidates.map((c) => c.name);
  if (names.length <= MAX_NAMES) {
    return dashEsc(names.join(", ")) + " — Add as workspaces?";
  }
  var head = names.slice(0, MAX_NAMES).join(", ");
  var rest = names.length - MAX_NAMES;
  return dashEsc(head) + ` … +${rest} more — Add as workspaces?`;
}

function renderDiscoveryBanner(content: HTMLElement): void {
  if (!shouldShowDiscoveryBanner()) return;

  var banner = document.createElement("div");
  banner.className = "discover";
  banner.innerHTML = `
    <div class="ico" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M8 1v4M8 11v4M1 8h4M11 8h4M3.2 3.2l2.8 2.8M10 10l2.8 2.8M12.8 3.2L10 6M6 10l-2.8 2.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
      </svg>
    </div>
    <div class="body">
      <div class="title">${buildDiscoveryTitle(_discoveryCandidates)}</div>
      <div class="sub">${buildDiscoverySub(_discoveryCandidates)}</div>
    </div>
    <button class="btn primary" id="discover-review">Review</button>
    <button class="btn" id="discover-dismiss">Dismiss</button>
  `;

  if (content.firstChild) {
    content.insertBefore(banner, content.firstChild);
  } else {
    content.appendChild(banner);
  }

  var reviewBtn = banner.querySelector("#discover-review") as HTMLButtonElement | null;
  if (reviewBtn) {
    reviewBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openDiscoveryModal();
    });
  }
  var dismissBtn = banner.querySelector("#discover-dismiss") as HTMLButtonElement | null;
  if (dismissBtn) {
    dismissBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      handleDiscoveryDismiss();
    });
  }
}

function handleDiscoveryDismiss(): void {
  _discoveryDismissed = true;
  console.log("[dashboard] discovery: dismissed for this session");
  render();
}

// --- Review modal ---

function openDiscoveryModal(): void {
  var modal = document.getElementById("discover-modal");
  var listEl = document.getElementById("discover-modal-list");
  var subEl = document.getElementById("discover-modal-sub");
  var summaryEl = document.getElementById("discover-modal-summary");
  if (!modal || !listEl || !subEl || !summaryEl) return;

  var groups = groupDiscoveryByRoot(_discoveryCandidates);
  var html = "";
  for (var g of groups) {
    var rootLabel = abbreviateHomePath(g.root, _homeDir);
    html += `<div style="font-size:11px;color:var(--fg-3);text-transform:uppercase;letter-spacing:0.06em;padding:8px 12px 4px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${dashEsc(rootLabel)}</div>`;
    for (var c of _discoveryCandidates.filter((x) => x.root === g.root)) {
      var displayPath = abbreviateHomePath(c.absolutePath, _homeDir);
      html += `
        <label class="dc-item">
          <input type="checkbox" class="dc-check" data-path="${dashEsc(c.absolutePath)}" checked />
          <div class="dc-meta">
            <div class="dc-name">${dashEsc(c.name)}</div>
            <div class="dc-path" title="${dashEsc(c.absolutePath)}">${dashEsc(displayPath)}</div>
          </div>
        </label>
      `;
    }
  }
  listEl.innerHTML = html;
  subEl.textContent = `${_discoveryCandidates.length} repositor${_discoveryCandidates.length === 1 ? "y" : "ies"} discovered. Uncheck to skip.`;

  var checks = listEl.querySelectorAll(".dc-check") as NodeListOf<HTMLInputElement>;
  checks.forEach((chk) => {
    chk.addEventListener("change", updateDiscoveryModalSummary);
  });

  updateDiscoveryModalSummary();
  modal.classList.add("open");
  console.log("[dashboard] discovery: modal opened");
}

function updateDiscoveryModalSummary(): void {
  var summaryEl = document.getElementById("discover-modal-summary");
  if (!summaryEl) return;
  var checks = document.querySelectorAll("#discover-modal-list .dc-check") as NodeListOf<HTMLInputElement>;
  var checked = 0;
  checks.forEach((c) => { if (c.checked) checked++; });
  summaryEl.textContent = `${checked} selected`;
}

function closeDiscoveryModal(): void {
  var modal = document.getElementById("discover-modal");
  if (modal) modal.classList.remove("open");
}

async function handleDiscoveryAddSelected(): Promise<void> {
  var api = window.dashboardAPI;
  if (!api) return;

  var checks = document.querySelectorAll("#discover-modal-list .dc-check") as NodeListOf<HTMLInputElement>;
  var paths: string[] = [];
  checks.forEach((c) => {
    if (c.checked) {
      var p = c.dataset.path;
      if (p) paths.push(p);
    }
  });

  if (paths.length === 0) {
    showDashboardToast("No repositories selected.", "warn");
    return;
  }

  var confirmBtn = document.getElementById("discover-modal-confirm") as HTMLButtonElement | null;
  if (confirmBtn) confirmBtn.disabled = true;

  try {
    var result = await api.addWorkspacesBatch(paths);
    _workspaces = result.workspaces;

    var addedN = result.added.length;
    var failedN = result.failed.length;
    console.log(`[dashboard] discovery: batch add added=${addedN} failed=${failedN}`);

    closeDiscoveryModal();

    await fetchDiscoveryCandidates();
    await loadAndRender();
    if (typeof window.resetAutoRefresh === "function") window.resetAutoRefresh();

    if (addedN > 0 && failedN === 0) {
      showDashboardToast(
        `Added ${addedN} workspace${addedN === 1 ? "" : "s"}.`,
        "ok"
      );
    } else if (addedN > 0 && failedN > 0) {
      showDashboardToast(
        `Added ${addedN}, ${failedN} skipped (${result.failed[0].reason}).`,
        "warn"
      );
    } else {
      var reason = result.failed.length > 0 ? result.failed[0].reason : "unknown";
      showDashboardToast(`Failed to add: ${reason}`, "err");
    }
  } catch (err) {
    var msg = err instanceof Error ? err.message : String(err);
    console.error("[dashboard] discovery: batch add failed:", err);
    showDashboardToast(`Batch add failed: ${msg}`, "err");
  } finally {
    if (confirmBtn) confirmBtn.disabled = false;
  }
}

// Wiring for the Review modal's Cancel/Confirm buttons + backdrop click.
// Called from dashboard.ts boot.
function initDiscoveryModalControls(): void {
  var dmCancel = document.getElementById("discover-modal-cancel");
  if (dmCancel) {
    dmCancel.addEventListener("click", (e) => {
      e.stopPropagation();
      closeDiscoveryModal();
    });
  }
  var dmConfirm = document.getElementById("discover-modal-confirm");
  if (dmConfirm) {
    dmConfirm.addEventListener("click", (e) => {
      e.stopPropagation();
      void handleDiscoveryAddSelected();
    });
  }
  var dmBackdrop = document.getElementById("discover-modal");
  if (dmBackdrop) {
    dmBackdrop.addEventListener("click", (e) => {
      if (e.target === dmBackdrop) closeDiscoveryModal();
    });
  }
}
