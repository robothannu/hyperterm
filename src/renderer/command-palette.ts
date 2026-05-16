/// <reference path="./global.d.ts" />
/// <reference path="./pane-types.d.ts" />

// Command Palette (Cmd+K) — Warp-style quick switcher.
// Sources: open tabs, registered workspaces, quick actions.
// Loaded as <script> with commonjs-shim — uses `export` for testability.

type PaletteSource = "tab" | "workspace" | "workflow" | "recent" | "action";
type PaletteScope = "all" | "tab" | "workspace" | "workflow" | "recent" | "action";

interface PaletteEntry {
  id: string;
  source: PaletteSource;
  title: string;
  subtitle?: string;
  badge?: string;
  // Primary execute when Enter is pressed (no modifiers).
  exec: () => void | Promise<void>;
  // Optional secondary execute when Cmd/Ctrl+Enter is pressed.
  execAlt?: () => void | Promise<void>;
}

// Pure: extract the basename (last path segment) from a posix-style absolute path.
// Returns the path itself if no separators are present. Trims trailing slashes.
export function pathBasename(p: string): string {
  if (!p) return "";
  const trimmed = p.replace(/[\/\\]+$/, "");
  if (!trimmed) return p; // path was just slashes
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

// Pure: subsequence-style fuzzy score with prefix / word-boundary / consecutive bonuses.
// Returns null if query characters don't all appear in target in order.
// Higher score == better match. Empty query returns 0 (everything matches with no boost).
export function scoreFuzzy(query: string, target: string): number | null {
  const q = (query || "").toLowerCase();
  const t = (target || "").toLowerCase();
  if (q.length === 0) return 0;
  if (t.length === 0) return null;
  let score = 0;
  let qi = 0;
  let consecutive = 0;
  let prevMatched = false;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    const ch = t[ti];
    if (ch === q[qi]) {
      let local = 1;
      if (ti === 0) local += 6; // start-of-string bonus
      const prev = ti > 0 ? t[ti - 1] : "";
      if (prev && /[\s_\-/.]/.test(prev)) local += 4; // word boundary bonus
      if (prevMatched) {
        consecutive += 1;
        local += consecutive * 2; // consecutive run bonus
      } else {
        consecutive = 0;
      }
      score += local;
      prevMatched = true;
      qi += 1;
    } else {
      prevMatched = false;
      consecutive = 0;
    }
  }
  return qi === q.length ? score : null;
}

// Score an entry against a query: max of fuzzy score over title/subtitle/badge,
// with title weighted highest, subtitle medium, badge low. Returns null if none match.
export function scoreEntry(query: string, entry: { title: string; subtitle?: string; badge?: string }): number | null {
  if (!query) return 0;
  const titleScore = scoreFuzzy(query, entry.title);
  const subScore = entry.subtitle ? scoreFuzzy(query, entry.subtitle) : null;
  const badgeScore = entry.badge ? scoreFuzzy(query, entry.badge) : null;
  let best: number | null = null;
  if (titleScore !== null) best = (titleScore * 3);
  if (subScore !== null) {
    const v = subScore * 1.5;
    best = best === null ? v : Math.max(best, v);
  }
  if (badgeScore !== null) {
    best = best === null ? badgeScore : Math.max(best, badgeScore);
  }
  return best;
}

// Wraps a terminal selection in the AI explain prompt template.
// Returns null if the selection is effectively empty after trimming.
export function formatExplainPrompt(selection: string): string | null {
  const trimmed = (selection || "").trim();
  if (trimmed.length === 0) return null;
  return `Analyze the following terminal output and explain the cause and fix:\n\n${trimmed}`;
}

