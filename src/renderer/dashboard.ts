/// <reference path="./global.d.ts" />
// Dashboard renderer — Phase A Sprint 1: design-v2 layout
// Vanilla TS + DOM API, no import/export (compiled to CommonJS, loaded via <script>).

// ---------------------------------------------------------------------------
// Vendor lib declarations
// ---------------------------------------------------------------------------

declare const marked: {
  parse(src: string, options?: { gfm?: boolean; breaks?: boolean }): string;
};

declare const DOMPurify: {
  sanitize(dirty: string, config?: { FORBID_TAGS?: string[]; FORBID_ATTR?: string[] }): string;
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CardMeta {
  ws: WorkspaceEntry;
  // Derived from IPC calls — populated async
  gitBranch: string | null;
  gitAhead: number;
  gitBehind: number;
  gitChanged: number;
  gitUntracked: number;
  gitLastCommit: string | null;
  gitDirty: boolean;
  isRunning: boolean;    // harnessPhase != null
  isOpen: boolean;       // sessions.json has open cwd
  isMissing: boolean;
  goal: string | null;
  currentTask: string | null;
  nextSteps: string[];
  tags: string[];
  group: "active" | "recent" | "archived";
  updatedLabel: string;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

var _workspaces: WorkspaceEntry[] = [];
var _cardMetas: CardMeta[] = [];
var _view: "grid" | "list" = "grid";
var _filter: string = "all";
var _search: string = "";
var _toastTimer: ReturnType<typeof setTimeout> | null = null;

// ---------------------------------------------------------------------------
// Persist view/filter to localStorage
// ---------------------------------------------------------------------------

var PREF_VIEW = "dashboard.v2.view";
var PREF_FILTER = "dashboard.v2.filter";

function loadPrefs(): void {
  try {
    var v = localStorage.getItem(PREF_VIEW);
    if (v === "list" || v === "grid") _view = v;
    var f = localStorage.getItem(PREF_FILTER);
    if (f) _filter = f;
  } catch (_) { /* ignore */ }
}

function savePrefs(): void {
  try {
    localStorage.setItem(PREF_VIEW, _view);
    localStorage.setItem(PREF_FILTER, _filter);
  } catch (_) { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

function showDashboardToast(msg: string, variant: "ok" | "warn" | "err" = "ok"): void {
  var el = document.getElementById("toast") as HTMLElement;
  el.textContent = msg;
  el.className = "visible " + variant;
  if (_toastTimer !== null) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    el.className = "";
    _toastTimer = null;
  }, 2800);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dashEsc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function mdInline(s: string | null): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

// Returns icon letter + color class for a workspace name
function wsIconInfo(name: string): { letter: string; color: string } {
  var colors = ["purple", "cyan", "pink", "green", "yellow"];
  var letter = name.charAt(0).toUpperCase() || "W";
  var hash = 0;
  for (var i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) & 0xffffffff;
  var color = colors[Math.abs(hash) % colors.length];
  return { letter, color };
}

// Relative time from ISO string
function relTime(isoStr: string): string {
  try {
    var d = new Date(isoStr);
    var diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return Math.floor(diff / 60) + "m ago";
    if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
    if (diff < 86400 * 7) return Math.floor(diff / 86400) + "d ago";
    return d.toLocaleDateString();
  } catch (_) {
    return "";
  }
}

// Age in milliseconds from ISO string (or 0 if parse fails)
function ageMs(isoStr: string): number {
  try {
    return Date.now() - new Date(isoStr).getTime();
  } catch (_) {
    return 0;
  }
}

var MS_24H = 24 * 60 * 60 * 1000;
var MS_7D  = 7  * 24 * 60 * 60 * 1000;
var MS_4W  = 28 * 24 * 60 * 60 * 1000;

/**
 * Classify a workspace into active/recent/archived.
 * - archived: ws.archived === true  OR  4+ weeks since addedAt AND no recent git activity
 * - active:   isOpen, isRunning, gitDirty, gitChanged > 0, OR last commit < 24h
 * - recent:   last commit/activity < 7 days
 * - archived: everything else (>= 7d, no activity)
 *
 * ws.archived flag always wins (sticky).
 */
function classifyGroup(
  ws: WorkspaceEntry,
  isOpen: boolean,
  isRunning: boolean,
  gitDirty: boolean,
  gitChanged: number,
  gitLastCommit: string | null
): "active" | "recent" | "archived" {
  // archived flag wins
  if (ws.archived === true) return "archived";

  // Active: open session, harness running, dirty tree, or last commit < 24h
  if (isOpen || isRunning || gitDirty || gitChanged > 0) return "active";

  // Try to interpret gitLastCommit relative time string into rough age
  // The string comes from `git log -1 --pretty=format:%cr` (e.g. "3 minutes ago", "2 days ago")
  if (gitLastCommit) {
    var lastAge = parseGitRelTimeMs(gitLastCommit);
    if (lastAge !== null) {
      if (lastAge < MS_24H) return "active";
      if (lastAge < MS_7D)  return "recent";
      if (lastAge < MS_4W)  return "recent"; // still recent within 4 weeks
      return "archived";
    }
  }

  // Fallback: use addedAt age
  var age = ageMs(ws.addedAt);
  if (age < MS_7D) return "recent";
  return "archived";
}

/**
 * Parse git relative time string (e.g. "3 minutes ago", "2 days ago", "1 hour ago")
 * into approximate milliseconds. Returns null if unparseable.
 */
function parseGitRelTimeMs(rel: string): number | null {
  var m = rel.match(/^(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/i);
  if (!m) return null;
  var n = parseInt(m[1], 10);
  var unit = m[2].toLowerCase();
  var ms: Record<string, number> = {
    second: 1000,
    minute: 60 * 1000,
    hour:   60 * 60 * 1000,
    day:    24 * 60 * 60 * 1000,
    week:   7 * 24 * 60 * 60 * 1000,
    month:  30 * 24 * 60 * 60 * 1000,
    year:   365 * 24 * 60 * 60 * 1000,
  };
  return ms[unit] ? n * ms[unit] : null;
}

// ---------------------------------------------------------------------------
// Count helpers for filter chips
// ---------------------------------------------------------------------------

function computeCounts(metas: CardMeta[]): Record<string, number> {
  var counts: Record<string, number> = { all: 0, active: 0, dirty: 0, running: 0, archived: 0 };
  for (var m of metas) {
    counts.all++;
    if (m.isOpen || m.group === "active") counts.active++;
    if (m.gitDirty || m.gitChanged > 0) counts.dirty++;
    if (m.isRunning) counts.running++;
    if (m.group === "archived") counts.archived++;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Filter logic
// ---------------------------------------------------------------------------

function filterMetas(metas: CardMeta[]): CardMeta[] {
  return metas.filter((m) => {
    // Status filter
    if (_filter === "active" && !m.isOpen && m.group !== "active") return false;
    if (_filter === "dirty" && !m.gitDirty && m.gitChanged === 0) return false;
    if (_filter === "running" && !m.isRunning) return false;
    if (_filter === "archived" && m.group !== "archived") return false;

    // Search filter
    if (_search) {
      var s = _search.toLowerCase();
      var blob = [
        m.ws.name,
        m.ws.absolutePath,
        m.gitBranch || "",
        m.goal || "",
        m.currentTask || "",
        m.tags.join(" "),
        m.nextSteps.join(" "),
      ].join(" ").toLowerCase();
      if (!blob.includes(s)) return false;
    }

    return true;
  });
}

// ---------------------------------------------------------------------------
// Card rendering (design-v2 structure)
// ---------------------------------------------------------------------------

function renderCard(m: CardMeta): HTMLElement {
  var card = document.createElement("div");

  // Color strip class
  var stripClass = "";
  if (m.gitChanged > 0 || m.gitDirty) stripClass = "dirty";
  else if (m.isRunning) stripClass = "running";
  else if (m.gitBehind > 0) stripClass = "behind";

  card.className = "ws-card" + (stripClass ? " " + stripClass : "") + (m.isMissing ? " missing" : "");
  card.dataset.id = m.ws.id;

  var iconInfo = wsIconInfo(m.ws.name);

  // === Card head ===
  var archiveLabel = m.ws.archived ? "Unarchive" : "Archive";
  var quickActionsHTML = `
    <div class="card-quick">
      <button class="qbtn" title="Open in terminal" data-action="open" data-path="${dashEsc(m.ws.absolutePath)}">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 5l3 3-3 3M8 11h5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <button class="qbtn" title="${archiveLabel}" data-action="archive-toggle" data-id="${dashEsc(m.ws.id)}" data-archived="${m.ws.archived ? "true" : "false"}">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="2" y="5" width="12" height="9" rx="1" stroke="currentColor" stroke-width="1.3"/><path d="M5 5V3.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 .5.5V5" stroke="currentColor" stroke-width="1.3"/><path d="M6 9h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
      </button>
      <button class="qbtn btn-remove" title="Remove workspace" data-action="remove" data-id="${dashEsc(m.ws.id)}">
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>
    </div>
  `;

  card.innerHTML = `
    <div class="card-head">
      <div class="ws-icon ${dashEsc(iconInfo.color)}">${dashEsc(iconInfo.letter)}</div>
      <div class="card-titlewrap">
        <div class="card-title">${dashEsc(m.ws.name)}</div>
        <div class="card-path" title="${dashEsc(m.ws.absolutePath)}">${dashEsc(m.ws.absolutePath)}</div>
      </div>
      ${quickActionsHTML}
    </div>
    <div class="status-strip skeleton-strip" id="ss-${dashEsc(m.ws.id)}">
      <span class="skeleton-block" style="width:40px"></span>
      <span class="skeleton-block" style="width:60px"></span>
      <span class="skeleton-block" style="width:30px"></span>
    </div>
    <div class="card-body skeleton-body" id="cb-${dashEsc(m.ws.id)}">
      <span class="skeleton-block" style="width:90%"></span>
      <span class="skeleton-block" style="width:70%"></span>
    </div>
    <div class="card-foot">
      <span class="updated" id="upd-${dashEsc(m.ws.id)}">${dashEsc(m.updatedLabel)}</span>
      <button class="open-btn primary" data-action="open" data-path="${dashEsc(m.ws.absolutePath)}" ${m.isMissing ? "disabled" : ""}>
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M6 3H3v10h10V10M9 3h4v4M13 3L7 9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Open
      </button>
    </div>
  `;

  // Wire quick action buttons
  card.querySelectorAll("[data-action]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      var btn = e.currentTarget as HTMLElement;
      var action = btn.getAttribute("data-action");
      if (action === "open") {
        var p = btn.getAttribute("data-path");
        if (p) void handleOpen(p);
      } else if (action === "reveal") {
        showDashboardToast("Reveal in Finder — coming in Sprint 3", "warn");
      } else if (action === "remove") {
        var id = btn.getAttribute("data-id");
        if (id) void handleRemove(id);
      } else if (action === "archive-toggle") {
        var toggleId = btn.getAttribute("data-id");
        var currentArchived = btn.getAttribute("data-archived") === "true";
        if (toggleId) void handleArchiveToggle(toggleId, !currentArchived);
      }
    });
  });

  // Card-level click = open
  card.addEventListener("click", () => {
    if (m.isMissing) { showDashboardToast("Folder not found on disk.", "warn"); return; }
    void handleOpen(m.ws.absolutePath);
  });

  return card;
}

// Populate status strip + card body once IPC data is available
function populateCardData(m: CardMeta): void {
  var ssEl = document.getElementById("ss-" + m.ws.id);
  var cbEl = document.getElementById("cb-" + m.ws.id);
  var updEl = document.getElementById("upd-" + m.ws.id);
  if (!ssEl || !cbEl) return;

  // Remove skeleton classes
  ssEl.classList.remove("skeleton-strip");
  cbEl.classList.remove("skeleton-body");

  // Update footer timestamp
  if (updEl) updEl.textContent = m.updatedLabel;

  // Status strip
  var statusItems: string[] = [];

  if (m.isOpen) {
    statusItems.push(`<span class="ss-item live"><span class="dot"></span>live</span>`);
  }
  if (m.isRunning) {
    statusItems.push(`<span class="ss-item"><span style="color:var(--warn)">&#9679;</span> harness</span>`);
  }
  if (m.gitBranch) {
    statusItems.push(`<span class="ss-item"><span class="branch">&#10567; ${dashEsc(m.gitBranch)}</span></span>`);
  }
  if (m.gitAhead > 0) {
    statusItems.push(`<span class="ss-item"><span class="ahead">&#8593;${m.gitAhead}</span></span>`);
  }
  if (m.gitBehind > 0) {
    statusItems.push(`<span class="ss-item"><span class="behind">&#8595;${m.gitBehind}</span></span>`);
  }
  if (m.gitChanged > 0) {
    statusItems.push(`<span class="ss-item"><span class="changed">&#9679;${m.gitChanged}</span></span>`);
  }
  if (m.gitBranch && !m.gitDirty && m.gitChanged === 0 && m.gitUntracked === 0) {
    statusItems.push(`<span class="ss-item"><span class="clean">&#10003; clean</span></span>`);
  }
  if (!m.gitBranch && !m.isOpen && !m.isRunning) {
    statusItems.push(`<span class="ss-item" style="color:var(--fg-3);font-style:italic">git unavailable</span>`);
  }
  if (m.gitLastCommit) {
    statusItems.push(`<span class="ss-item ago" style="margin-left:auto">${dashEsc(m.gitLastCommit)}</span>`);
  }

  ssEl.innerHTML = statusItems.length ? statusItems.join("") : `<span class="card-absent">no git info</span>`;

  // Tags row (before card body) — insert if tags exist
  var existingTags = document.getElementById("tr-" + m.ws.id);
  if (existingTags) existingTags.remove();

  if (m.tags.length > 0) {
    var tagsRow = document.createElement("div");
    tagsRow.className = "tags-row";
    tagsRow.id = "tr-" + m.ws.id;
    for (var tag of m.tags) {
      var cls = tag === "archived" ? "gray" : tag === "harness" ? "warn" : tag === "open" ? "cyan" : "";
      tagsRow.innerHTML += `<span class="tag ${cls}">${dashEsc(tag)}</span>`;
    }
    // Insert tags-row after status-strip
    var ssEl2 = document.getElementById("ss-" + m.ws.id);
    if (ssEl2 && ssEl2.nextSibling) {
      ssEl2.parentElement!.insertBefore(tagsRow, ssEl2.nextSibling);
    }
  }

  // Card body
  if (m.isMissing) {
    cbEl.innerHTML = `<span class="card-absent">Folder not found on disk.</span>`;
    return;
  }

  var bodyParts: string[] = [];

  if (m.goal) {
    bodyParts.push(`
      <div class="field">
        <div class="field-label">Goal</div>
        <div class="field-value">${mdInline(m.goal)}</div>
      </div>
    `);
  }

  if (m.currentTask) {
    bodyParts.push(`
      <div class="field">
        <div class="field-label">Current</div>
        <div class="field-value">${mdInline(m.currentTask)}</div>
      </div>
    `);
  }

  if (m.nextSteps.length > 0) {
    var firstTodo = m.nextSteps[0];
    var moreTodos = m.nextSteps.slice(1);
    var moreCount = moreTodos.length;
    var firstHTML = `<li class="todo-item"><span>${mdInline(firstTodo)}</span></li>`;
    var moreItemsHTML = moreCount > 0
      ? moreTodos.map((step) => `<li class="todo-item todo-extra" style="display:none"><span>${mdInline(step)}</span></li>`).join("")
      : "";
    var toggleId = "todo-toggle-" + m.ws.id;
    var expandHTML = moreCount > 0
      ? `<div class="todo-more" id="${dashEsc(toggleId)}" data-expanded="false">+${moreCount} more</div>`
      : "";
    bodyParts.push(`
      <div class="field">
        <div class="field-label">Next</div>
        <div class="field-value">
          <ul class="todo-list" id="todo-list-${dashEsc(m.ws.id)}">${firstHTML}${moreItemsHTML}</ul>
          ${expandHTML}
        </div>
      </div>
    `);
  }

  if (bodyParts.length === 0) {
    bodyParts.push(`<span class="card-absent">No overview data — add CLAUDE.md or progress.md</span>`);
  }

  cbEl.innerHTML = bodyParts.join("");

  // Wire +N more toggle for todos
  var toggleEl = document.getElementById("todo-toggle-" + m.ws.id);
  if (toggleEl) {
    (function(tEl: HTMLElement) {
      tEl.addEventListener("click", (e) => {
        e.stopPropagation();
        var expanded = tEl.getAttribute("data-expanded") === "true";
        var listEl2 = document.getElementById("todo-list-" + m.ws.id);
        if (!listEl2) return;
        var extras = listEl2.querySelectorAll(".todo-extra") as NodeListOf<HTMLElement>;
        var newExpanded = !expanded;
        extras.forEach((el) => { el.style.display = newExpanded ? "" : "none"; });
        tEl.setAttribute("data-expanded", newExpanded ? "true" : "false");
        var moreCount2 = extras.length;
        tEl.textContent = newExpanded ? "Show less" : "+" + moreCount2 + " more";
      });
    })(toggleEl);
  }
}

// ---------------------------------------------------------------------------
// List row rendering
// ---------------------------------------------------------------------------

function renderListRow(m: CardMeta): HTMLElement {
  var row = document.createElement("div");
  row.className = "list-row";
  row.dataset.id = m.ws.id;

  var iconInfo = wsIconInfo(m.ws.name);

  var gitCells: string[] = [];
  if (m.gitBranch) gitCells.push(`<span class="branch">&#10567; ${dashEsc(m.gitBranch)}</span>`);
  if (m.gitAhead > 0) gitCells.push(`<span style="color:var(--warn)">&#8593;${m.gitAhead}</span>`);
  if (m.gitBehind > 0) gitCells.push(`<span style="color:var(--cyan)">&#8595;${m.gitBehind}</span>`);
  if (m.gitChanged > 0) gitCells.push(`<span class="changed">&#9679;${m.gitChanged}</span>`);
  if (!m.gitBranch || (!m.gitDirty && m.gitChanged === 0)) gitCells.push(`<span style="color:var(--ok)">&#10003;</span>`);

  row.innerHTML = `
    <div class="ws-icon ${dashEsc(iconInfo.color)}" style="width:24px;height:24px;font-size:11px;border-radius:5px">${dashEsc(iconInfo.letter)}</div>
    <div class="lr-name">${dashEsc(m.ws.name)}<span class="lr-path">${dashEsc(m.ws.absolutePath)}</span></div>
    <div class="lr-summary">${dashEsc(m.currentTask || m.goal || "—")}</div>
    <div class="lr-git">${gitCells.join(" ")}</div>
    <div class="lr-updated">${dashEsc(m.updatedLabel)}</div>
    <div class="lr-actions">
      <button class="qbtn" title="Open" data-action="open" data-path="${dashEsc(m.ws.absolutePath)}">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 5l3 3-3 3M8 11h5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <button class="open-btn primary" data-action="open" data-path="${dashEsc(m.ws.absolutePath)}">Open</button>
    </div>
  `;

  row.querySelectorAll("[data-action]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      var p = (e.currentTarget as HTMLElement).getAttribute("data-path");
      if (p) void handleOpen(p);
    });
  });

  row.addEventListener("click", () => {
    if (m.isMissing) { showDashboardToast("Folder not found on disk.", "warn"); return; }
    void handleOpen(m.ws.absolutePath);
  });

  return row;
}

