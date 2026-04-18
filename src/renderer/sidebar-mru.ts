/// <reference path="./global.d.ts" />
/// <reference path="./pane-types.d.ts" />

// --- Sidebar MRU (Most Recently Used Projects) — Sprint 6 ---
// Tracks recently visited git roots and renders them in the sidebar.

const MRU_MAX = 10;

let mruProjects: string[] = [];
let mruSectionCollapsed = false;

// ---------------------------------------------------------------------------
// MRU data management
// ---------------------------------------------------------------------------

async function loadMruProjects(): Promise<void> {
  try {
    const settings = await window.terminalAPI.getSettings();
    mruProjects = settings.recentProjects ?? [];
  } catch {
    mruProjects = [];
  }
}

async function saveMruProjects(): Promise<void> {
  try {
    const settings = await window.terminalAPI.getSettings();
    await window.terminalAPI.saveSettings({ ...settings, recentProjects: mruProjects });
  } catch {
    console.error("[sidebar-mru] Failed to save MRU");
  }
}

/**
 * Add a project root to the MRU list.
 * Deduplicates and promotes to top; trims to MRU_MAX.
 */
async function addMruProject(projectRoot: string): Promise<void> {
  if (!projectRoot) return;

  // Dedup: remove if already present
  const idx = mruProjects.indexOf(projectRoot);
  if (idx !== -1) {
    if (idx === 0) return; // already at top, nothing to do
    mruProjects.splice(idx, 1);
  }

  // Prepend
  mruProjects.unshift(projectRoot);

  // Trim
  if (mruProjects.length > MRU_MAX) {
    mruProjects = mruProjects.slice(0, MRU_MAX);
  }

  await saveMruProjects();
  renderMruSection();
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function getMruContainer(): HTMLElement | null {
  return document.getElementById("sidebar-mru-section");
}

function renderMruSection(): void {
  const container = getMruContainer();
  if (!container) return;

  const list = container.querySelector(".mru-list") as HTMLElement | null;
  if (!list) return;

  list.innerHTML = "";

  if (mruProjects.length === 0) {
    const empty = document.createElement("li");
    empty.className = "mru-empty";
    empty.textContent = "최근 프로젝트 없음";
    list.appendChild(empty);
    return;
  }

  for (const projectPath of mruProjects) {
    const li = document.createElement("li");
    li.className = "mru-entry";
    li.title = projectPath;

    // Basename for display
    const parts = projectPath.replace(/\\/g, "/").split("/");
    const displayName = parts[parts.length - 1] || projectPath;

    li.innerHTML = `<span class="mru-icon">&#8962;</span><span class="mru-path">${escapeHtml(displayName)}</span>`;

    li.addEventListener("click", () => {
      onMruEntryClick(projectPath);
    });

    list.appendChild(li);
  }
}

async function onMruEntryClick(projectPath: string): Promise<void> {
  const label = nextTerminalName();
  try {
    await createNewTab(label, projectPath);
  } catch {
    console.log("[sidebar-mru] Failed to open MRU project:", projectPath);
    await createNewTab(label);
  }
}

// ---------------------------------------------------------------------------
// DOM structure
// ---------------------------------------------------------------------------

function createMruSectionDOM(): void {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;

  // Avoid duplicates
  if (document.getElementById("sidebar-mru-section")) return;

  const section = document.createElement("div");
  section.id = "sidebar-mru-section";
  section.className = "sidebar-mru-section";

  section.innerHTML = `
    <div class="mru-header" id="mru-header">
      <span class="mru-title">Recent Projects</span>
      <span class="mru-toggle" id="mru-toggle">&#9660;</span>
    </div>
    <ul class="mru-list" id="mru-list"></ul>
  `;

  sidebar.appendChild(section);

  // Collapse toggle
  const header = section.querySelector("#mru-header");
  const list = section.querySelector(".mru-list") as HTMLElement | null;
  const toggleIcon = section.querySelector("#mru-toggle");

  header?.addEventListener("click", () => {
    mruSectionCollapsed = !mruSectionCollapsed;
    if (list) list.style.display = mruSectionCollapsed ? "none" : "";
    if (toggleIcon) toggleIcon.innerHTML = mruSectionCollapsed ? "&#9654;" : "&#9660;";
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function initSidebarMru(): Promise<void> {
  await loadMruProjects();
  createMruSectionDOM();
  renderMruSection();
}
