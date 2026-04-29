/// <reference path="./global.d.ts" />
// Dashboard renderer — Sprint 4 (card revamp): Overview + Status + Collapsible sections + Files tree
// Loaded only in dashboard.html context (separate BrowserWindow).
// Communicates with main via window.dashboardAPI (exposed by dashboard-preload.ts).

// ---------------------------------------------------------------------------
// Vendor lib type declarations (loaded via <script src="vendor/..."> in HTML)
// ---------------------------------------------------------------------------

declare const marked: {
  parse(src: string, options?: { gfm?: boolean; breaks?: boolean }): string;
};

declare const DOMPurify: {
  sanitize(
    dirty: string,
    config?: {
      FORBID_TAGS?: string[];
      FORBID_ATTR?: string[];
      USE_PROFILES?: { html?: boolean };
    }
  ): string;
};

// ---------------------------------------------------------------------------
// Markdown helpers
// ---------------------------------------------------------------------------

const DOMPURIFY_CONFIG = {
  FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input", "button", "link"],
  FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onmouseout", "onkeydown", "onkeyup", "onfocus", "onblur"],
};

/**
 * Render markdown to safe HTML. Falls back to escaped plain text if library throws.
 */
function renderMarkdown(src: string): string {
  try {
    const rawHtml = marked.parse(src, { gfm: true, breaks: false });
    return DOMPurify.sanitize(rawHtml, DOMPURIFY_CONFIG);
  } catch (err) {
    console.error("[dashboard] markdown parse error, falling back to plain text:", err);
    return `<pre>${escapeHtml(src)}</pre>`;
  }
}

/**
 * Extract a section from markdown: from "## Heading" until the next same-level heading.
 * Exported for unit tests.
 */
export function extractSection(md: string, heading: string): string {
  const lines = md.split("\n");

  // Determine heading level (count leading #)
  const levelMatch = heading.match(/^(#+)\s/);
  const level = levelMatch ? levelMatch[1].length : 2;
  const headingRegex = new RegExp(`^#{${level}}\\s`);

  let inSection = false;
  const result: string[] = [];

  for (const line of lines) {
    if (!inSection) {
      // Check if this line matches our target heading (normalize whitespace)
      const normalizedLine = line.replace(/\s+/g, " ").trim();
      const normalizedHeading = heading.replace(/\s+/g, " ").trim();
      if (normalizedLine === normalizedHeading || normalizedLine.startsWith(normalizedHeading + " ")) {
        inSection = true;
        // Don't include the heading itself in the body
        continue;
      }
    } else {
      // Stop at next same-or-higher level heading
      if (headingRegex.test(line)) {
        break;
      }
      result.push(line);
    }
  }

  return result.join("\n").trim();
}

// ---------------------------------------------------------------------------
// HTML escape (for raw user strings like name, path — NOT for markdown content)
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let workspaces: WorkspaceEntry[] = [];

// Per-card file tree cache: cardId → tree data (null = needs load, false = error)
const fileTreeCache = new Map<string, DashboardFileTreeResult | null>();

// ---------------------------------------------------------------------------
// Toast helper
// ---------------------------------------------------------------------------

let toastTimer: ReturnType<typeof setTimeout> | null = null;

function showDashboardToast(message: string, variant: "ok" | "warn" | "err" = "ok"): void {
  const el = document.getElementById("toast") as HTMLElement;
  el.textContent = message;
  el.className = "visible " + variant;
  if (toastTimer !== null) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.className = "";
    toastTimer = null;
  }, 2800);
}

// ---------------------------------------------------------------------------
// Collapsible section builder
// ---------------------------------------------------------------------------

/**
 * Build a collapsible section element.
 * @param label - Display label for the header
 * @param sectionId - Unique CSS class/id suffix for this section instance
 * @param initiallyOpen - Whether expanded on first render
 * @param contentBuilder - Function that fills the content div
 */