// Filter + rank entries given a query and scope.
export function filterEntries(
  entries: PaletteEntry[],
  query: string,
  scope: PaletteScope = "all"
): PaletteEntry[] {
  const scoped = scope === "all" ? entries : entries.filter((e) => e.source === scope);
  if (!query.trim()) {
    // No query: stable ordering — tabs, workspaces, workflows, recent, actions.
    const orderRank: Record<PaletteSource, number> = {
      tab: 0,
      workspace: 1,
      workflow: 2,
      recent: 3,
      action: 4,
    };
    return [...scoped].sort((a, b) => orderRank[a.source] - orderRank[b.source]);
  }
  const ranked: { entry: PaletteEntry; score: number }[] = [];
  for (const e of scoped) {
    const s = scoreEntry(query, e);
    if (s !== null) ranked.push({ entry: e, score: s });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked.map((r) => r.entry);
}

// =====================================================================
// Browser-only state and DOM. Skipped in Node test context (no document).
// =====================================================================

// Keep all browser code inside functions (never called from Node test context)
// so that requiring this module from Node does not crash on top-level DOM access.
let _paletteOpen = false;
let _paletteQuery = "";
let _paletteScope: PaletteScope = "all";
let _paletteSelected = 0;
let _paletteEntries: PaletteEntry[] = [];
let _paletteFiltered: PaletteEntry[] = [];
let _paletteMode: "search" | "compose" = "search";

function _esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Cross-module references (browser globals from other scripts).
declare const tabMap: Map<number, any>;
declare const tabLabels: Map<number, string>;
declare const tabClusters: Map<number, string>;
declare let activeTabId: number | null;
declare function switchToTab(tabId: number): void;
declare function createNewTab(label: string): void;
declare function nextTerminalName(): string;
declare function toggleChangedFilesPanel(): void;
declare function showClusterDialog(initial: string): Promise<string | null>;
declare function saveSessionMetadata(): void;
declare function renderSidebar(): void;
declare function showToast(message: string, variant?: "error" | "warn" | "ok" | "done"): void;
declare const sessions: Map<number, { terminal: { getSelection(): string } }>;

interface PaletteWorkspaceLite {
  id: string;
  name: string;
  absolutePath: string;
  tool?: WorkspaceTool;
  archived?: boolean;
}

interface PaletteWorkflowLite {
  id: string;
  label: string;
  command: string;
  cwd?: string;
  createdAt?: string;
}

async function _fetchWorkspacesForPalette(): Promise<PaletteWorkspaceLite[]> {
  const api = (window as any).terminalAPI;
  if (!api || typeof api.listWorkspaces !== "function") return [];
  try {
    const list: PaletteWorkspaceLite[] = await api.listWorkspaces();
    return Array.isArray(list) ? list.filter((w) => !w.archived) : [];
  } catch (e) {
    console.warn("[palette] listWorkspaces failed:", e);
    return [];
  }
}

async function _fetchWorkflowsForPalette(): Promise<PaletteWorkflowLite[]> {
  const api = (window as any).terminalAPI;
  if (!api || typeof api.listWorkflows !== "function") return [];
  try {
    const list: PaletteWorkflowLite[] = await api.listWorkflows();
    return Array.isArray(list) ? list : [];
  } catch (e) {
    console.warn("[palette] listWorkflows failed:", e);
    return [];
  }
}

function _toolBadge(tool: WorkspaceTool | undefined): string {
  switch (tool) {
    case "claude":
      return "Claude";
    case "codex":
      return "Codex";
    case "mixed":
      return "Mixed";
    case "none":
      return "—";
    default:
      return "";
  }
}

function _primaryToolFor(tool: WorkspaceTool | undefined): "claude" | "codex" {
  return tool === "codex" ? "codex" : "claude";
}

function _altToolFor(tool: WorkspaceTool | undefined): "claude" | "codex" {
  return tool === "codex" ? "claude" : "codex";
}

async function _openWorkspace(absPath: string, kind: "claude" | "codex"): Promise<void> {
  const api = (window as any).terminalAPI;
  if (!api || typeof api.openWorkspaceWith !== "function") {
    console.warn("[palette] openWorkspaceWith not available");
    return;
  }
  try {
    await api.openWorkspaceWith(absPath, kind);
  } catch (e) {
    console.warn("[palette] openWorkspaceWith failed:", e);
  }
}

async function _buildTabEntries(): Promise<PaletteEntry[]> {
  const out: { entry: PaletteEntry; active: boolean; running: boolean }[] = [];
  if (typeof tabMap === "undefined") return [];
  const api = (window as any).terminalAPI;
  const tasks = Array.from(tabMap.entries()).map(async ([tabId, tab]) => {
    const label = (typeof tabLabels !== "undefined" && tabLabels.get(tabId)) || `Terminal ${tabId}`;
    const cluster = (typeof tabClusters !== "undefined" && tabClusters.get(tabId)) || "";
    const ptyId = tab.focusedPtyId;
    let cwd = "";
    try {
      if (api && typeof api.getCwd === "function") {
        cwd = await api.getCwd(ptyId);
      }
    } catch {
      cwd = "";
    }
    let claudeRunning = false;
    let codexRunning = false;
    try {
      const [claudeStatus, codexStatus] = await Promise.all([
        api && typeof api.getAgentStatus === "function" ? api.getAgentStatus(ptyId).catch(() => null) : Promise.resolve(null),
        api && typeof api.getCodexStatus === "function" ? api.getCodexStatus(ptyId).catch(() => null) : Promise.resolve(null),
      ]);
      claudeRunning = !!claudeStatus && !!claudeStatus.isClaudeRunning;
      codexRunning = !!codexStatus && !!codexStatus.isCodexRunning;
    } catch {
      claudeRunning = false;
      codexRunning = false;
    }
    const running = claudeRunning || codexRunning;
    const subtitleParts = [cwd, cluster ? `cluster: ${cluster}` : ""].filter((x) => x.length > 0);
    const badge = running ? (claudeRunning ? "Claude running" : "Codex running") : cluster ? "Session" : "Tab";
    out.push({
      entry: {
        id: `tab:${tabId}`,
        source: "tab",
        title: label,
        subtitle: subtitleParts.length > 0 ? subtitleParts.join(" · ") : undefined,
        badge,
        exec: () => switchToTab(tabId),
      },
      active: typeof activeTabId !== "undefined" && activeTabId === tabId,
      running,
    });
  });
  await Promise.all(tasks);
  out.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (a.running !== b.running) return a.running ? -1 : 1;
    return a.entry.title.localeCompare(b.entry.title, undefined, { sensitivity: "base" });
  });
  return out.map((r) => r.entry);
}

