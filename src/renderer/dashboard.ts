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

type SortKey = "recent" | "name" | "lastCommit";

var _workspaces: WorkspaceEntry[] = [];
var _cardMetas: CardMeta[] = [];
var _view: "grid" | "list" = "grid";
var _filter: string = "all";
var _sort: SortKey = "recent";
var _search: string = "";
var _toastTimer: ReturnType<typeof setTimeout> | null = null;
var _homeDir: string = "";
var _expandedIds: Set<string> = new Set();

// Sprint 2: gitflow data cache, keyed by workspace id.
// undefined  = not yet fetched (fetch on next expand)
// null       = fetched but unavailable (non-git / failed) — do not retry until refresh
// otherwise  = ready data, render immediately on expand
var _gitFlowCache: Map<string, DashboardGitFlowData | null> = new Map();
// Track in-flight fetches so we don't double-fire when a card gets expanded
// repeatedly while a request is pending.
var _gitFlowInflight: Set<string> = new Set();

// Sprint 3: discovery banner state.
// _discoveryDismissed is renderer-only (cleared on window close).
var _discoveryCandidates: DashboardDiscoveryCandidate[] = [];
var _discoveryDismissed: boolean = false;

// ---------------------------------------------------------------------------
// Persist view/filter/sort/expand to localStorage
// ---------------------------------------------------------------------------

var PREF_VIEW = "dashboard.v2.view";
var PREF_FILTER = "dashboard.v2.filter";
var PREF_SORT = "dashboard.v2.sort";
var PREF_EXPANDED = "dashboard.v2.expandedIds";

var SORT_LABELS: Record<SortKey, string> = {
  recent: "Recently active",
  name: "Name (A→Z)",
  lastCommit: "Last commit",
};

function loadPrefs(): void {
  try {
    var v = localStorage.getItem(PREF_VIEW);
    if (v === "list" || v === "grid") _view = v;
    var f = localStorage.getItem(PREF_FILTER);
    if (f) _filter = f;
    var s = localStorage.getItem(PREF_SORT);
    if (s === "recent" || s === "name" || s === "lastCommit") _sort = s;
    var ex = localStorage.getItem(PREF_EXPANDED);
    if (ex) {
      try {
        var arr = JSON.parse(ex);
        if (Array.isArray(arr)) _expandedIds = new Set(arr.filter((x) => typeof x === "string"));
      } catch (_) { /* ignore */ }
    }
  } catch (_) { /* ignore */ }
}

function savePrefs(): void {
  try {
    localStorage.setItem(PREF_VIEW, _view);
    localStorage.setItem(PREF_FILTER, _filter);
    localStorage.setItem(PREF_SORT, _sort);
  } catch (_) { /* ignore */ }
}