function buildCollapsibleSection(
  label: string,
  sectionId: string,
  initiallyOpen: boolean,
  contentBuilder: (contentEl: HTMLDivElement) => void
): HTMLDivElement {
  const section = document.createElement("div");
  section.className = "card-section card-section--collapsible";
  section.dataset.sectionId = sectionId;

  const header = document.createElement("div");
  header.className = "card-section-toggle";
  header.setAttribute("role", "button");
  header.setAttribute("tabindex", "0");
  header.setAttribute("aria-expanded", initiallyOpen ? "true" : "false");

  const caret = document.createElement("span");
  caret.className = "section-caret";
  caret.setAttribute("aria-hidden", "true");
  caret.textContent = initiallyOpen ? "▼" : "▶";

  const labelEl = document.createElement("span");
  labelEl.className = "card-section-label";
  labelEl.textContent = label;

  header.appendChild(caret);
  header.appendChild(labelEl);

  const content = document.createElement("div");
  content.className = "card-section-content";
  content.style.display = initiallyOpen ? "" : "none";

  contentBuilder(content);

  section.appendChild(header);
  section.appendChild(content);

  const toggle = () => {
    const isOpen = content.style.display !== "none";
    const nextOpen = !isOpen;
    content.style.display = nextOpen ? "" : "none";
    caret.textContent = nextOpen ? "▼" : "▶";
    header.setAttribute("aria-expanded", nextOpen ? "true" : "false");
    console.log(`[dashboard] toggle ${sectionId}=${nextOpen ? "open" : "closed"}`);
  };

  header.addEventListener("click", (e) => {
    e.stopPropagation();
    toggle();
  });
  header.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  });

  return section;
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

/** Build Overview section (always open, no toggle) */
function buildOverviewSectionEl(summary: DashboardOverviewSummary | { error: string }): HTMLDivElement {
  const section = document.createElement("div");
  section.className = "card-section card-section--always-open";

  const labelEl = document.createElement("div");
  labelEl.className = "card-section-label";
  labelEl.textContent = "Overview";
  section.appendChild(labelEl);

  if ("error" in summary) {
    const err = document.createElement("span");
    err.className = "card-absent";
    err.textContent = `error: ${summary.error}`;
    section.appendChild(err);
    return section;
  }

  const grid = document.createElement("div");
  grid.className = "overview-grid";

  // Goal
  const goalRow = document.createElement("div");
  goalRow.className = "overview-row";
  const goalLabel = document.createElement("span");
  goalLabel.className = "overview-row-label";
  goalLabel.textContent = "목표";
  const goalValue = document.createElement("div");
  goalValue.className = "overview-row-value md-content";
  if (summary.goal) {
    goalValue.innerHTML = renderMarkdown(summary.goal);
  } else {
    goalValue.innerHTML = `<span class="card-absent">—</span>`;
  }
  goalRow.appendChild(goalLabel);
  goalRow.appendChild(goalValue);
  grid.appendChild(goalRow);

  // Current task
  const taskRow = document.createElement("div");
  taskRow.className = "overview-row";
  const taskLabel = document.createElement("span");
  taskLabel.className = "overview-row-label";
  taskLabel.textContent = "현재 작업";
  const taskValue = document.createElement("div");
  taskValue.className = "overview-row-value";
  taskValue.textContent = summary.currentTask ?? "—";
  if (!summary.currentTask) taskValue.classList.add("card-absent");
  taskRow.appendChild(taskLabel);
  taskRow.appendChild(taskValue);
  grid.appendChild(taskRow);

  // Next steps
  const nextRow = document.createElement("div");
  nextRow.className = "overview-row";
  const nextLabel = document.createElement("span");
  nextLabel.className = "overview-row-label";
  nextLabel.textContent = "다음 할 일";
  const nextValue = document.createElement("div");
  nextValue.className = "overview-row-value";
  if (summary.nextSteps.length > 0) {
    const ul = document.createElement("ul");
    ul.className = "overview-list";
    for (const step of summary.nextSteps) {
      const li = document.createElement("li");
      li.textContent = step;
      ul.appendChild(li);
    }
    nextValue.appendChild(ul);
  } else {
    nextValue.innerHTML = `<span class="card-absent">—</span>`;
  }
  nextRow.appendChild(nextLabel);
  nextRow.appendChild(nextValue);
  grid.appendChild(nextRow);

  // Git activity
  const actRow = document.createElement("div");
  actRow.className = "overview-row";
  const actLabel = document.createElement("span");
  actLabel.className = "overview-row-label";
  actLabel.textContent = "활동도";
  const actValue = document.createElement("div");
  actValue.className = "overview-row-value";
  if (summary.git.notAGitRepo) {
    actValue.innerHTML = `<span class="card-absent">not a git repo</span>`;
  } else if (summary.git.branch !== null) {
    const dirty = summary.git.dirty ? " · dirty" : " · clean";
    const commits = summary.git.commitsLast7d !== null
      ? ` · ${summary.git.commitsLast7d} commits (7d)`
      : "";
    actValue.innerHTML = `<code class="branch-name">${escapeHtml(summary.git.branch)}</code><span class="git-activity-meta">${escapeHtml(dirty + commits)}</span>`;
  } else {
    actValue.innerHTML = `<span class="card-absent">—</span>`;
  }
  actRow.appendChild(actLabel);
  actRow.appendChild(actValue);
  grid.appendChild(actRow);

  section.appendChild(grid);
  return section;
}