function _buildWorkspaceEntries(workspaces: PaletteWorkspaceLite[]): PaletteEntry[] {
  return workspaces.map((w) => ({
    id: `ws:${w.id}`,
    source: "workspace" as PaletteSource,
    title: w.name,
    subtitle: w.absolutePath,
    badge: _toolBadge(w.tool),
    exec: () => _openWorkspace(w.absolutePath, _primaryToolFor(w.tool)),
    execAlt: () => _openWorkspace(w.absolutePath, _altToolFor(w.tool)),
  }));
}

function _buildRecentEntries(paths: string[]): PaletteEntry[] {
  return paths.map((p, i) => ({
    id: `recent:${i}:${p}`,
    source: "recent" as PaletteSource,
    title: pathBasename(p) || p,
    subtitle: p,
    badge: "Recent",
    exec: () => _openRecentProject(p),
  }));
}

async function _openRecentProject(projectPath: string): Promise<void> {
  const api = (window as any).terminalAPI;
  // Validate path existence — silently skip if missing.
  if (api && typeof api.checkPathExists === "function") {
    try {
      const exists = await api.checkPathExists(projectPath);
      if (!exists) {
        if (typeof showToast === "function") showToast(`Path not found: ${projectPath}`, "error");
        return;
      }
    } catch { /* ignore — proceed */ }
  }
  const fn = (window as any).createNewTab as
    | ((label?: string, cwd?: string) => Promise<number | null>)
    | undefined;
  if (typeof fn !== "function") return;
  const label = pathBasename(projectPath) || projectPath;
  await fn(label, projectPath);
}

function _buildWorkflowEntries(workflows: PaletteWorkflowLite[]): PaletteEntry[] {
  return workflows.map((w) => ({
    id: `wf:${w.id}`,
    source: "workflow" as PaletteSource,
    title: w.label,
    subtitle: w.cwd ? `${w.command} · ${w.cwd}` : w.command,
    badge: "Flow",
    exec: () => _runWorkflow(w),
  }));
}