function saveExpandedState(): void {
  try {
    localStorage.setItem(PREF_EXPANDED, JSON.stringify(Array.from(_expandedIds)));
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
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Abbreviate a path under the user's home directory to `~/...` form.
 * Returns the original absolute path if it does not live under home.
 *
 * Examples (homeDir = "/Users/alice"):
 *   /Users/alice/code/app  -> ~/code/app
 *   /Users/alice           -> ~
 *   /tmp/foo               -> /tmp/foo
 *   /Volumes/X             -> /Volumes/X
 */
function abbreviateHomePath(absPath: string, homeDir: string): string {
  if (!homeDir) return absPath;
  if (absPath === homeDir) return "~";
  // Ensure we only match a true subdirectory, not e.g. /Users/aliceN/...
  var prefix = homeDir.endsWith("/") ? homeDir : homeDir + "/";
  if (absPath.indexOf(prefix) === 0) {
    return "~/" + absPath.slice(prefix.length);
  }
  return absPath;
}

// ---------------------------------------------------------------------------
// Sort
// ---------------------------------------------------------------------------

function sortMetas(metas: CardMeta[]): CardMeta[] {
  var copy = metas.slice();
  if (_sort === "name") {
    copy.sort((a, b) => a.ws.name.localeCompare(b.ws.name, undefined, { sensitivity: "base" }));
  } else if (_sort === "lastCommit") {
    // Smaller age (more recent) first; null/unparseable → last.
    copy.sort((a, b) => {
      var ageA = a.gitLastCommit ? parseGitRelTimeMs(a.gitLastCommit) : null;
      var ageB = b.gitLastCommit ? parseGitRelTimeMs(b.gitLastCommit) : null;
      if (ageA === null && ageB === null) return 0;
      if (ageA === null) return 1;
      if (ageB === null) return -1;
      return ageA - ageB;
    });
  } else {
    // recent: open/running first, then by lastCommit age, then by addedAt age
    copy.sort((a, b) => {
      var ra = (a.isOpen ? 0 : 1) + (a.isRunning ? 0 : 1);
      var rb = (b.isOpen ? 0 : 1) + (b.isRunning ? 0 : 1);
      if (ra !== rb) return ra - rb;
      var ageA = a.gitLastCommit ? parseGitRelTimeMs(a.gitLastCommit) : null;
      var ageB = b.gitLastCommit ? parseGitRelTimeMs(b.gitLastCommit) : null;
      var ax = ageA !== null ? ageA : ageMs(a.ws.addedAt);
      var bx = ageB !== null ? ageB : ageMs(b.ws.addedAt);
      return ax - bx;
    });
  }
  return copy;
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

  var isExpanded = _expandedIds.has(m.ws.id);
  card.className = "ws-card"
    + (stripClass ? " " + stripClass : "")
    + (m.isMissing ? " missing" : "")
    + (isExpanded ? "" : " collapsed");
  card.dataset.id = m.ws.id;

  var iconInfo = wsIconInfo(m.ws.name);
  var displayPath = abbreviateHomePath(m.ws.absolutePath, _homeDir);

  // === Card head: quick actions + more menu ===
  var archiveLabel = m.ws.archived ? "Unarchive" : "Archive";
  var quickActionsHTML = `
    <div class="card-quick">
      <button class="qbtn" title="Open in terminal" data-action="open-terminal" data-path="${dashEsc(m.ws.absolutePath)}">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 5l3 3-3 3M8 11h5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <button class="qbtn" title="Open in IDE (Cursor)" data-action="open-ide" data-path="${dashEsc(m.ws.absolutePath)}">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 3h12v10H2zM2 6h12" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="4" cy="4.5" r="0.6" fill="currentColor"/></svg>
      </button>
      <button class="qbtn" title="Reveal in Finder" data-action="reveal-finder" data-path="${dashEsc(m.ws.absolutePath)}">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 5l1.5-2h3l1 1.5h6.5V13H2z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
      </button>
      <div class="card-more-wrap">
        <button class="qbtn more-btn" title="More" data-action="open-more" data-id="${dashEsc(m.ws.id)}">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><circle cx="3.5" cy="8" r="1.2"/><circle cx="8" cy="8" r="1.2"/><circle cx="12.5" cy="8" r="1.2"/></svg>
        </button>
        <div class="card-menu" id="cm-${dashEsc(m.ws.id)}" role="menu">
          <button class="card-menu-item" role="menuitem" data-action="archive-toggle" data-id="${dashEsc(m.ws.id)}" data-archived="${m.ws.archived ? "true" : "false"}">${dashEsc(archiveLabel)}</button>
          <button class="card-menu-item danger" role="menuitem" data-action="remove" data-id="${dashEsc(m.ws.id)}">Remove workspace</button>
        </div>
      </div>
    </div>
  `;

  card.innerHTML = `
    <div class="card-head">
      <div class="ws-icon ${dashEsc(iconInfo.color)}">${dashEsc(iconInfo.letter)}</div>
      <div class="card-titlewrap">
        <div class="card-title">${dashEsc(m.ws.name)}</div>
        <div class="card-path" title="${dashEsc(m.ws.absolutePath)}">${dashEsc(displayPath)}</div>
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
    <div class="card-expand" id="ce-${dashEsc(m.ws.id)}"></div>
    <div class="card-foot">
      <span class="updated" id="upd-${dashEsc(m.ws.id)}">${dashEsc(m.updatedLabel)}</span>
      <button class="open-btn" data-action="open-claude" data-path="${dashEsc(m.ws.absolutePath)}" ${m.isMissing ? "disabled" : ""} title="Open in HyperTerm and start Claude Code">
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M8 2L3 5v6l5 3 5-3V5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
        Claude
      </button>
      <button class="open-btn" data-action="open-codex" data-path="${dashEsc(m.ws.absolutePath)}" ${m.isMissing ? "disabled" : ""} title="Open in HyperTerm and start Codex">
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Codex
      </button>
      <button class="open-btn primary" data-action="open-main" data-path="${dashEsc(m.ws.absolutePath)}" ${m.isMissing ? "disabled" : ""}>
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M6 3H3v10h10V10M9 3h4v4M13 3L7 9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Open
      </button>
    </div>
  `;

  // Wire action buttons. All [data-action] clicks stop propagation so they
  // never trigger the card-level expand toggle.
  card.querySelectorAll("[data-action]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      var btn = e.currentTarget as HTMLElement;
      var action = btn.getAttribute("data-action");
      var p = btn.getAttribute("data-path");
      if (action === "open-terminal") {
        if (p) void handleOpenInTerminal(p);
      } else if (action === "open-main") {
        if (p) void handleOpen(p);
      } else if (action === "open-claude") {
        if (p) void handleOpenWithClaude(p);
      } else if (action === "open-codex") {
        if (p) void handleOpenWithCodex(p);
      } else if (action === "open-ide") {
        if (p) void handleOpenInIDE(p);
      } else if (action === "reveal-finder") {
        if (p) void handleRevealInFinder(p);
      } else if (action === "open-more") {
        var moreId = btn.getAttribute("data-id");
        if (moreId) toggleCardMenu(moreId);
      } else if (action === "remove") {
        var id = btn.getAttribute("data-id");
        closeAllCardMenus();
        if (id) void handleRemove(id);
      } else if (action === "archive-toggle") {
        var toggleId = btn.getAttribute("data-id");
        var currentArchived = btn.getAttribute("data-archived") === "true";
        closeAllCardMenus();
        if (toggleId) void handleArchiveToggle(toggleId, !currentArchived);
      }
    });
  });

  // Card-level click = expand/collapse toggle.
  // Footer Open and quick-actions stop propagation above, so they won't trigger this.
  card.addEventListener("click", () => {
    toggleCardExpand(m.ws.id);
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
    // Sprint 2 (Ask Claude per nextStep): each <li> gets an inline "Ask Claude"
    // button on the right. The raw nextStep string is NOT embedded in the
    // markup; we store only its index in `data-todo-idx` and look up
    // `m.nextSteps[idx]` at click time so metacharacters/newlines/emoji never
    // pass through HTML serialization.
    var renderTodoLi = function (step: string, idx: number, extra: boolean): string {
      var cls = extra ? "todo-item todo-extra" : "todo-item";
      var styleAttr = extra ? ' style="display:none"' : "";
      return (
        '<li class="' + cls + '"' + styleAttr + '>' +
          '<span class="todo-text">' + mdInline(step) + '</span>' +
          '<button type="button" class="todo-ask-btn" ' +
            'data-action="ask-claude-todo" ' +
            'data-path="' + dashEsc(m.ws.absolutePath) + '" ' +
            'data-todo-idx="' + idx + '" ' +
            'title="Ask Claude about this step">Ask Claude</button>' +
        '</li>'
      );
    };
    var firstHTML = renderTodoLi(m.nextSteps[0], 0, false);
    var moreTodos = m.nextSteps.slice(1);
    var moreCount = moreTodos.length;
    var moreItemsHTML = moreCount > 0
      ? moreTodos.map((step, i) => renderTodoLi(step, i + 1, true)).join("")
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

  // Sprint 2: Wire inline "Ask Claude" buttons per nextStep. Each click
  //   - stops propagation so the card-level expand toggle does NOT fire
  //   - looks up the raw nextStep text via index from m.nextSteps (raw text
  //     never travels through HTML — protects against quote breakage)
  //   - calls handleOpenWithClaude(path, taskText), same code path as the
  //     footer "Claude" button but with prompt forwarded as positional argv.
  var listEl = document.getElementById("todo-list-" + m.ws.id);
  if (listEl) {
    var capturedNextSteps = m.nextSteps.slice(); // freeze ref for closure
    var capturedPath = m.ws.absolutePath;
    listEl.querySelectorAll(".todo-ask-btn").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        var btn = e.currentTarget as HTMLElement;
        var idxStr = btn.getAttribute("data-todo-idx") || "";
        var idx = parseInt(idxStr, 10);
        if (!Number.isFinite(idx) || idx < 0 || idx >= capturedNextSteps.length) {
          console.warn("[dashboard] todo-ask-btn: invalid idx", idxStr);
          return;
        }
        var taskText = capturedNextSteps[idx];
        if (typeof taskText !== "string" || taskText.length === 0) return;
        void handleOpenWithClaude(capturedPath, taskText);
      });
    });
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

  var listDisplayPath = abbreviateHomePath(m.ws.absolutePath, _homeDir);
  row.innerHTML = `
    <div class="ws-icon ${dashEsc(iconInfo.color)}" style="width:24px;height:24px;font-size:11px;border-radius:5px">${dashEsc(iconInfo.letter)}</div>
    <div class="lr-name">${dashEsc(m.ws.name)}<span class="lr-path" title="${dashEsc(m.ws.absolutePath)}">${dashEsc(listDisplayPath)}</span></div>
    <div class="lr-summary">${dashEsc(m.currentTask || m.goal || "—")}</div>
    <div class="lr-git">${gitCells.join(" ")}</div>
    <div class="lr-updated">${dashEsc(m.updatedLabel)}</div>
    <div class="lr-actions">
      <button class="qbtn" title="Open" data-action="open" data-path="${dashEsc(m.ws.absolutePath)}">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 5l3 3-3 3M8 11h5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <button class="open-btn" data-action="open-claude" data-path="${dashEsc(m.ws.absolutePath)}" ${m.isMissing ? "disabled" : ""} title="Open in HyperTerm and start Claude Code">Claude</button>
      <button class="open-btn" data-action="open-codex" data-path="${dashEsc(m.ws.absolutePath)}" ${m.isMissing ? "disabled" : ""} title="Open in HyperTerm and start Codex">Codex</button>
      <button class="open-btn primary" data-action="open" data-path="${dashEsc(m.ws.absolutePath)}">Open</button>
    </div>
  `;

  row.querySelectorAll("[data-action]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      var btn = e.currentTarget as HTMLElement;
      var action = btn.getAttribute("data-action");
      var p = btn.getAttribute("data-path");
      if (action === "open-claude") {
        if (p) void handleOpenWithClaude(p);
      } else if (action === "open-codex") {
        if (p) void handleOpenWithCodex(p);
      } else {
        if (p) void handleOpen(p);
      }
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

  // Always remove a previous discovery banner; it gets re-added below if
  // conditions still match. Done before any early returns so the banner
  // also disappears when filter/search changes.
  content.querySelectorAll(".discover").forEach((el) => el.remove());

  if (_cardMetas.length === 0) {
    emptyState.style.display = "";
    // Clear previous content except empty-state
    content.querySelectorAll(":not(#empty-state)").forEach((el) => el.remove());
    // Sprint 3: still render banner above empty-state if conditions match
    renderDiscoveryBanner(content);
    return;
  }

  emptyState.style.display = "none";
  // Remove all previous rendered nodes
  content.querySelectorAll(".ws-grid,.ws-list,.group-header,#no-match").forEach((el) => el.remove());

  // Sprint 3: render discovery banner at top of content (before card groups)
  renderDiscoveryBanner(content);

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

  var visible = sortMetas(filterMetas(_cardMetas));
  var filterName = _filter;
  console.log(`[dashboard] view=${_view} filter=${filterName} sort=${_sort} count=${visible.length}`);

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
    // G1: cards restored as expanded from localStorage need gitflow data too,
    // not only fresh user-clicks. Trigger fetch (or paint from cache) for any
    // currently-expanded card. ensureGitflowForWorkspace is idempotent +
    // paints synchronously on cache hit.
    for (var j = 0; j < visible.length; j++) {
      if (_expandedIds.has(visible[j].ws.id)) {
        ensureGitflowForWorkspace(visible[j].ws);
      }
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

  // Expose count for dashboard-autorefresh.ts cycle log (AC #7)
  (window as any).__dashboardWorkspaceCount = _workspaces.length;

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
  // Sprint 3: re-fetch candidates — the just-added workspace might have been
  // a discovery candidate, in which case it must drop out of the banner.
  await fetchDiscoveryCandidates();
  await loadAndRender();
  if (typeof (window as any).resetAutoRefresh === "function") (window as any).resetAutoRefresh();
  showDashboardToast("Workspace added.", "ok");
}

async function handleRemove(id: string): Promise<void> {
  var ws = _workspaces.find((w) => w.id === id);
  if (!ws) return;
  var confirmed = window.confirm(`Remove "${ws.name}" from workspaces?\n\nThe original folder will not be deleted.`);
  if (!confirmed) return;
  _workspaces = await window.dashboardAPI!.removeWorkspace(id);
  await loadAndRender();
  if (typeof (window as any).resetAutoRefresh === "function") (window as any).resetAutoRefresh();
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

// Sprint: Run with Claude — footer "Claude" button. Opens workspace as a new
// group inside the HyperTerm main window with `claude` running as the initial
// PTY's foreground command. If the CLI is missing the main IPC returns
// { error: "claude_missing" } and we toast without focusing the main window.
//
// Sprint 2: optional `taskText` is forwarded through IPC. Eventually it lands
// in pty-manager as a positional argv to zsh, then becomes claude's first CLI
// arg. There is NO shell interpolation anywhere along the path, so any
// metacharacters (`;`, `$()`, backticks, `&&`, ...) inside taskText are
// preserved as a literal string and never executed.
async function handleOpenWithClaude(
  workspacePath: string,
  taskText?: string,
): Promise<void> {
  try {
    var result = await window.dashboardAPI!.openInMainWithClaude(
      workspacePath,
      taskText,
    );
    if (result.error) {
      if (result.error === "path_missing") {
        showDashboardToast("Folder not found on disk.", "warn");
      } else if (result.error === "claude_missing") {
        showDashboardToast("Claude Code CLI not found in PATH", "err");
      } else {
        showDashboardToast(`Error: ${result.error}`, "err");
      }
    }
  } catch (err) {
    var msg = err instanceof Error ? err.message : String(err);
    showDashboardToast(`Failed to open Claude session: ${msg}`, "err");
    console.error("[dashboard] handleOpenWithClaude error:", err);
  }
}

// Sprint 1 (Codex 진입점) — footer "Codex" button. Opens workspace as a new
// group inside the HyperTerm main window with `codex` running as the initial
// PTY's foreground command. If the CLI is missing the main IPC returns
// { error: "codex_missing" } and we toast without focusing the main window.
async function handleOpenWithCodex(workspacePath: string): Promise<void> {
  try {
    var result = await window.dashboardAPI!.openInMainWithCodex(workspacePath);
    if (result.error) {
      if (result.error === "path_missing") {
        showDashboardToast("Folder not found on disk.", "warn");
      } else if (result.error === "codex_missing") {
        showDashboardToast("Codex CLI not installed", "err");
      } else {
        showDashboardToast(`Error: ${result.error}`, "err");
      }
    }
  } catch (err) {
    var msg = err instanceof Error ? err.message : String(err);
    showDashboardToast(`Failed to open Codex session: ${msg}`, "err");
    console.error("[dashboard] handleOpenWithCodex error:", err);
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
    if (typeof (window as any).resetAutoRefresh === "function") (window as any).resetAutoRefresh();
    showDashboardToast(archived ? "Moved to Archived." : "Restored from Archived.", "ok");
  } catch (err) {
    console.error("[dashboard] handleArchiveToggle error:", err);
    showDashboardToast("Archive toggle failed.", "err");
  }
}

async function handleRefreshAll(): Promise<void> {
  console.log("[dashboard] refresh all");
  // Drop cached gitflow data so re-expand re-fetches fresh git state.
  _gitFlowCache.clear();
  _gitFlowInflight.clear();
  // Sprint 3: re-scan discovery candidates so banner reflects newly-cloned repos.
  await fetchDiscoveryCandidates();
  await loadAndRender();
  if (typeof (window as any).resetAutoRefresh === "function") (window as any).resetAutoRefresh();
  showDashboardToast("Refreshed.", "ok");
}

// Sprint 1 UX Polish — Open in terminal / IDE / Finder split apart.
// `handleOpen` (above) opens the workspace as a group inside the HyperTerm
// main window. It is invoked only by the footer "Open" button so that a
// stray card click never opens the main window (A8/A9).
async function handleOpenInTerminal(workspacePath: string): Promise<void> {
  try {
    var result = await window.dashboardAPI!.openInTerminal(workspacePath);
    if (result.error) {
      if (result.error === "path_missing") {
        showDashboardToast("Folder not found on disk.", "warn");
      } else {
        showDashboardToast(`Terminal open failed: ${result.error}`, "err");
      }
    }
  } catch (err) {
    var msg = err instanceof Error ? err.message : String(err);
    showDashboardToast(`Terminal open failed: ${msg}`, "err");
    console.error("[dashboard] handleOpenInTerminal error:", err);
  }
}

async function handleOpenInIDE(workspacePath: string): Promise<void> {
  try {
    var result = await window.dashboardAPI!.openInIDE(workspacePath);
    if (result.error) {
      if (result.error === "path_missing") {
        showDashboardToast("Folder not found on disk.", "warn");
      } else if (result.error === "cursor_unavailable") {
        showDashboardToast("Cursor not installed or failed to open.", "warn");
      } else {
        showDashboardToast(`IDE open failed: ${result.error}`, "err");
      }
    }
  } catch (err) {
    var msg = err instanceof Error ? err.message : String(err);
    showDashboardToast(`IDE open failed: ${msg}`, "err");
    console.error("[dashboard] handleOpenInIDE error:", err);
  }
}

async function handleRevealInFinder(workspacePath: string): Promise<void> {
  try {
    var result = await window.dashboardAPI!.revealInFinder(workspacePath);
    if (result.error) {
      if (result.error === "path_missing") {
        showDashboardToast("Folder not found on disk.", "warn");
      } else {
        showDashboardToast(`Reveal failed: ${result.error}`, "err");
      }
    }
  } catch (err) {
    var msg = err instanceof Error ? err.message : String(err);
    showDashboardToast(`Reveal failed: ${msg}`, "err");
    console.error("[dashboard] handleRevealInFinder error:", err);
  }
}

// ---------------------------------------------------------------------------
// Git Flow SVG (Sprint 2 — Dashboard design v2)
// ---------------------------------------------------------------------------

// Lane color tokens lifted verbatim from the design source so visual parity
// with the static mock is grep-checkable.
// Reference: /tmp/design_dashboard/terminal/project/Workspace Dashboard.html lines 977-992
var GITFLOW_LANE_COLORS: Record<string, string> = {
  main:    "#4a78c0",
  hotfix:  "#a78bfa",
  release: "#7fc3f5",
  develop: "#ff7a6b",
  feature: "#9ad641",
  feature2:"#9ad641",
};
var GITFLOW_LANE_BG: Record<string, string> = {
  main:    "rgba(74,120,192,0.18)",
  hotfix:  "rgba(167,139,250,0.18)",
  release: "rgba(127,195,245,0.2)",
  develop: "rgba(255,122,107,0.18)",
  feature: "rgba(154,214,65,0.2)",
  feature2:"rgba(154,214,65,0.2)",
};

// Map a branch name to a lane color key.
function gitflowLaneKey(branchName: string): string {
  var n = branchName.toLowerCase();
  if (n === "main" || n === "master") return "main";
  if (n === "develop" || n === "dev") return "develop";
  if (n.startsWith("release/") || n === "release") return "release";
  if (n.startsWith("hotfix/") || n === "hotfix") return "hotfix";
  return "feature";
}

interface GitflowLaneRow {
  key: string;     // branch name (unique per row)
  label: string;   // display label
  colorKey: string; // lookup into LANE_COLORS / LANE_BG
}

interface GitflowLayoutCommit {
  id: string;
  shortHash: string;
  parents: string[];
  msg: string;
  author: string;
  relTime: string;
  tag: string | null;
  isHead: boolean;
  lane: string; // lane.key
  x: number;    // column index (0..N-1)
}

// Pure helper: assign each commit to a lane (branch name) given the gitflow
// data + current branch fallback. Exposed as a separate function so it stays
// testable in isolation if/when we introduce unit tests.
function gitflowAssignLanes(
  data: DashboardGitFlowData,
): { lanes: GitflowLaneRow[]; commits: GitflowLayoutCommit[] } {
  var commits = data.commits;
  if (commits.length === 0) {
    return { lanes: [], commits: [] };
  }

  // Step 1: seed lane assignments from explicit branch decorations.
  var laneOf: Record<string, string> = {};
  for (var c of commits) {
    if (c.branch) laneOf[c.id] = c.branch;
  }

  // Step 2: propagate lane to parents via first-parent walk.
  // commits[] is in `--date-order` newest-first. We iterate top-down so when
  // we visit a commit with a known lane, we push that lane onto its first
  // parent (if not already assigned). This keeps a contiguous color along
  // each branch's history while still respecting branch tips that already
  // claimed an ancestor.
  var byHash: Record<string, DashboardGitFlowCommit> = {};
  for (var c2 of commits) byHash[c2.id] = c2;
  for (var c3 of commits) {
    var lane = laneOf[c3.id];
    if (!lane) continue;
    var firstParent = c3.parents[0];
    if (firstParent && byHash[firstParent] && !laneOf[firstParent]) {
      laneOf[firstParent] = lane;
    }
  }

  // Step 3: any still-unassigned commit falls back to current branch (or 'main').
  var fallbackLane = data.branch || "main";
  for (var c4 of commits) {
    if (!laneOf[c4.id]) laneOf[c4.id] = fallbackLane;
  }

  // Step 4: build ordered lane list. Stable order = first appearance among
  // commits (newest-first). 'main'/'master' floats to the top so the canonical
  // line is the first lane.
  var seen: Record<string, boolean> = {};
  var laneOrder: string[] = [];
  for (var c5 of commits) {
    var l = laneOf[c5.id];
    if (!seen[l]) { seen[l] = true; laneOrder.push(l); }
  }
  laneOrder.sort(function (a, b) {
    var aMain = (a === "main" || a === "master") ? 0 : 1;
    var bMain = (b === "main" || b === "master") ? 0 : 1;
    if (aMain !== bMain) return aMain - bMain;
    return 0; // preserve insertion order for ties
  });

  var lanes: GitflowLaneRow[] = laneOrder.map(function (name) {
    return { key: name, label: name, colorKey: gitflowLaneKey(name) };
  });

  // Step 5: assign x columns. commits are newest-first; oldest commit should
  // sit on the left so the diagram reads left-to-right. Column = (N-1) - i.
  var N = commits.length;
  var layoutCommits: GitflowLayoutCommit[] = commits.map(function (c, i) {
    return {
      id: c.id,
      shortHash: c.shortHash,
      parents: c.parents,
      msg: c.msg,
      author: c.author,
      relTime: c.relTime,
      tag: c.tag,
      isHead: c.isHead,
      lane: laneOf[c.id],
      x: (N - 1) - i,
    };
  });

  return { lanes, commits: layoutCommits };
}

// Build the gitflow SVG markup. Coordinate constants mirror the design source
// (padL=70, padR=14, padT=22, padB=14, laneH=30, colW=28).
function renderGitflowSVG(workspaceId: string, data: DashboardGitFlowData): string {
  var laid = gitflowAssignLanes(data);
  var lanes = laid.lanes;
  var commits = laid.commits;
  if (lanes.length === 0 || commits.length === 0) return "";

  var padR = 16, padT = 30, padB = 18;
  var laneH = 44;
  var colW = 44;
  // padL must accommodate the longest lane label pill so it doesn't clip out
  // of the SVG on the left edge. label width formula: chars * 7.2 + 22 (rect)
  // + 8 (gap from padL).
  var maxLabelChars = lanes.reduce(function (m, l) { return Math.max(m, l.label.length); }, 0);
  var padL = Math.max(96, Math.ceil(maxLabelChars * 7.2 + 22 + 14));

  var maxX = commits.reduce(function (m, c) { return Math.max(m, c.x); }, 0);
  var innerW = maxX * colW + colW + 40;
  var W = padL + innerW + padR;
  var H = padT + lanes.length * laneH + padB;

  var laneY: Record<string, number> = {};
  lanes.forEach(function (l, i) { laneY[l.key] = padT + i * laneH + laneH / 2; });

  var posByHash: Record<string, { x: number; y: number }> = {};
  commits.forEach(function (c) {
    posByHash[c.id] = { x: padL + c.x * colW + 16, y: laneY[c.lane] };
  });

  // Lane label pills + dashed lane lines
  var laneSVG = lanes.map(function (l) {
    var y = laneY[l.key];
    var color = GITFLOW_LANE_COLORS[l.colorKey] || "#888";
    var bg = GITFLOW_LANE_BG[l.colorKey] || "rgba(255,255,255,0.05)";
    var labelW = (l.label.length * 7.2) + 22;
    return ""
      + `<line class="lane-line" x1="${padL - 6}" y1="${y}" x2="${W - padR}" y2="${y}"/>`
      + `<rect x="${padL - labelW - 8}" y="${y - 12}" width="${labelW}" height="24" rx="12" fill="${bg}" stroke="${color}" stroke-opacity="0.4"/>`
      + `<text x="${padL - labelW - 8 + labelW / 2}" y="${y + 4}" text-anchor="middle" class="lane-label" fill="${color}">${dashEsc(l.label)}</text>`;
  }).join("");

  // Edges: parent → child, S-curve when crossing lanes, straight otherwise.
  // Keep design class names ("commit-edge", "commit-edge merge") verbatim.
  var arrowId = `gf-arrow-${workspaceId}`;
  var safeArrowId = arrowId.replace(/[^a-zA-Z0-9_-]/g, "_");
  var edgeSVG = commits.map(function (c) {
    var b = posByHash[c.id];
    if (!b) return "";
    var isMerge = c.parents.length > 1;
    return c.parents.map(function (parentHash) {
      var a = posByHash[parentHash];
      if (!a) return "";
      var sameLane = a.y === b.y;
      var d;
      if (sameLane) {
        d = `M${a.x + 5},${a.y} L${b.x - 5},${b.y}`;
      } else {
        var mx = (a.x + b.x) / 2;
        d = `M${a.x},${a.y} C${mx},${a.y} ${mx},${b.y} ${b.x},${b.y}`;
      }
      var cls = isMerge ? "commit-edge merge" : "commit-edge";
      return `<path class="${cls}" d="${d}" marker-end="url(#${safeArrowId})"/>`;
    }).join("");
  }).join("");

  // Commits, tags, HEAD
  var commitSVG = commits.map(function (c) {
    var p = posByHash[c.id];
    var color = GITFLOW_LANE_COLORS[gitflowLaneKey(c.lane)] || "#888";
    var r = c.isHead ? 9 : 7;
    var tagSVG = "";
    if (c.tag) {
      var tw = c.tag.length * 7.2 + 16;
      var tagX = p.x - tw / 2;
      var tagY = padT - 24;
      tagSVG = ""
        + `<g transform="translate(${tagX}, ${tagY})">`
        + `<path d="M0,0 H${tw} V14 L${tw / 2 + 4},18 L${tw / 2 - 4},18 L${tw / 2},22 L${tw / 2 - 4},18 L${tw / 2 - 4},18 H0 Z" class="tag-bg"/>`
        + `<text x="${tw / 2}" y="10" text-anchor="middle" class="tag">${dashEsc(c.tag)}</text>`
        + `<line x1="${tw / 2}" y1="22" x2="${tw / 2}" y2="${p.y - padT + 24 - 6}" stroke="${color}" stroke-opacity="0.4" stroke-dasharray="2 2"/>`
        + `</g>`;
    }
    var headSVG = "";
    if (c.isHead) {
      headSVG = ""
        + `<g transform="translate(${p.x + 13}, ${p.y - 11})">`
        + `<rect x="0" y="0" width="42" height="18" rx="4" fill="${color}" fill-opacity="0.15" stroke="${color}" stroke-opacity="0.5"/>`
        + `<text x="21" y="13" text-anchor="middle" class="head-label" fill="${color}">HEAD</text>`
        + `</g>`;
    }
    var titleText = c.msg ? `${c.shortHash} — ${c.msg}` : c.shortHash;
    return ""
      + tagSVG
      + `<g class="commit ${c.isHead ? "head" : ""}">`
      + `<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="${color}"/>`
      + headSVG
      + `<title>${dashEsc(titleText)}</title>`
      + `</g>`;
  }).join("");

  // Header summary + lane legend
  var legendItems = lanes.map(function (l) {
    var color = GITFLOW_LANE_COLORS[l.colorKey] || "#888";
    return `<span class="lg-item"><span class="lg-dot" style="background:${color}"></span>${dashEsc(l.label)}</span>`;
  }).join("");

  return ""
    + `<div class="gitflow-wrap">`
    + `<div class="gitflow-head">`
    + `<span>Git Flow · ${dashEsc(data.summary || "")}</span>`
    + `<span class="legend">${legendItems}</span>`
    + `</div>`
    + `<div class="gitflow-scroll">`
    + `<svg class="gitflow-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
    + `<defs>`
    + `<marker id="${safeArrowId}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">`
    + `<path d="M0,0 L8,4 L0,8 Z" fill="rgba(255,255,255,0.35)"/>`
    + `</marker>`
    + `</defs>`
    + laneSVG
    + edgeSVG
    + commitSVG
    + `</svg>`
    + `</div>`
    + `</div>`;
}

// Inject (or clear) gitflow trigger button into the card's `.card-expand` host.
// The full SVG diagram is rendered only inside the zoom modal. The card shows
// a compact "View Git Flow →" trigger to keep the card density low.
// `data === null` → leave the host empty (graceful degrade for non-git / failure).
function paintGitflowInto(workspaceId: string, data: DashboardGitFlowData | null): void {
  var host = document.getElementById("ce-" + workspaceId);
  if (!host) return;
  if (!data || !data.commits || data.commits.length === 0) {
    host.innerHTML = "";
    return;
  }
  var summary = data.summary || (data.commits.length + " commits");
  host.innerHTML = ""
    + `<button class="gitflow-trigger" type="button" data-action="open-gitflow" data-id="${dashEsc(workspaceId)}">`
    +   `<span class="gf-trig-icon">`
    +     `<svg width="14" height="14" viewBox="0 0 16 16" fill="none">`
    +       `<circle cx="4" cy="4" r="1.6" fill="currentColor"/>`
    +       `<circle cx="4" cy="12" r="1.6" fill="currentColor"/>`
    +       `<circle cx="12" cy="8" r="1.6" fill="currentColor"/>`
    +       `<path d="M4 5.5v5M5.5 12h3a2.5 2.5 0 002.5-2.5v0" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" fill="none"/>`
    +     `</svg>`
    +   `</span>`
    +   `<span class="gf-trig-label">Git Flow</span>`
    +   `<span class="gf-trig-summary">${dashEsc(summary)}</span>`
    +   `<span class="gf-trig-arrow">&rarr;</span>`
    + `</button>`;
  var btn = host.querySelector(".gitflow-trigger") as HTMLElement | null;
  if (btn) {
    btn.addEventListener("click", function (e) {
      e.stopPropagation(); // don't toggle card collapse
      openGitflowModal(workspaceId);
    });
  }
}

// ---------------------------------------------------------------------------
// Git Flow zoom modal
// ---------------------------------------------------------------------------

var _gitflowModalScale: number = 1;
var _gitflowModalWorkspaceId: string | null = null;
var GITFLOW_ZOOM_MIN = 0.4;
var GITFLOW_ZOOM_MAX = 4;
var GITFLOW_ZOOM_STEP = 0.2;

function openGitflowModal(workspaceId: string): void {
  var data = _gitFlowCache.get(workspaceId);
  if (!data) return;
  var modal = document.getElementById("gitflow-modal");
  var canvas = document.getElementById("gf-canvas");
  var titleEl = document.getElementById("gf-modal-title");
  if (!modal || !canvas) return;
  _gitflowModalWorkspaceId = workspaceId;
  // Find ws name for title
  var ws = _workspaces.find(function (w) { return w.id === workspaceId; });
  if (titleEl) {
    titleEl.textContent = "Git Flow — " + (ws ? ws.name : workspaceId) + " · " + (data.summary || "");
  }
  canvas.innerHTML = renderGitflowSVG("modal-" + workspaceId, data);
  // Default to fit-to-screen on open so 큰 다이어그램도 한눈에 들어옴.
  modal.classList.add("open");
  // Defer to next frame so the dialog has measured.
  requestAnimationFrame(function () {
    setGitflowZoomFit();
  });
}

function closeGitflowModal(): void {
  var modal = document.getElementById("gitflow-modal");
  if (!modal) return;
  modal.classList.remove("open");
  _gitflowModalWorkspaceId = null;
  _gitflowModalScale = 1;
  var canvas = document.getElementById("gf-canvas");
  if (canvas) canvas.innerHTML = "";
}

function setGitflowZoom(scale: number): void {
  var clamped = Math.max(GITFLOW_ZOOM_MIN, Math.min(GITFLOW_ZOOM_MAX, scale));
  _gitflowModalScale = clamped;
  var canvas = document.getElementById("gf-canvas");
  var label = document.getElementById("gf-zoom-label");
  if (canvas) canvas.style.transform = "scale(" + clamped + ")";
  if (label) label.textContent = Math.round(clamped * 100) + "%";
}

function setGitflowZoomFit(): void {
  var body = document.getElementById("gf-modal-body");
  var canvas = document.getElementById("gf-canvas");
  if (!body || !canvas) return;
  var svg = canvas.querySelector("svg.gitflow-svg") as SVGSVGElement | null;
  if (!svg) return;
  var natW = svg.width.baseVal.value || parseFloat(svg.getAttribute("width") || "0");
  var natH = svg.height.baseVal.value || parseFloat(svg.getAttribute("height") || "0");
  if (!natW || !natH) return;
  // 56 = approx padding (28*2). Subtract from body inner size before fit.
  var availW = body.clientWidth - 56;
  var availH = body.clientHeight - 56;
  var fit = Math.min(availW / natW, availH / natH);
  // Cap fit at 2.0 — for very small diagrams, oversizing looks bad.
  setGitflowZoom(Math.min(fit, 2));
}

// Async fetch + cache. Idempotent — multiple calls coalesce via the inflight
// set. Once cached, future calls return immediately and re-paint.
function ensureGitflowForWorkspace(ws: WorkspaceEntry): void {
  // Cache hit (data ready or known-unavailable): just paint.
  if (_gitFlowCache.has(ws.id)) {
    paintGitflowInto(ws.id, _gitFlowCache.get(ws.id) || null);
    return;
  }
  if (_gitFlowInflight.has(ws.id)) return;
  var api = window.dashboardAPI;
  if (!api || typeof api.gitFlow !== "function") return;
  _gitFlowInflight.add(ws.id);
  api.gitFlow(ws.absolutePath)
    .then(function (data) {
      _gitFlowCache.set(ws.id, data || null);
      // Only paint if the card is still expanded — avoids a noticeable late
      // pop-in if the user already collapsed the card.
      if (_expandedIds.has(ws.id)) {
        paintGitflowInto(ws.id, data || null);
      }
    })
    .catch(function (err) {
      console.log("[dashboard] gitFlow fetch failed for " + ws.absolutePath + ": " + (err instanceof Error ? err.message : String(err)));
      _gitFlowCache.set(ws.id, null);
    })
    .finally(function () {
      _gitFlowInflight.delete(ws.id);
    });
}

// ---------------------------------------------------------------------------
// Card expand / collapse
// ---------------------------------------------------------------------------

function toggleCardExpand(id: string): void {
  var card = document.querySelector<HTMLElement>(`.ws-card[data-id="${cssAttrEsc(id)}"]`);
  if (!card) return;
  if (_expandedIds.has(id)) {
    _expandedIds.delete(id);
    card.classList.add("collapsed");
  } else {
    _expandedIds.add(id);
    card.classList.remove("collapsed");
    // Trigger gitflow fetch on first expand; cache hits paint synchronously.
    var ws = _workspaces.find(function (w) { return w.id === id; });
    if (ws) ensureGitflowForWorkspace(ws);
  }
  saveExpandedState();
}

function cssAttrEsc(s: string): string {
  // Minimal escape for use inside double-quoted attribute selectors.
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// ---------------------------------------------------------------------------
// Card "more" menu (archive / remove)
// ---------------------------------------------------------------------------

function closeAllCardMenus(): void {
  document.querySelectorAll(".card-menu.open").forEach((el) => el.classList.remove("open"));
}

function toggleCardMenu(id: string): void {
  var menu = document.getElementById("cm-" + id);
  if (!menu) return;
  var wasOpen = menu.classList.contains("open");
  closeAllCardMenus();
  if (!wasOpen) menu.classList.add("open");
}

// ---------------------------------------------------------------------------
// Sprint 3: Discovery banner (~/dev / ~/work / ~/projects scan)
// ---------------------------------------------------------------------------

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

// Decide whether the banner should render (C1 + C2 + C7).
function shouldShowDiscoveryBanner(): boolean {
  if (_discoveryDismissed) return false;
  if (_discoveryCandidates.length === 0) return false;
  if (_filter !== "all") return false;
  if (_search !== "") return false;
  return true;
}

// Group candidate names by their root for the banner subtitle/title.
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

// Build the title text with abbreviated roots (C3).
function buildDiscoveryTitle(candidates: DashboardDiscoveryCandidate[]): string {
  var groups = groupDiscoveryByRoot(candidates);
  var rootSpans = groups
    .map((g) => `<span class="mono">${dashEsc(abbreviateHomePath(g.root, _homeDir))}</span>`)
    .join(", ");
  var n = candidates.length;
  var label = n === 1 ? "repository" : "repositories";
  return `Found ${n} git ${label} in ${rootSpans}`;
}

// Build the sub-text (max ~5 names with overflow).
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

// Render banner into content (prepended). No-op if conditions not met.
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

  // Prepend so banner sits above all card groups
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
  // Re-render to remove the banner immediately
  render();
}

// --- Review modal ---

function openDiscoveryModal(): void {
  var modal = document.getElementById("discover-modal");
  var listEl = document.getElementById("discover-modal-list");
  var subEl = document.getElementById("discover-modal-sub");
  var summaryEl = document.getElementById("discover-modal-summary");
  if (!modal || !listEl || !subEl || !summaryEl) return;

  // Populate list — grouped by root for visual context.
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

  // Wire checkbox change → update summary
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

    // Refresh candidates + cards. fetchDiscoveryCandidates updates state for
    // the next render() call so the banner recomputes (banner hides when
    // _discoveryCandidates becomes empty after batch add — C6).
    await fetchDiscoveryCandidates();
    await loadAndRender();
    if (typeof (window as any).resetAutoRefresh === "function") (window as any).resetAutoRefresh();

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
      // All failed
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

// ---------------------------------------------------------------------------
// Sort dropdown
// ---------------------------------------------------------------------------

function setSort(s: SortKey): void {
  _sort = s;
  savePrefs();
  updateSortUI();
  closeSortMenu();
  console.log(`[dashboard] sort=${_sort}`);
  render();
}

function updateSortUI(): void {
  var label = document.getElementById("sort-label");
  if (label) label.textContent = SORT_LABELS[_sort];
  document.querySelectorAll(".sort-menu-item").forEach((el) => {
    var item = el as HTMLElement;
    item.classList.toggle("selected", item.dataset.sort === _sort);
  });
}

function closeSortMenu(): void {
  var menu = document.getElementById("sort-menu");
  var btn = document.getElementById("btn-sort");
  if (menu) menu.classList.remove("open");
  if (btn) {
    btn.classList.remove("active");
    btn.setAttribute("aria-expanded", "false");
  }
}

function toggleSortMenu(): void {
  var menu = document.getElementById("sort-menu");
  var btn = document.getElementById("btn-sort");
  if (!menu || !btn) return;
  var isOpen = menu.classList.contains("open");
  if (isOpen) {
    closeSortMenu();
  } else {
    menu.classList.add("open");
    btn.classList.add("active");
    btn.setAttribute("aria-expanded", "true");
  }
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
    // Gitflow modal shortcuts (only when modal is open)
    if (_gitflowModalWorkspaceId) {
      if (e.key === "Escape") { e.preventDefault(); closeGitflowModal(); return; }
      if (e.key === "+" || e.key === "=") { e.preventDefault(); setGitflowZoom(_gitflowModalScale + GITFLOW_ZOOM_STEP); return; }
      if (e.key === "-" || e.key === "_") { e.preventDefault(); setGitflowZoom(_gitflowModalScale - GITFLOW_ZOOM_STEP); return; }
      if (e.key === "0") { e.preventDefault(); setGitflowZoom(1); return; }
      if (e.key === "f" || e.key === "F") {
        // Avoid clobbering Cmd/Ctrl+F search shortcut
        if (!e.metaKey && !e.ctrlKey) { e.preventDefault(); setGitflowZoomFit(); return; }
      }
    }
  });
}

function initGitflowModalControls(): void {
  var modal = document.getElementById("gitflow-modal");
  if (!modal) return;
  // Click backdrop (overlay) outside .gf-dlg → close
  modal.addEventListener("click", function (e) {
    if (e.target === modal) closeGitflowModal();
  });
  var closeBtn = document.getElementById("gf-modal-close");
  if (closeBtn) closeBtn.addEventListener("click", closeGitflowModal);
  var zin = document.getElementById("gf-zoom-in");
  if (zin) zin.addEventListener("click", function () { setGitflowZoom(_gitflowModalScale + GITFLOW_ZOOM_STEP); });
  var zout = document.getElementById("gf-zoom-out");
  if (zout) zout.addEventListener("click", function () { setGitflowZoom(_gitflowModalScale - GITFLOW_ZOOM_STEP); });
  var zfit = document.getElementById("gf-zoom-fit");
  if (zfit) zfit.addEventListener("click", setGitflowZoomFit);
  var zreset = document.getElementById("gf-zoom-reset");
  if (zreset) zreset.addEventListener("click", function () { setGitflowZoom(1); });
  // Wheel + Cmd/Ctrl = zoom
  var body = document.getElementById("gf-modal-body");
  if (body) {
    body.addEventListener("wheel", function (e) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      var delta = e.deltaY > 0 ? -GITFLOW_ZOOM_STEP : GITFLOW_ZOOM_STEP;
      setGitflowZoom(_gitflowModalScale + delta);
    }, { passive: false });
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

if (typeof window !== "undefined") {
  loadPrefs();
  initKeyboardShortcuts();
  initGitflowModalControls();

  // Wire toolbar buttons
  var addBtn = document.getElementById("btn-add-workspace") as HTMLButtonElement | null;
  if (addBtn) addBtn.addEventListener("click", () => { void handleAdd(); });

  var refreshBtn = document.getElementById("btn-refresh-all") as HTMLButtonElement | null;
  if (refreshBtn) refreshBtn.addEventListener("click", () => { void handleRefreshAll(); });

  var emptyAddBtn = document.getElementById("btn-empty-add") as HTMLButtonElement | null;
  if (emptyAddBtn) emptyAddBtn.addEventListener("click", () => { void handleAdd(); });

  // Sprint 1: New Project Wizard — "+ New Project" 버튼 후크 (AC #1, #10)
  // 실제 모달 로직은 dashboard-newproject.ts에 위임 (50줄 이내 추가 목표).
  var newProjBtn = document.getElementById("btn-new-project") as HTMLButtonElement | null;
  if (newProjBtn) {
    newProjBtn.addEventListener("click", () => {
      if (typeof (window as any).openNewProjectModal === "function") {
        (window as any).openNewProjectModal(_homeDir);
      }
    });
  }

  // Expose helpers for dashboard-newproject.ts to call back into dashboard.ts
  (window as any).npDashboardRefresh = async (updatedWorkspaces?: WorkspaceEntry[]) => {
    if (updatedWorkspaces) {
      _workspaces = updatedWorkspaces;
    }
    await fetchDiscoveryCandidates();
    await loadAndRender();
    if (typeof (window as any).resetAutoRefresh === "function") (window as any).resetAutoRefresh();
  };
  (window as any).npOpenWithClaude = (absolutePath: string) => {
    void handleOpenWithClaude(absolutePath);
  };

  // Sprint 1 (Codex 진입점): expose for dashboard-newproject.ts Codex tool selection
  (window as any).npOpenWithCodex = (absolutePath: string) => {
    void handleOpenWithCodex(absolutePath);
  };

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

  // Wire sort dropdown
  var sortBtn = document.getElementById("btn-sort");
  if (sortBtn) {
    sortBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      // Closing other open menus first keeps only one popup at a time.
      closeAllCardMenus();
      toggleSortMenu();
    });
  }
  document.querySelectorAll("#sort-menu .sort-menu-item").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      var s = (e.currentTarget as HTMLElement).dataset.sort as SortKey | undefined;
      if (s) setSort(s);
    });
  });

  // Outside-click: close any open dropdown / card menu
  document.addEventListener("click", () => {
    closeSortMenu();
    closeAllCardMenus();
  });
  // Esc closes too
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeSortMenu();
      closeAllCardMenus();
      closeDiscoveryModal();
    }
  });

  // Sprint 3: discovery modal wiring
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
  // Backdrop click closes modal
  var dmBackdrop = document.getElementById("discover-modal");
  if (dmBackdrop) {
    dmBackdrop.addEventListener("click", (e) => {
      if (e.target === dmBackdrop) closeDiscoveryModal();
    });
  }

  // Sync initial visual states
  syncChips();
  syncViewToggle();
  updateSortUI();

  // Register loadAndRender for dashboard-autorefresh.ts auto-refresh cycles (AC #2)
  (window as any).__dashboardLoadAndRender = loadAndRender;

  // Load workspaces
  (async () => {
    try {
      if (!window.dashboardAPI) {
        throw new Error("window.dashboardAPI is undefined — preload script failed to load");
      }
      // Fetch home dir once for path tilde abbreviation
      try {
        _homeDir = await window.dashboardAPI.homedir();
      } catch (err) {
        console.warn("[dashboard] homedir fetch failed:", err);
        _homeDir = "";
      }
      // Sprint 3: kick off discovery scan in parallel — does not block grid render.
      // First-time load: fetch candidates first so the banner appears in the
      // initial paint when conditions match.
      await fetchDiscoveryCandidates();
      await loadAndRender();
      // Start auto-refresh after initial load completes (AC #2, #3, #4)
      if (typeof (window as any).setupAutoRefresh === "function") {
        (window as any).setupAutoRefresh();
      }
    } catch (err) {
      console.error("[dashboard] boot failed:", err);
      var grid = document.getElementById("content") as HTMLDivElement | null;
      if (grid) {
        grid.innerHTML = `<div style="padding:24px;color:var(--err)">Failed to load dashboard: ${dashEsc(err instanceof Error ? err.message : String(err))}</div>`;
      }
    }
  })();
}