/** Build Status section (always open, no toggle) */
function buildStatusSectionEl(status: DashboardStatusInfo | { error: string }): HTMLDivElement {
  const section = document.createElement("div");
  section.className = "card-section card-section--always-open";

  const labelEl = document.createElement("div");
  labelEl.className = "card-section-label";
  labelEl.textContent = "Status";
  section.appendChild(labelEl);

  if ("error" in status) {
    const err = document.createElement("span");
    err.className = "card-absent";
    err.textContent = `error: ${status.error}`;
    section.appendChild(err);
    return section;
  }

  if (status.notAGitRepo) {
    const msg = document.createElement("span");
    msg.className = "card-absent";
    msg.textContent = "not a git repo";
    section.appendChild(msg);
    return section;
  }

  const statusBlock = document.createElement("div");
  statusBlock.className = "status-block";

  // Line 1: branch · dirty/clean · staged · unstaged · untracked
  const line1 = document.createElement("div");
  line1.className = "status-line";

  if (status.branch) {
    const branchEl = document.createElement("code");
    branchEl.className = "branch-name";
    branchEl.textContent = status.branch;
    line1.appendChild(branchEl);
    line1.appendChild(document.createTextNode(" · "));
  }

  const dirtyEl = document.createElement("span");
  if (status.dirty) {
    dirtyEl.className = "status-dirty";
    dirtyEl.textContent = "dirty";
  } else {
    dirtyEl.className = "status-clean";
    dirtyEl.textContent = "clean";
  }
  line1.appendChild(dirtyEl);

  if (status.dirty) {
    const counts: string[] = [];
    if (status.staged !== null && status.staged > 0) counts.push(`${status.staged} staged`);
    if (status.unstaged !== null && status.unstaged > 0) counts.push(`${status.unstaged} unstaged`);
    if (status.untracked !== null && status.untracked > 0) counts.push(`${status.untracked} untracked`);
    if (counts.length > 0) {
      const countsEl = document.createElement("span");
      countsEl.className = "status-counts";
      countsEl.textContent = ` (${counts.join(" · ")})`;
      line1.appendChild(countsEl);
    }
  }

  if (status.ahead !== null || status.behind !== null) {
    const aheadBehind: string[] = [];
    if ((status.ahead ?? 0) > 0) aheadBehind.push(`↑${status.ahead}`);
    if ((status.behind ?? 0) > 0) aheadBehind.push(`↓${status.behind}`);
    if (aheadBehind.length > 0) {
      const abEl = document.createElement("span");
      abEl.className = "status-ahead-behind";
      abEl.textContent = " · " + aheadBehind.join(" ");
      line1.appendChild(abEl);
    }
  }

  statusBlock.appendChild(line1);

  // Line 2: origin URL · last commit time
  const line2Parts: string[] = [];
  if (status.remoteUrl) line2Parts.push(`origin: ${status.remoteUrl}`);
  if (status.lastCommitRelTime) line2Parts.push(`last commit ${status.lastCommitRelTime}`);

  if (line2Parts.length > 0) {
    const line2 = document.createElement("div");
    line2.className = "status-line status-line--meta";
    line2.textContent = line2Parts.join(" · ");
    statusBlock.appendChild(line2);
  }

  section.appendChild(statusBlock);
  return section;
}

/** Build Progress section (collapsible) */
function buildProgressSectionEl(progressMd: string | null, progressError: string | undefined): HTMLDivElement {
  return buildCollapsibleSection("Progress", "progress", false, (content) => {
    if (progressMd === null) {
      const msg = progressError
        ? `error reading progress.md: ${escapeHtml(progressError)}`
        : "no progress.md found";
      content.innerHTML = `<span class="card-absent">${msg}</span>`;
      return;
    }

    const SECTIONS: { key: string; heading: string }[] = [
      { key: "Current Task", heading: "## Current Task" },
      { key: "Last Session", heading: "## Last Session" },
      { key: "Next Steps", heading: "## Next Steps" },
      { key: "Harness State", heading: "## Harness State" },
    ];

    for (const { key, heading } of SECTIONS) {
      const body = extractSection(progressMd, heading);
      const subLabel = document.createElement("div");
      subLabel.className = "card-sub-label";
      subLabel.textContent = key;
      content.appendChild(subLabel);

      if (body) {
        const mdEl = document.createElement("div");
        mdEl.className = "md-content progress-content";
        mdEl.innerHTML = renderMarkdown(body);
        content.appendChild(mdEl);
      } else {
        const absent = document.createElement("span");
        absent.className = "card-absent";
        absent.textContent = "—";
        content.appendChild(absent);
      }
    }
  });
}