async function _runWorkflow(w: PaletteWorkflowLite): Promise<void> {
  const api = (window as any).terminalAPI;
  if (!api || typeof api.writePty !== "function") return;
  // If workflow has a cwd, open a new tab there. Otherwise run in current focused pane.
  if (w.cwd) {
    const fn = (window as any).createNewTab as ((label?: string, cwd?: string) => Promise<number | null>) | undefined;
    if (typeof fn !== "function") {
      if (typeof showToast === "function") showToast("New tab function is unavailable", "error");
      return;
    }
    const tabId = await fn(w.label, w.cwd);
    if (tabId == null) return;
    const tab = (typeof tabMap !== "undefined") ? tabMap.get(tabId) : null;
    const ptyId = tab?.focusedPtyId ?? tabId;
    api.writePty(ptyId, w.command + "\r");
    return;
  }
  // No cwd: run in current focused pane
  const tab = (typeof activeTabId !== "undefined" && activeTabId !== null && typeof tabMap !== "undefined")
    ? tabMap.get(activeTabId)
    : null;
  if (!tab) {
    if (typeof showToast === "function") showToast("No tab available to run this workflow", "warn");
    return;
  }
  api.writePty(tab.focusedPtyId, w.command + "\r");
}

function _buildActionEntries(): PaletteEntry[] {
  const acts: PaletteEntry[] = [];
  acts.push({
    id: "act:new-group",
    source: "action",
    title: "New Group",
    subtitle: "Cmd+N",
    badge: "Action",
    exec: () => createNewTab(nextTerminalName()),
  });
  acts.push({
    id: "act:open-dashboard",
    source: "action",
    title: "Open Workspace Dashboard",
    badge: "Action",
    exec: () => {
      const api = (window as any).terminalAPI;
      if (api && typeof api.openDashboard === "function") api.openDashboard();
    },
  });
  acts.push({
    id: "act:toggle-changed-files",
    source: "action",
    title: "Toggle Changed Files Panel",
    subtitle: "Cmd+Shift+E",
    badge: "Action",
    exec: () => {
      if (typeof toggleChangedFilesPanel === "function") toggleChangedFilesPanel();
    },
  });
  acts.push({
    id: "act:set-cluster",
    source: "action",
    title: "Set Cluster / Project Name",
    subtitle: "Cmd+Shift+G",
    badge: "Action",
    exec: () => {
      if (activeTabId === null) return;
      const currentTabId = activeTabId;
      const currentCluster =
        (typeof tabClusters !== "undefined" && tabClusters.get(currentTabId)) || "";
      showClusterDialog(currentCluster).then((name) => {
        if (name === null) return;
        if (name === "") tabClusters.delete(currentTabId);
        else tabClusters.set(currentTabId, name);
        saveSessionMetadata();
        renderSidebar();
      });
    },
  });
  acts.push({
    id: "act:open-settings",
    source: "action",
    title: "Open Settings",
    subtitle: "Cmd+,",
    badge: "Action",
    exec: () => {
      const btn = document.getElementById("btn-settings") as HTMLElement | null;
      btn?.click();
    },
  });
  acts.push({
    id: "act:add-workflow",
    source: "action",
    title: "Add Workflow…",
    subtitle: "Save a command snippet for later",
    badge: "Action",
    exec: () => _enterComposeMode(),
  });
  acts.push({
    id: "act:explain-claude",
    source: "action",
    title: "Explain selection in Claude",
    subtitle: "Open a new claude tab analyzing the highlighted xterm text",
    badge: "AI",
    exec: () => _explainSelection("claude"),
  });
  acts.push({
    id: "act:explain-codex",
    source: "action",
    title: "Explain selection in Codex",
    subtitle: "Open a new codex tab analyzing the highlighted xterm text",
    badge: "AI",
    exec: () => _explainSelection("codex"),
  });
  return acts;
}