// ---------------------------------------------------------------------------
// Render (main)
// ---------------------------------------------------------------------------

function render(): void {
  var content = document.getElementById("content") as HTMLDivElement;
  var emptyState = document.getElementById("empty-state") as HTMLDivElement;

  if (_cardMetas.length === 0) {
    emptyState.style.display = "";
    // Clear previous content except empty-state
    content.querySelectorAll(":not(#empty-state)").forEach((el) => el.remove());
    return;
  }

  emptyState.style.display = "none";
  // Remove all previous rendered nodes
  content.querySelectorAll(".ws-grid,.ws-list,.group-header,#no-match").forEach((el) => el.remove());

  // Update chip counts
  var counts = computeCounts(_cardMetas);
  var countAll = document.getElementById("count-all");
  var countActive = document.getElementById("count-active");
  var countDirty = document.getElementById("count-dirty");
  var countRunning = document.getElementById("count-running");
  var countArchived = document.getElementById("count-archived");
  if (countAll) countAll.textContent = String(counts.all);
  if (countActive) countActive.textContent = String(counts.active);
  if (countDirty) countDirty.textContent = String(counts.dirty);
  if (countRunning) countRunning.textContent = String(counts.running);
  if (countArchived) countArchived.textContent = String(counts.archived);

  // Log group classification result once per render
  var gActive = _cardMetas.filter((m) => m.group === "active").length;
  var gRecent = _cardMetas.filter((m) => m.group === "recent").length;
  var gArchived = _cardMetas.filter((m) => m.group === "archived").length;
  console.log(`[dashboard] grouped active=${gActive} recent=${gRecent} archived=${gArchived}`);

  var visible = filterMetas(_cardMetas);
  var filterName = _filter;
  console.log(`[dashboard] view=${_view} filter=${filterName} count=${visible.length}`);

  if (visible.length === 0) {
    var noMatch = document.createElement("div");
    noMatch.id = "no-match";
    noMatch.innerHTML = `<div class="nm-title">No workspaces match</div><div>Try a different filter or search term.</div>`;
    content.appendChild(noMatch);
    return;
  }

  if (_view === "grid") {
    renderGrid(content, visible);
    // Populate card bodies after DOM is built — runs on every render() call
    // (covers chip click, view toggle, search, and initial load)
    for (var i = 0; i < visible.length; i++) {
      populateCardData(visible[i]);
    }
  } else {
    renderList(content, visible);
  }
}