/** Build Recent Commits section (collapsible) */
function buildCommitsSectionEl(
  gitLog: DashboardGitLogEntry[] | null,
  notAGitRepo: boolean,
  gitError: string | undefined
): HTMLDivElement {
  return buildCollapsibleSection("Recent Commits", "commits", false, (content) => {
    if (notAGitRepo) {
      content.innerHTML = `<span class="card-absent">not a git repository</span>`;
    } else if (gitLog === null) {
      const msg = gitError
        ? `error running git log: ${escapeHtml(gitError)}`
        : "git log unavailable";
      content.innerHTML = `<span class="card-absent">${msg}</span>`;
    } else if (gitLog.length === 0) {
      content.innerHTML = `<span class="card-absent">no commits yet</span>`;
    } else {
      const table = document.createElement("table");
      table.className = "git-log-table";
      const tbody = document.createElement("tbody");
      for (const entry of gitLog) {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td class="git-log-hash">${escapeHtml(entry.hash)}</td>
          <td class="git-log-msg">${escapeHtml(entry.msg)}</td>
          <td class="git-log-time">${escapeHtml(entry.relTime)}</td>
        `;
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      content.appendChild(table);
    }
  });
}

// ---------------------------------------------------------------------------
// Files tree
// ---------------------------------------------------------------------------

function buildFileTreeNode(
  node: DashboardFileTreeNode,
  depth: number
): HTMLDivElement {
  const container = document.createElement("div");
  container.className = "tree-node";
  container.dataset.nodePath = node.path;
  container.dataset.nodeType = node.type;

  const row = document.createElement("div");
  row.className = "tree-row";
  row.style.paddingLeft = `${depth * 13 + 6}px`;

  if (node.type === "dir") {
    const caret = document.createElement("span");
    caret.className = "tree-caret";
    caret.setAttribute("aria-hidden", "true");
    caret.textContent = "▶";

    const icon = document.createElement("span");
    icon.className = "tree-icon tree-icon--dir";
    icon.textContent = "📁";

    const label = document.createElement("span");
    label.className = "tree-label";
    label.textContent = node.name;

    row.appendChild(caret);
    row.appendChild(icon);
    row.appendChild(label);

    // Children container (lazy — we already have children from the tree)
    const childrenEl = document.createElement("div");
    childrenEl.className = "tree-children";
    childrenEl.style.display = "none";

    if (node.children && node.children.length > 0) {
      for (const child of node.children) {
        childrenEl.appendChild(buildFileTreeNode(child, depth + 1));
      }
    } else {
      const empty = document.createElement("div");
      empty.className = "tree-row tree-empty";
      empty.style.paddingLeft = `${(depth + 1) * 13 + 6}px`;
      empty.textContent = "(empty)";
      childrenEl.appendChild(empty);
    }

    container.appendChild(row);
    container.appendChild(childrenEl);

    row.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = childrenEl.style.display !== "none";
      const nextOpen = !isOpen;
      childrenEl.style.display = nextOpen ? "" : "none";
      caret.textContent = nextOpen ? "▼" : "▶";
    });
  } else {
    const spacer = document.createElement("span");
    spacer.className = "tree-spacer";

    const icon = document.createElement("span");
    icon.className = "tree-icon tree-icon--file";
    icon.textContent = "📄";

    const label = document.createElement("span");
    label.className = "tree-label";
    label.textContent = node.name;

    row.appendChild(spacer);
    row.appendChild(icon);
    row.appendChild(label);

    container.appendChild(row);

    row.addEventListener("click", (e) => {
      e.stopPropagation();
      console.log(`[dashboard] file clicked: ${node.path}`);
    });
  }

  return container;
}

/** Build Files section (collapsible, lazy-load IPC on first open) */
function buildFilesSectionEl(ws: WorkspaceEntry): HTMLDivElement {
  let loaded = false;

  const section = buildCollapsibleSection("Files", `files-${ws.id}`, false, (_content) => {
    // content is empty initially — filled on first toggle
  });

  // Get the content div and header
  const content = section.querySelector(".card-section-content") as HTMLDivElement;
  const header = section.querySelector(".card-section-toggle") as HTMLDivElement;
  const caret = section.querySelector(".section-caret") as HTMLSpanElement;

  // Override toggle to do lazy-load
  const originalClick = header.onclick;
  void originalClick; // suppress unused warning

  // Remove existing click listener by cloning, then re-add custom one
  const newHeader = header.cloneNode(true) as HTMLDivElement;
  const newCaret = newHeader.querySelector(".section-caret") as HTMLSpanElement;
  header.replaceWith(newHeader);

  const toggle = async () => {
    const isOpen = content.style.display !== "none";
    const nextOpen = !isOpen;

    if (nextOpen && !loaded) {
      console.log(`[dashboard] Files lazy-load start: ${ws.absolutePath}`);
      content.style.display = "";
      newCaret.textContent = "▼";
      newHeader.setAttribute("aria-expanded", "true");

      // Show loading state
      content.innerHTML = `<span class="card-absent" style="padding:8px 0;display:block;">Loading…</span>`;

      try {
        // Check cache first
        const cached = fileTreeCache.get(ws.id);
        let treeResult: DashboardFileTreeResult;

        if (cached !== undefined && cached !== null) {
          treeResult = cached;
          console.log(`[dashboard] Files using cached tree for ${ws.absolutePath}`);
        } else {
          treeResult = await window.dashboardAPI!.fileTree(ws.absolutePath);
          fileTreeCache.set(ws.id, treeResult);
          console.log(`[dashboard] Files lazy-load complete: ${ws.absolutePath}, nodes: ${treeResult.tree?.length ?? 0}`);
        }

        content.innerHTML = "";

        if (treeResult.error) {
          content.innerHTML = `<span class="card-absent">Error loading files: ${escapeHtml(treeResult.error)}</span>`;
        } else if (!treeResult.tree || treeResult.tree.length === 0) {
          content.innerHTML = `<span class="card-absent">No files found.</span>`;
        } else {
          const treeContainer = document.createElement("div");
          treeContainer.className = "tree-container";
          for (const node of treeResult.tree) {
            treeContainer.appendChild(buildFileTreeNode(node, 0));
          }
          content.appendChild(treeContainer);
        }

        loaded = true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[dashboard] Files lazy-load error for ${ws.absolutePath}:`, err);
        content.innerHTML = `<span class="card-absent">Failed to load files: ${escapeHtml(msg)}</span>`;
        loaded = true;
      }
    } else {
      content.style.display = nextOpen ? "" : "none";
      newCaret.textContent = nextOpen ? "▼" : "▶";
      newHeader.setAttribute("aria-expanded", nextOpen ? "true" : "false");
      console.log(`[dashboard] toggle files-${ws.id}=${nextOpen ? "open" : "closed"}`);
    }
  };

  newHeader.addEventListener("click", (e) => {
    e.stopPropagation();
    void toggle();
  });
  newHeader.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      void toggle();
    }
  });

  // Also suppress the stale caret reference
  void caret;

  return section;
}

