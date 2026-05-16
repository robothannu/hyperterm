/// <reference path="./global.d.ts" />
/// <reference path="./pane-types.d.ts" />

// --- Sidebar MRU (Most Recently Used Projects) — Sprint 6 ---
// Tracks recently visited git roots for command palette use.
// The visible sidebar section was removed; MRU data remains available to the
// command palette and other non-visual consumers.

const MRU_MAX = 10;

let mruProjects: string[] = [];

// ---------------------------------------------------------------------------
// MRU data management
// ---------------------------------------------------------------------------

// Read-only snapshot for cross-script consumers (Command Palette).
function getMruProjects(): string[] {
  return [...mruProjects];
}

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
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function renderMruSection(): void {
  // Intentionally disabled. MRU is retained for palette/history use only.
}

async function onMruEntryClick(projectPath: string): Promise<void> {
  // Validate path existence before opening
  try {
    const exists = await window.terminalAPI.checkPathExists(projectPath);
    if (!exists) {
      showToast(`경로를 찾을 수 없습니다: ${projectPath}`, "error");
      await removeMruProject(projectPath);
      return;
    }
  } catch {
    // If check fails, proceed anyway (don't block the user)
  }

  const label = nextTerminalName();
  try {
    await createNewTab(label, projectPath);
  } catch {
    console.log("[sidebar-mru] Failed to open MRU project:", projectPath);
    await createNewTab(label);
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Path validation helpers
// ---------------------------------------------------------------------------

/**
 * Remove a path from the MRU list and persist.
 * Called when a path is found to not exist on disk.
 */
async function removeMruProject(projectPath: string): Promise<void> {
  const idx = mruProjects.indexOf(projectPath);
  if (idx === -1) return;
  mruProjects.splice(idx, 1);
  await saveMruProjects();
}

/**
 * On app load: check each saved MRU path for existence.
 * Stale (non-existent) paths are silently removed.
 */
async function validateMruProjects(): Promise<void> {
  if (!window.terminalAPI.checkPathExists) return;
  const results = await Promise.all(
    mruProjects.map((p) => window.terminalAPI.checkPathExists(p).catch(() => false))
  );
  // Filter out stale paths (iterate in reverse to preserve indices)
  const stale: string[] = [];
  for (let i = 0; i < mruProjects.length; i++) {
    if (!results[i]) stale.push(mruProjects[i]);
  }
  if (stale.length === 0) return;
  mruProjects = mruProjects.filter((p) => !stale.includes(p));
  await saveMruProjects();
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function initSidebarMru(): Promise<void> {
  await loadMruProjects();
  // Validate paths on startup — remove stale entries silently.
  await validateMruProjects();
}