function renderGrid(container: HTMLElement, metas: CardMeta[]): void {
  var grouped: Record<string, CardMeta[]> = { active: [], recent: [], archived: [] };
  for (var m of metas) {
    grouped[m.group] = grouped[m.group] || [];
    grouped[m.group].push(m);
  }

  if (grouped.active && grouped.active.length > 0) {
    container.appendChild(makeGroupHeader("Active", grouped.active.length, "var(--ok)"));
    container.appendChild(makeGrid(grouped.active));
  }
  if (grouped.recent && grouped.recent.length > 0) {
    container.appendChild(makeGroupHeader("Recent", grouped.recent.length, "var(--fg-3)"));
    container.appendChild(makeGrid(grouped.recent));
  }
  if (grouped.archived && grouped.archived.length > 0) {
    container.appendChild(makeGroupHeader("Archived", grouped.archived.length, "var(--fg-3)"));
    var g = makeGrid(grouped.archived);
    g.style.opacity = "0.65";
    container.appendChild(g);
  }
}

function makeGroupHeader(label: string, count: number, dotColor: string): HTMLElement {
  var h = document.createElement("div");
  h.className = "group-header";
  h.innerHTML = `<span style="color:${dotColor}">&#9679;</span> ${dashEsc(label)} <span class="count">${count}</span><span class="line"></span>`;
  return h;
}