// ---------------------------------------------------------------------------
// Card body loading: load data and populate into a pre-existing card element
// ---------------------------------------------------------------------------

async function populateCardBody(
  card: HTMLElement,
  ws: WorkspaceEntry,
  isMissing: boolean
): Promise<void> {
  // Remove any existing body/loading
  card.querySelectorAll(".card-body, .card-loading").forEach((el) => el.remove());

  if (isMissing) {
    // Missing: show inline message + remove button (no content load)
    const missingBody = document.createElement("div");
    missingBody.className = "card-body";
    missingBody.innerHTML = `
      <div class="card-section card-missing-actions">
        <span class="card-absent">Folder not found on disk.</span>
        <button class="btn-remove-missing" data-id="${escapeHtml(ws.id)}">Remove from list</button>
      </div>
    `;
    card.appendChild(missingBody);

    const removeBtn = missingBody.querySelector(".btn-remove-missing") as HTMLButtonElement | null;
    if (removeBtn) {
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        void handleRemove(ws.id);
      });
    }
    return;
  }

  const loadingEl = document.createElement("div");
  loadingEl.className = "card-loading";
  loadingEl.textContent = "Loading…";
  card.appendChild(loadingEl);

  const api = window.dashboardAPI!;

  try {
    // Load old card data (progress + gitLog) + new data in parallel
    const [cardData, summaryResult, statusResult] = await Promise.all([
      api.readCardData(ws.absolutePath),
      api.overviewSummary(ws.absolutePath),
      api.statusInfo(ws.absolutePath),
    ]);

    // Remove loading placeholder
    if (loadingEl.parentElement === card) card.removeChild(loadingEl);

    const body = document.createElement("div");
    body.className = "card-body";

    if ("error" in cardData) {
      body.innerHTML = `
        <div class="card-section">
          <span class="card-absent">Error loading data: ${escapeHtml(cardData.error)}</span>
        </div>
      `;
      card.appendChild(body);
      return;
    }

    // 1. Overview section (always open)
    try {
      body.appendChild(buildOverviewSectionEl(summaryResult));
    } catch (err) {
      console.error("[dashboard] overview section render error:", err);
      const sec = document.createElement("div");
      sec.className = "card-section card-section--always-open";
      sec.innerHTML = `<div class="card-section-label">Overview</div><span class="card-absent">render error</span>`;
      body.appendChild(sec);
    }

    // 2. Status section (always open)
    try {
      body.appendChild(buildStatusSectionEl(statusResult));
    } catch (err) {
      console.error("[dashboard] status section render error:", err);
      const sec = document.createElement("div");
      sec.className = "card-section card-section--always-open";
      sec.innerHTML = `<div class="card-section-label">Status</div><span class="card-absent">render error</span>`;
      body.appendChild(sec);
    }

    // 3. Progress section (collapsible, initially closed)
    try {
      body.appendChild(buildProgressSectionEl(cardData.progress, cardData.errors.progress));
    } catch (err) {
      console.error("[dashboard] progress section render error:", err);
      const sec = document.createElement("div");
      sec.className = "card-section";
      sec.innerHTML = `<div class="card-section-label">Progress</div><span class="card-absent">render error</span>`;
      body.appendChild(sec);
    }

    // 4. Recent Commits section (collapsible, initially closed)
    try {
      body.appendChild(buildCommitsSectionEl(cardData.gitLog, cardData.notAGitRepo, cardData.errors.gitLog));
    } catch (err) {
      console.error("[dashboard] commits section render error:", err);
      const sec = document.createElement("div");
      sec.className = "card-section";
      sec.innerHTML = `<div class="card-section-label">Recent Commits</div><span class="card-absent">render error</span>`;
      body.appendChild(sec);
    }

    // 5. Files section (collapsible, lazy-load)
    try {
      body.appendChild(buildFilesSectionEl(ws));
    } catch (err) {
      console.error("[dashboard] files section render error:", err);
      const sec = document.createElement("div");
      sec.className = "card-section";
      sec.innerHTML = `<div class="card-section-label">Files</div><span class="card-absent">render error</span>`;
      body.appendChild(sec);
    }

    card.appendChild(body);
  } catch (err) {
    console.error(`[dashboard] card data IPC error for ${ws.absolutePath}:`, err);
    if (loadingEl.parentElement === card) card.removeChild(loadingEl);
    const errorEl = document.createElement("div");
    errorEl.className = "card-section";
    errorEl.innerHTML = `<span class="card-absent">Failed to load card data.</span>`;
    card.appendChild(errorEl);
  }
}

