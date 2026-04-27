/// <reference path="./global.d.ts" />
// Dashboard renderer — Sprint 2: Card grid + Markdown rendering
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
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let workspaces: WorkspaceEntry[] = [];

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
// Card rendering
// ---------------------------------------------------------------------------

/** Build the "Overview" section from CLAUDE.md */
function buildOverviewSection(claudeMd: string | null, claudeError: string | undefined): string {
  if (claudeMd === null) {
    const msg = claudeError
      ? `error reading CLAUDE.md: ${escapeHtml(claudeError)}`
      : "no CLAUDE.md found";
    return `<div class="card-section-label">Overview</div><span class="card-absent">${msg}</span>`;
  }

  const body = extractSection(claudeMd, "## Overview");
  const html = body
    ? `<div class="md-content">${renderMarkdown(body)}</div>`
    : `<span class="card-absent">no "## Overview" section found</span>`;

  return `<div class="card-section-label">Overview</div>${html}`;
}

/** Build progress.md sub-sections */
function buildProgressSections(progressMd: string | null, progressError: string | undefined): string {
  if (progressMd === null) {
    const msg = progressError
      ? `error reading progress.md: ${escapeHtml(progressError)}`
      : "no progress.md found";
    return `
      <div class="card-section-label">Progress</div>
      <span class="card-absent">${msg}</span>
    `;
  }

  const SECTIONS = [
    { key: "Current Task", heading: "## Current Task" },
    { key: "Last Session", heading: "## Last Session" },
    { key: "Next Steps", heading: "## Next Steps" },
    { key: "Harness State", heading: "## Harness State" },
  ];

  const parts: string[] = [];

  for (const { key, heading } of SECTIONS) {
    const body = extractSection(progressMd, heading);
    if (body) {
      parts.push(`
        <div class="card-section-label">${escapeHtml(key)}</div>
        <div class="md-content progress-content">${renderMarkdown(body)}</div>
      `);
    } else {
      parts.push(`
        <div class="card-section-label">${escapeHtml(key)}</div>
        <span class="card-absent">&mdash;</span>
      `);
    }
  }

  return parts.join("");
}

/** Build the git log section */
function buildGitLogSection(
  gitLog: DashboardGitLogEntry[] | null,
  notAGitRepo: boolean,
  gitError: string | undefined
): string {
  let inner: string;

  if (notAGitRepo) {
    inner = `<span class="card-absent">not a git repository</span>`;
  } else if (gitLog === null) {
    const msg = gitError
      ? `error running git log: ${escapeHtml(gitError)}`
      : "git log unavailable";
    inner = `<span class="card-absent">${msg}</span>`;
  } else if (gitLog.length === 0) {
    inner = `<span class="card-absent">no commits yet</span>`;
  } else {
    const rows = gitLog
      .map((entry) => `
        <tr>
          <td class="git-log-hash">${escapeHtml(entry.hash)}</td>
          <td class="git-log-msg">${escapeHtml(entry.msg)}</td>
          <td class="git-log-time">${escapeHtml(entry.relTime)}</td>
        </tr>
      `)
      .join("");
    inner = `<table class="git-log-table"><tbody>${rows}</tbody></table>`;
  }

  return `<div class="card-section-label">Recent Commits</div>${inner}`;
}

/**
 * Render a single workspace card.
 * All errors are isolated — one section failing does not prevent others from rendering.
 */