function makeGrid(metas: CardMeta[]): HTMLDivElement {
  var grid = document.createElement("div");
  grid.className = "ws-grid";
  for (var m of metas) {
    grid.appendChild(renderCard(m));
  }
  return grid;
}

function renderList(container: HTMLElement, metas: CardMeta[]): void {
  var listEl = document.createElement("div");
  listEl.className = "ws-list";

  var header = document.createElement("div");
  header.className = "list-header";
  header.innerHTML = `<span></span><span>Workspace</span><span>Current task</span><span>Git</span><span>Updated</span><span></span>`;
  listEl.appendChild(header);

  for (var m of metas) {
    listEl.appendChild(renderListRow(m));
  }

  container.appendChild(listEl);
}

// ---------------------------------------------------------------------------
// Async data loading: build CardMeta from WorkspaceEntry + IPC
// ---------------------------------------------------------------------------

async function buildCardMeta(ws: WorkspaceEntry): Promise<CardMeta> {
  var api = window.dashboardAPI!;
  // Initial group from archived flag (will be refined after IPC completes)
  var initialGroup: "active" | "recent" | "archived" = ws.archived === true ? "archived" : "recent";

  var meta: CardMeta = {
    ws,
    gitBranch: null,
    gitAhead: 0,
    gitBehind: 0,
    gitChanged: 0,
    gitUntracked: 0,
    gitLastCommit: null,
    gitDirty: false,
    isRunning: false,
    isOpen: false,
    isMissing: false,
    goal: null,
    currentTask: null,
    nextSteps: [],
    tags: [],
    group: initialGroup,
    updatedLabel: relTime(ws.addedAt),
  };

  // Check existence
  try {
    var exists = await api.checkPathExists(ws.absolutePath);
    meta.isMissing = !exists;
  } catch (_) {
    meta.isMissing = true;
  }

  if (meta.isMissing) return meta;

  // Load git status + overview + session state in parallel
  try {
    var [statusResult, overviewResult, sessionResult] = await Promise.all([
      api.statusInfo(ws.absolutePath).catch(() => null),
      api.overviewSummary(ws.absolutePath).catch(() => null),
      api.sessionState(ws.absolutePath).catch(() => ({ open: false, harnessPhase: null })),
    ]);

    // Git status
    if (statusResult && !("error" in statusResult)) {
      meta.gitBranch = statusResult.branch;
      meta.gitAhead = statusResult.ahead ?? 0;
      meta.gitBehind = statusResult.behind ?? 0;
      meta.gitChanged = (statusResult.staged ?? 0) + (statusResult.unstaged ?? 0);
      meta.gitUntracked = statusResult.untracked ?? 0;
      meta.gitDirty = statusResult.dirty ?? false;
      meta.gitLastCommit = statusResult.lastCommitRelTime;
    }

    // Overview
    if (overviewResult && !("error" in overviewResult)) {
      meta.goal = overviewResult.goal;
      meta.currentTask = overviewResult.currentTask;
      meta.nextSteps = overviewResult.nextSteps || [];
    }

    // Session state
    if (sessionResult) {
      meta.isOpen = sessionResult.open;
      meta.isRunning = !!sessionResult.harnessPhase;
    }

    // Tags: derive from session state
    var tags: string[] = [];
    if (meta.isOpen) tags.push("open");
    if (meta.isRunning) tags.push("harness");
    // Merge workspace-level tags from workspaces.json
    if (ws.tags && ws.tags.length > 0) {
      for (var wt of ws.tags) {
        if (!tags.includes(wt)) tags.push(wt);
      }
    }
    meta.tags = tags;

    // Group classification (Sprint 2: time-based + archived flag)
    meta.group = classifyGroup(
      ws,
      meta.isOpen,
      meta.isRunning,
      meta.gitDirty,
      meta.gitChanged,
      meta.gitLastCommit
    );

    // updatedLabel: prefer gitLastCommit, fallback to addedAt
    meta.updatedLabel = meta.gitLastCommit || relTime(ws.addedAt);

  } catch (err) {
    console.error(`[dashboard] buildCardMeta error for ${ws.absolutePath}:`, err);
  }

  return meta;
}