async function _explainSelection(tool: "claude" | "codex"): Promise<void> {
  if (typeof activeTabId === "undefined" || activeTabId === null || typeof tabMap === "undefined") return;
  const tab = tabMap.get(activeTabId);
  if (!tab) {
    if (typeof showToast === "function") showToast("No active tab", "warn");
    return;
  }
  const session = (typeof sessions !== "undefined") ? sessions.get(tab.focusedPtyId) : null;
  if (!session) {
    if (typeof showToast === "function") showToast("Terminal session not found", "warn");
    return;
  }
  const selection = session.terminal.getSelection() || "";
  const prompt = formatExplainPrompt(selection);
  if (prompt === null) {
    if (typeof showToast === "function") showToast("Select terminal text to analyze first", "warn");
    return;
  }
  let cwd: string | undefined;
  try {
    cwd = await (window as any).terminalAPI.getCwd(tab.focusedPtyId);
  } catch {
    cwd = undefined;
  }
  const fn = (window as any).createNewTab as
    | ((label?: string, cwd?: string, options?: unknown) => Promise<number | null>)
    | undefined;
  if (typeof fn !== "function") {
    if (typeof showToast === "function") showToast("createNewTab is unavailable", "error");
    return;
  }
  const label = tool === "codex" ? "codex explain" : "claude explain";
  const opts =
    tool === "codex"
      ? { runWithCodex: true, codexPrompt: prompt }
      : { runWithClaude: true, claudePrompt: prompt };
  await fn(label, cwd, opts);
}

async function rebuildPaletteEntries(): Promise<void> {
  const tabs = await _buildTabEntries();
  const [wsList, wfList] = await Promise.all([
    _fetchWorkspacesForPalette(),
    _fetchWorkflowsForPalette(),
  ]);
  const recents = typeof getMruProjects === "function" ? getMruProjects() : [];
  const workspaces = _buildWorkspaceEntries(wsList);
  const workflows = _buildWorkflowEntries(wfList);
  const recentEntries = _buildRecentEntries(recents);
  const actions = _buildActionEntries();
  _paletteEntries = [...tabs, ...workspaces, ...workflows, ...recentEntries, ...actions];
  _applyFilter();
}

function _applyFilter(): void {
  _paletteFiltered = filterEntries(_paletteEntries, _paletteQuery, _paletteScope);
  if (_paletteSelected >= _paletteFiltered.length) _paletteSelected = 0;
  _renderResults();
}

function _renderResults(): void {
  const list = document.getElementById("palette-results");
  if (!list) return;
  if (_paletteFiltered.length === 0) {
    list.innerHTML = '<div class="palette-empty">No matches</div>';
    return;
  }
  const rows = _paletteFiltered.slice(0, 50).map((e, i) => {
    const isSel = i === _paletteSelected ? " palette-row-selected" : "";
    const sub = e.subtitle ? `<div class="palette-row-sub">${_esc(e.subtitle)}</div>` : "";
    const badge = e.badge ? `<span class="palette-row-badge palette-row-badge-${e.source}">${_esc(e.badge)}</span>` : "";
    return `<div class="palette-row${isSel}" data-idx="${i}">
      <div class="palette-row-main"><span class="palette-row-title">${_esc(e.title)}</span>${sub}</div>
      ${badge}
    </div>`;
  });
  list.innerHTML = rows.join("");
  // Click handlers
  list.querySelectorAll<HTMLElement>(".palette-row").forEach((row) => {
    row.addEventListener("click", (ev) => {
      const idx = Number(row.getAttribute("data-idx") || "0");
      _paletteSelected = idx;
      _executeSelected({ alt: (ev as MouseEvent).metaKey || (ev as MouseEvent).ctrlKey });
    });
  });
  // Scroll selected into view
  const selEl = list.querySelector(".palette-row-selected") as HTMLElement | null;
  selEl?.scrollIntoView({ block: "nearest" });
}

function _renderScope(): void {
  const root = document.getElementById("palette-scope");
  if (!root) return;
  const scopes: { key: PaletteScope; label: string }[] = [
    { key: "all", label: "All" },
    { key: "tab", label: "Tabs" },
    { key: "workspace", label: "Workspaces" },
    { key: "workflow", label: "Workflows" },
    { key: "recent", label: "Recent" },
    { key: "action", label: "Actions" },
  ];
  root.innerHTML = scopes
    .map(
      (s) =>
        `<button class="palette-scope-chip${s.key === _paletteScope ? " palette-scope-active" : ""}" data-scope="${s.key}">${s.label}</button>`
    )
    .join("");
  root.querySelectorAll<HTMLElement>(".palette-scope-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      _paletteScope = (btn.getAttribute("data-scope") as PaletteScope) || "all";
      _paletteSelected = 0;
      _applyFilter();
      _renderScope();
      const input = document.getElementById("palette-input") as HTMLInputElement | null;
      input?.focus();
    });
  });
}