// ---------------------------------------------------------------------------
// Card rendering — builds the full card element (header + async body)
// ---------------------------------------------------------------------------

function renderCardHeader(card: HTMLElement, ws: WorkspaceEntry, isMissing: boolean): void {
  const existing = card.querySelector(".card-header");
  if (existing) existing.remove();

  const header = document.createElement("div");
  header.className = "card-header";

  // Name (editable inline)
  const nameEl = document.createElement("div");
  nameEl.className = "card-name";
  nameEl.textContent = ws.name;
  nameEl.title = "Click to rename";

  // Path
  const pathEl = document.createElement("div");
  pathEl.className = "card-path";
  pathEl.textContent = ws.absolutePath;

  const infoDiv = document.createElement("div");
  infoDiv.className = "card-header-info";
  infoDiv.appendChild(nameEl);
  infoDiv.appendChild(pathEl);

  // Actions (right side): Refresh + Open + Remove
  const actionsDiv = document.createElement("div");
  actionsDiv.className = "card-header-actions";

  const refreshBtn = document.createElement("button");
  refreshBtn.className = "btn-card-refresh";
  refreshBtn.title = "Refresh card data";
  refreshBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none">
    <path d="M13.5 8A5.5 5.5 0 1 1 8 2.5c1.6 0 3 .68 4 1.76" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
    <path d="M12 2v3h-3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;

  const openBtn = document.createElement("button");
  openBtn.className = "btn-open-workspace" + (isMissing ? " disabled" : "");
  openBtn.disabled = isMissing;
  openBtn.title = isMissing ? "Folder not found" : "Open in terminal";
  openBtn.dataset.path = ws.absolutePath;
  openBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 16 16" fill="none">
    <path d="M6 3H3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
    <path d="M9 2h5v5M14 2l-6 6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg> Open`;

  const removeBtn = document.createElement("button");
  removeBtn.className = "btn-remove";
  removeBtn.dataset.id = ws.id;
  removeBtn.title = "Remove workspace";
  removeBtn.textContent = "×";

  actionsDiv.appendChild(refreshBtn);
  actionsDiv.appendChild(openBtn);
  actionsDiv.appendChild(removeBtn);

  header.appendChild(infoDiv);
  header.appendChild(actionsDiv);

  // Insert at top of card (before other children)
  card.insertBefore(header, card.firstChild);

  // Inline name edit on click
  nameEl.addEventListener("click", (e) => {
    e.stopPropagation();
    startNameEdit(card, ws, nameEl);
  });

  // Refresh button — invalidate file tree cache + reload
  refreshBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    console.log(`[dashboard] refresh: card for ${ws.absolutePath}`);
    // Invalidate file tree cache so next Files open re-fetches
    fileTreeCache.delete(ws.id);

    const exists = await window.dashboardAPI!.checkPathExists(ws.absolutePath);
    const nowMissing = !exists;
    if (nowMissing) {
      card.classList.add("missing");
    } else {
      card.classList.remove("missing");
    }
    renderCardHeader(card, ws, nowMissing);
    await populateCardBody(card, ws, nowMissing);
    console.log(`[dashboard] refresh: complete for ${ws.absolutePath}, missing=${nowMissing}`);
  });

  // Open button
  openBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (isMissing) {
      showDashboardToast("Folder not found on disk.", "warn");
      return;
    }
    console.log(`[dashboard] open: sending openInMain for ${ws.absolutePath}`);
    try {
      const result = await window.dashboardAPI!.openInMain(ws.absolutePath);
      if (result.error) {
        if (result.error === "path_missing") {
          showDashboardToast("Folder not found on disk. Refresh the card.", "warn");
        } else {
          showDashboardToast(`Error: ${result.error}`, "err");
        }
        console.warn(`[dashboard] open: error=${result.error}`);
      } else {
        console.log(`[dashboard] open: success for ${ws.absolutePath}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showDashboardToast(`Failed to open: ${msg}`, "err");
      console.error(`[dashboard] open: IPC failed:`, err);
    }
  });

  // Remove button
  removeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    void handleRemove(ws.id);
  });
}

async function renderCard(ws: WorkspaceEntry, isMissing: boolean): Promise<HTMLElement> {
  const card = document.createElement("div");
  card.className = "ws-card" + (isMissing ? " missing" : "");
  card.dataset.id = ws.id;

  renderCardHeader(card, ws, isMissing);
  await populateCardBody(card, ws, isMissing);

  return card;
}

// ---------------------------------------------------------------------------
// Inline name edit (Sprint 3 AC6)
// ---------------------------------------------------------------------------

function startNameEdit(card: HTMLElement, ws: WorkspaceEntry, nameEl: HTMLElement): void {
  if (card.querySelector(".card-name-input")) return; // already editing

  const currentName = ws.name;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "card-name-input";
  input.value = currentName;
  input.title = "Press Enter to save, Esc to cancel";

  nameEl.style.display = "none";
  nameEl.insertAdjacentElement("afterend", input);
  input.focus();
  input.select();

  let committed = false;

  const commit = async () => {
    if (committed) return;
    committed = true;

    const newName = input.value.trim();
    input.remove();
    nameEl.style.display = "";

    if (!newName || newName === currentName) {
      return;
    }

    try {
      const result = await window.dashboardAPI!.renameWorkspace(ws.id, newName);
      if (result.success) {
        ws.name = newName;
        workspaces = result.workspaces;
        nameEl.textContent = newName;
        console.log(`[dashboard] rename: success id=${ws.id} name=${newName}`);
        showDashboardToast("Workspace renamed.", "ok");
      } else {
        showDashboardToast("Failed to rename workspace.", "err");
      }
    } catch (err) {
      console.error("[dashboard] rename IPC error:", err);
      showDashboardToast("Failed to rename workspace.", "err");
    }
  };

  const cancel = () => {
    if (committed) return;
    committed = true;
    input.remove();
    nameEl.style.display = "";
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); void commit(); }
    else if (e.key === "Escape") { e.preventDefault(); cancel(); }
  });
  input.addEventListener("blur", () => { void commit(); });
  input.addEventListener("click", (e) => e.stopPropagation());
}

// ---------------------------------------------------------------------------
// Render all workspaces
// ---------------------------------------------------------------------------

async function renderWorkspaces(): Promise<void> {
  const grid = document.getElementById("card-grid") as HTMLDivElement;
  const emptyState = document.getElementById("empty-state") as HTMLDivElement;

  grid.innerHTML = "";

  if (workspaces.length === 0) {
    emptyState.style.display = "";
    console.log("[dashboard] renderWorkspaces: empty state shown");
    return;
  }

  emptyState.style.display = "none";

  // Check path existence for all workspaces in parallel
  const api = window.dashboardAPI!;
  const existsResults = await Promise.all(
    workspaces.map((ws) => api.checkPathExists(ws.absolutePath))
  );

  console.log(`[dashboard] renderWorkspaces: rendering ${workspaces.length} card(s)`);

  // Render cards in parallel (each card loads its data independently)
  const cardPromises = workspaces.map((ws, i) =>
    renderCard(ws, !existsResults[i]).catch((err) => {
      console.error(`[dashboard] fatal renderCard error for ${ws.absolutePath}:`, err);
      const fallback = document.createElement("div");
      fallback.className = "ws-card";
      fallback.dataset.id = ws.id;
      fallback.innerHTML = `
        <div class="card-header">
          <div class="card-header-info">
            <div class="card-name">${escapeHtml(ws.name)}</div>
            <div class="card-path">${escapeHtml(ws.absolutePath)}</div>
          </div>
        </div>
        <div class="card-section"><span class="card-absent">Card failed to render.</span></div>
      `;
      return fallback;
    })
  );

  const cards = await Promise.all(cardPromises);
  for (const card of cards) {
    grid.appendChild(card);
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleAdd(): Promise<void> {
  const result = await window.dashboardAPI!.addWorkspace();
  if (result.cancelled) return;

  if (result.duplicate) {
    showDashboardToast("This folder is already in your workspace list.", "warn");
    return;
  }

  workspaces = result.workspaces;
  await renderWorkspaces();
  showDashboardToast("Workspace added.", "ok");
}

async function handleRemove(id: string): Promise<void> {
  const ws = workspaces.find((w) => w.id === id);
  if (!ws) return;

  const confirmed = window.confirm(
    `Remove "${ws.name}" from workspaces?\n\nThe original folder will not be deleted.`
  );
  if (!confirmed) return;

  workspaces = await window.dashboardAPI!.removeWorkspace(id);
  fileTreeCache.delete(id);
  await renderWorkspaces();
  showDashboardToast("Workspace removed.", "ok");
}

async function handleRefreshAll(): Promise<void> {
  console.log("[dashboard] refresh all cards");
  // Clear all file tree caches
  fileTreeCache.clear();
  await renderWorkspaces();
  showDashboardToast("Refreshed.", "ok");
}

// ---------------------------------------------------------------------------
// Boot (guard: skip in Node.js unit test environment)
// ---------------------------------------------------------------------------

if (typeof window !== "undefined") {
  // Wire up button handlers FIRST (synchronously) so clicks always work
  // even if the initial workspace list load fails.
  const addBtn = document.getElementById("btn-add-workspace") as HTMLButtonElement | null;
  if (addBtn) {
    addBtn.addEventListener("click", () => { void handleAdd(); });
  } else {
    console.error("[dashboard] boot: #btn-add-workspace not found in DOM");
  }

  const refreshAllBtn = document.getElementById("btn-refresh-all") as HTMLButtonElement | null;
  if (refreshAllBtn) {
    refreshAllBtn.addEventListener("click", () => { void handleRefreshAll(); });
  }

  const emptyAddBtn = document.getElementById("btn-empty-add") as HTMLButtonElement | null;
  if (emptyAddBtn) {
    emptyAddBtn.addEventListener("click", () => { void handleAdd(); });
  }

  (async () => {
    try {
      if (!window.dashboardAPI) {
        throw new Error("window.dashboardAPI is undefined — preload script failed to load");
      }
      workspaces = await window.dashboardAPI.listWorkspaces();
      await renderWorkspaces();
    } catch (err) {
      console.error("[dashboard] boot failed:", err);
      const grid = document.getElementById("card-grid") as HTMLDivElement | null;
      if (grid) {
        grid.innerHTML = `<div class="card-section"><span class="card-absent">Failed to load workspaces: ${escapeHtml(err instanceof Error ? err.message : String(err))}</span></div>`;
      }
    }
  })();
}