// ---------------------------------------------------------------------------
// Init / load workspaces
// ---------------------------------------------------------------------------

async function loadAndRender(): Promise<void> {
  var api = window.dashboardAPI!;
  _workspaces = await api.listWorkspaces();

  console.log(`[dashboard] init: loaded ${_workspaces.length} workspace(s)`);

  if (_workspaces.length === 0) {
    _cardMetas = [];
    render();
    return;
  }

  // Build metas in parallel
  _cardMetas = await Promise.all(_workspaces.map((ws) => buildCardMeta(ws)));

  // render() internally calls populateCardData() for all visible cards
  render();
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleAdd(): Promise<void> {
  var api = window.dashboardAPI!;
  var result = await api.addWorkspace();
  if (result.cancelled) return;
  if (result.duplicate) {
    showDashboardToast("This folder is already in your workspace list.", "warn");
    return;
  }
  _workspaces = result.workspaces;
  await loadAndRender();
  showDashboardToast("Workspace added.", "ok");
}

async function handleRemove(id: string): Promise<void> {
  var ws = _workspaces.find((w) => w.id === id);
  if (!ws) return;
  var confirmed = window.confirm(`Remove "${ws.name}" from workspaces?\n\nThe original folder will not be deleted.`);
  if (!confirmed) return;
  _workspaces = await window.dashboardAPI!.removeWorkspace(id);
  await loadAndRender();
  showDashboardToast("Workspace removed.", "ok");
}

async function handleOpen(workspacePath: string): Promise<void> {
  try {
    var result = await window.dashboardAPI!.openInMain(workspacePath);
    if (result.error) {
      if (result.error === "path_missing") {
        showDashboardToast("Folder not found on disk.", "warn");
      } else {
        showDashboardToast(`Error: ${result.error}`, "err");
      }
    }
  } catch (err) {
    var msg = err instanceof Error ? err.message : String(err);
    showDashboardToast(`Failed to open: ${msg}`, "err");
    console.error("[dashboard] handleOpen error:", err);
  }
}

async function handleArchiveToggle(id: string, archived: boolean): Promise<void> {
  var api = window.dashboardAPI!;
  try {
    var result = await api.archiveToggle(id, archived);
    if (!result.success) {
      showDashboardToast("Archive toggle failed.", "err");
      return;
    }
    _workspaces = result.workspaces;
    console.log(`[dashboard] archive toggle: id=${id} archived=${archived}`);
    // Rebuild metas for affected workspace only then re-render
    await loadAndRender();
    showDashboardToast(archived ? "Moved to Archived." : "Restored from Archived.", "ok");
  } catch (err) {
    console.error("[dashboard] handleArchiveToggle error:", err);
    showDashboardToast("Archive toggle failed.", "err");
  }
}

async function handleRefreshAll(): Promise<void> {
  console.log("[dashboard] refresh all");
  await loadAndRender();
  showDashboardToast("Refreshed.", "ok");
}

// ---------------------------------------------------------------------------
// Sync UI controls to state
// ---------------------------------------------------------------------------

function syncChips(): void {
  document.querySelectorAll("#status-chips .chip").forEach((el) => {
    var c = el as HTMLElement;
    c.classList.toggle("active", c.dataset.filter === _filter);
  });
}

function syncViewToggle(): void {
  document.querySelectorAll("#view-toggle .vt").forEach((el) => {
    var b = el as HTMLElement;
    b.classList.toggle("active", b.dataset.view === _view);
  });
}

// ---------------------------------------------------------------------------
// Keyboard shortcut: Cmd+F to focus search
// ---------------------------------------------------------------------------

function initKeyboardShortcuts(): void {
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "f") {
      e.preventDefault();
      var inp = document.getElementById("search-input") as HTMLInputElement | null;
      if (inp) inp.focus();
    }
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

if (typeof window !== "undefined") {
  loadPrefs();
  initKeyboardShortcuts();

  // Wire toolbar buttons
  var addBtn = document.getElementById("btn-add-workspace") as HTMLButtonElement | null;
  if (addBtn) addBtn.addEventListener("click", () => { void handleAdd(); });

  var refreshBtn = document.getElementById("btn-refresh-all") as HTMLButtonElement | null;
  if (refreshBtn) refreshBtn.addEventListener("click", () => { void handleRefreshAll(); });

  var emptyAddBtn = document.getElementById("btn-empty-add") as HTMLButtonElement | null;
  if (emptyAddBtn) emptyAddBtn.addEventListener("click", () => { void handleAdd(); });

  // Wire filter chips
  document.querySelectorAll("#status-chips .chip").forEach((el) => {
    el.addEventListener("click", () => {
      var f = (el as HTMLElement).dataset.filter || "all";
      _filter = f;
      savePrefs();
      syncChips();
      console.log(`[dashboard] view=${_view} filter=${_filter} count=${filterMetas(_cardMetas).length}`);
      render();
    });
  });

  // Wire view toggle
  document.querySelectorAll("#view-toggle .vt").forEach((el) => {
    el.addEventListener("click", () => {
      var v = (el as HTMLElement).dataset.view as "grid" | "list";
      if (!v) return;
      _view = v;
      savePrefs();
      syncViewToggle();
      console.log(`[dashboard] view=${_view} filter=${_filter} count=${filterMetas(_cardMetas).length}`);
      render();
    });
  });

  // Wire search
  var searchInput = document.getElementById("search-input") as HTMLInputElement | null;
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      _search = searchInput!.value;
      render();
    });
  }

  // Sync initial visual states
  syncChips();
  syncViewToggle();

  // Load workspaces
  (async () => {
    try {
      if (!window.dashboardAPI) {
        throw new Error("window.dashboardAPI is undefined — preload script failed to load");
      }
      await loadAndRender();
    } catch (err) {
      console.error("[dashboard] boot failed:", err);
      var grid = document.getElementById("content") as HTMLDivElement | null;
      if (grid) {
        grid.innerHTML = `<div style="padding:24px;color:var(--err)">Failed to load dashboard: ${dashEsc(err instanceof Error ? err.message : String(err))}</div>`;
      }
    }
  })();
}