function _executeSelected(opts: { alt: boolean }): void {
  const entry = _paletteFiltered[_paletteSelected];
  if (!entry) return;
  const fn = opts.alt && entry.execAlt ? entry.execAlt : entry.exec;
  closeCommandPalette();
  Promise.resolve(fn()).catch((e) => console.warn("[palette] exec failed:", e));
}

function _onPaletteKeydown(e: KeyboardEvent): void {
  if (!_paletteOpen) return;
  // Compose-mode keys are handled inside the compose UI handlers; only Esc here.
  if (_paletteMode === "compose") {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      _exitComposeMode();
    }
    return;
  }
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    closeCommandPalette();
    return;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    if (_paletteFiltered.length === 0) return;
    _paletteSelected = (_paletteSelected + 1) % _paletteFiltered.length;
    _renderResults();
    return;
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    if (_paletteFiltered.length === 0) return;
    _paletteSelected = (_paletteSelected - 1 + _paletteFiltered.length) % _paletteFiltered.length;
    _renderResults();
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    _executeSelected({ alt: e.metaKey || e.ctrlKey });
    return;
  }
  if (e.key === "Tab") {
    e.preventDefault();
    const order: PaletteScope[] = ["all", "tab", "workspace", "workflow", "recent", "action"];
    const idx = order.indexOf(_paletteScope);
    _paletteScope = order[(idx + (e.shiftKey ? -1 : 1) + order.length) % order.length];
    _paletteSelected = 0;
    _applyFilter();
    _renderScope();
    return;
  }
}

// =====================================================================
// Compose mode — "Add Workflow…" inline form
// =====================================================================

function _enterComposeMode(): void {
  _paletteMode = "compose";
  const root = document.getElementById("command-palette");
  if (!root) return;
  const dialog = root.querySelector(".palette-dialog") as HTMLElement | null;
  if (!dialog) return;
  dialog.innerHTML = `
    <div class="palette-compose-title">Add Workflow</div>
    <input id="palette-compose-label" type="text" class="palette-input" placeholder="Label (e.g. Run tests)" autocomplete="off" spellcheck="false" />
    <input id="palette-compose-command" type="text" class="palette-input" placeholder="Command (e.g. npm test)" autocomplete="off" spellcheck="false" />
    <input id="palette-compose-cwd" type="text" class="palette-input" placeholder="cwd (optional, absolute path; blank = current pane)" autocomplete="off" spellcheck="false" />
    <div id="palette-compose-error" class="palette-compose-error" style="display:none"></div>
    <div class="palette-footer">
      <span><kbd>Enter</kbd> save · <kbd>Esc</kbd> cancel</span>
      <span><button id="palette-compose-save" class="palette-compose-save">Save</button></span>
    </div>`;
  const labelEl = document.getElementById("palette-compose-label") as HTMLInputElement | null;
  const commandEl = document.getElementById("palette-compose-command") as HTMLInputElement | null;
  const cwdEl = document.getElementById("palette-compose-cwd") as HTMLInputElement | null;
  const saveBtn = document.getElementById("palette-compose-save") as HTMLButtonElement | null;
  labelEl?.focus();
  const submit = async () => {
    const label = labelEl?.value.trim() || "";
    const command = commandEl?.value.trim() || "";
    const cwd = cwdEl?.value.trim() || "";
    const err = document.getElementById("palette-compose-error");
    if (label.length === 0 || command.length === 0) {
      if (err) {
        err.style.display = "block";
        err.textContent = "Label and command are required.";
      }
      return;
    }
    const api = (window as any).terminalAPI;
    if (!api || typeof api.addWorkflow !== "function") {
      if (err) {
        err.style.display = "block";
        err.textContent = "Workflows API not available.";
      }
      return;
    }
    try {
      const res = await api.addWorkflow({ label, command, cwd: cwd || undefined });
      if (!res?.ok) {
        if (err) {
          err.style.display = "block";
          err.textContent = `Could not save: ${res?.error || "unknown"}.`;
        }
        return;
      }
      if (typeof showToast === "function") showToast(`Workflow "${label}" saved.`, "ok");
      _exitComposeMode();
      await rebuildPaletteEntries();
    } catch (e) {
      if (err) {
        err.style.display = "block";
        err.textContent = "Save failed: " + (e instanceof Error ? e.message : String(e));
      }
    }
  };
  saveBtn?.addEventListener("click", submit);
  for (const el of [labelEl, commandEl, cwdEl]) {
    el?.addEventListener("keydown", (ev) => {
      const k = ev as KeyboardEvent;
      if (k.key === "Enter") {
        ev.preventDefault();
        submit();
      }
    });
  }
}

