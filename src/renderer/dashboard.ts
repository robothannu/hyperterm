/// <reference path="./global.d.ts" />
// Dashboard renderer — Sprint 3: Open in main, Rename, Refresh, Empty state, Missing folder UX
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
// Card rendering helpers
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
    const result = await api.readCardData(ws.absolutePath);

    // Remove loading placeholder
    if (loadingEl.parentElement === card) card.removeChild(loadingEl);

    const body = document.createElement("div");
    body.className = "card-body";

    if ("error" in result) {
      body.innerHTML = `
        <div class="card-section">
          <span class="card-absent">Error loading data: ${escapeHtml(result.error)}</span>
        </div>
      `;
    } else {
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

  // Refresh button
  refreshBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    console.log(`[dashboard] refresh: card for ${ws.absolutePath}`);
    // Re-check path existence before reloading
    const exists = await window.dashboardAPI!.checkPathExists(ws.absolutePath);
    const nowMissing = !exists;
    // Update missing CSS class
    if (nowMissing) {
      card.classList.add("missing");
    } else {
      card.classList.remove("missing");
    }
    // Rebuild header (updates Open button disabled state)
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
  await renderWorkspaces();
  showDashboardToast("Workspace removed.", "ok");
}

async function handleRefreshAll(): Promise<void> {
  console.log("[dashboard] refresh all cards");
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