async function renderCard(ws: WorkspaceEntry, isMissing: boolean): Promise<HTMLElement> {
  const card = document.createElement("div");
  card.className = "ws-card" + (isMissing ? " missing" : "");
  card.dataset.id = ws.id;

  // Header
  const header = document.createElement("div");
  header.className = "card-header";
  header.innerHTML = `
    <div class="card-header-info">
      <div class="card-name">${escapeHtml(ws.name)}</div>
      <div class="card-path">${escapeHtml(ws.absolutePath)}</div>
    </div>
    <button class="btn-remove" data-id="${escapeHtml(ws.id)}" title="Remove workspace">&times;</button>
  `;
  card.appendChild(header);

  // Loading placeholder
  const loadingEl = document.createElement("div");
  loadingEl.className = "card-loading";
  loadingEl.textContent = "Loading…";
  card.appendChild(loadingEl);

  // Async load card data
  const api = window.dashboardAPI!;

  try {
    const result = await api.readCardData(ws.absolutePath);

    // Remove loading placeholder
    card.removeChild(loadingEl);

    const body = document.createElement("div");
    body.className = "card-body";

    if ("error" in result) {
      // Top-level IPC error
      body.innerHTML = `
        <div class="card-section">
          <span class="card-absent">Error loading data: ${escapeHtml(result.error)}</span>
        </div>
      `;
    } else {
      // Overview section
      try {
        const overviewSection = document.createElement("div");
        overviewSection.className = "card-section";
        overviewSection.innerHTML = buildOverviewSection(result.claude, result.errors.claude);
        body.appendChild(overviewSection);
      } catch (err) {
        console.error("[dashboard] overview section render error:", err);
        const sec = document.createElement("div");
        sec.className = "card-section";
        sec.innerHTML = `<div class="card-section-label">Overview</div><span class="card-absent">render error</span>`;
        body.appendChild(sec);
      }

      // Progress sections (each sub-section isolated further inside buildProgressSections)
      try {
        const progressSection = document.createElement("div");
        progressSection.className = "card-section";
        progressSection.innerHTML = buildProgressSections(result.progress, result.errors.progress);
        body.appendChild(progressSection);
      } catch (err) {
        console.error("[dashboard] progress section render error:", err);
        const sec = document.createElement("div");
        sec.className = "card-section";
        sec.innerHTML = `<div class="card-section-label">Progress</div><span class="card-absent">render error</span>`;
        body.appendChild(sec);
      }

      // Git log section
      try {
        const gitSection = document.createElement("div");
        gitSection.className = "card-section";
        gitSection.innerHTML = buildGitLogSection(result.gitLog, result.notAGitRepo, result.errors.gitLog);
        body.appendChild(gitSection);
      } catch (err) {
        console.error("[dashboard] git log section render error:", err);
        const sec = document.createElement("div");
        sec.className = "card-section";
        sec.innerHTML = `<div class="card-section-label">Recent Commits</div><span class="card-absent">render error</span>`;
        body.appendChild(sec);
      }
    }

    card.appendChild(body);
  } catch (err) {
    // IPC call itself threw — replace loading with error message
    console.error(`[dashboard] card data IPC error for ${ws.absolutePath}:`, err);
    card.removeChild(loadingEl);
    const errorEl = document.createElement("div");
    errorEl.className = "card-section";
    errorEl.innerHTML = `<span class="card-absent">Failed to load card data.</span>`;
    card.appendChild(errorEl);
  }

  return card;
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
    return;
  }

  emptyState.style.display = "none";

  // Check path existence for all workspaces in parallel
  const api = window.dashboardAPI!;
  const existsResults = await Promise.all(
    workspaces.map((ws) => api.checkPathExists(ws.absolutePath))
  );

  // Render cards in parallel (each card loads its data independently)
  const cardPromises = workspaces.map((ws, i) =>
    renderCard(ws, !existsResults[i]).catch((err) => {
      // Absolute last-resort: if renderCard itself throws, return a minimal error card
      console.error(`[dashboard] fatal renderCard error for ${ws.absolutePath}:`, err);
      const fallback = document.createElement("div");
      fallback.className = "ws-card";
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

  // Attach remove handlers (event delegation on grid)
  grid.querySelectorAll(".btn-remove").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = (btn as HTMLElement).dataset.id ?? "";
      void handleRemove(id);
    });
  });
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
  await renderWorkspaces();
  showDashboardToast("Workspace removed.", "ok");
}

// ---------------------------------------------------------------------------
// Boot (guard: skip in Node.js unit test environment)
// ---------------------------------------------------------------------------

if (typeof window !== "undefined") {
  (async () => {
    workspaces = await window.dashboardAPI!.listWorkspaces();
    await renderWorkspaces();

    const addBtn = document.getElementById("btn-add-workspace") as HTMLButtonElement;
    addBtn.addEventListener("click", () => { void handleAdd(); });
  })();
}