function _exitComposeMode(): void {
  _paletteMode = "search";
  // Re-render the search dialog from scratch.
  const root = document.getElementById("command-palette");
  if (!root) return;
  root.remove();
  _paletteOpen = false;
  void openCommandPalette();
}

function _onPaletteInput(e: Event): void {
  const input = e.target as HTMLInputElement;
  _paletteQuery = input.value || "";
  _paletteSelected = 0;
  _applyFilter();
}

function _ensurePaletteDom(): HTMLElement | null {
  let root = document.getElementById("command-palette");
  if (root) return root;
  // Lazy-create if HTML didn't include the markup (defensive — index.html is updated).
  root = document.createElement("div");
  root.id = "command-palette";
  root.className = "command-palette hidden";
  root.innerHTML = `
    <div class="palette-backdrop" data-palette-close></div>
    <div class="palette-dialog" role="dialog" aria-label="Command Palette">
      <input id="palette-input" type="text" class="palette-input" placeholder="Search tabs, workspaces, actions…" autocomplete="off" spellcheck="false" />
      <div id="palette-scope" class="palette-scope"></div>
      <div id="palette-results" class="palette-results"></div>
      <div class="palette-footer">
        <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
        <span><kbd>Enter</kbd> open · <kbd>⌘</kbd>+<kbd>Enter</kbd> alt tool</span>
        <span><kbd>Tab</kbd> scope · <kbd>Esc</kbd> close</span>
      </div>
    </div>`;
  document.body.appendChild(root);
  // Backdrop click closes
  root.querySelector("[data-palette-close]")?.addEventListener("click", () => closeCommandPalette());
  return root;
}

async function openCommandPalette(): Promise<void> {
  if (_paletteOpen) return;
  _paletteOpen = true;
  const root = _ensurePaletteDom();
  if (!root) return;
  root.classList.remove("hidden");
  _paletteQuery = "";
  _paletteSelected = 0;
  _paletteScope = "all";
  const input = document.getElementById("palette-input") as HTMLInputElement | null;
  if (input) {
    input.value = "";
    input.removeEventListener("input", _onPaletteInput);
    input.addEventListener("input", _onPaletteInput);
    input.focus();
  }
  _renderScope();
  _renderResults();
  // Build entries asynchronously (workspace list is async).
  await rebuildPaletteEntries();
  // Capture-phase keydown so Esc/Tab/Enter beat sub-handlers (xterm, modals, etc.).
  document.addEventListener("keydown", _onPaletteKeydown, true);
}

function closeCommandPalette(): void {
  if (!_paletteOpen) return;
  _paletteOpen = false;
  const root = document.getElementById("command-palette");
  root?.classList.add("hidden");
  document.removeEventListener("keydown", _onPaletteKeydown, true);
}

function isCommandPaletteOpen(): boolean {
  return _paletteOpen;
}

// Browser export — attach to window so other scripts can call it.
if (typeof window !== "undefined") {
  (window as any).openCommandPalette = openCommandPalette;
  (window as any).closeCommandPalette = closeCommandPalette;
  (window as any).isCommandPaletteOpen = isCommandPaletteOpen;
}
