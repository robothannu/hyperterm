import * as fs from "fs";
import * as path from "path";

export interface Workspace {
  id: string;
  name: string;
  absolutePath: string;
  addedAt: string;
  // Optional fields added in Sprint 2 — always present after migration
  archived?: boolean;
  iconColor?: string;
  tags?: string[];
}

type WorkspacesFile = {
  version: number;
  workspaces: Workspace[];
};

/**
 * Idempotent migration: add optional Sprint 2 fields to existing workspaces.
 * Only adds missing fields — never modifies existing keys.
 */
function migrateWorkspaces(workspaces: Workspace[]): { workspaces: Workspace[]; changed: boolean } {
  let changed = false;
  const migrated = workspaces.map((ws) => {
    let updated = ws;
    if (ws.archived === undefined) {
      updated = { ...updated, archived: false };
      changed = true;
    }
    if (ws.iconColor === undefined) {
      updated = { ...updated, iconColor: "" };
      changed = true;
    }
    if (ws.tags === undefined) {
      updated = { ...updated, tags: [] };
      changed = true;
    }
    return updated;
  });
  return { workspaces: migrated, changed };
}

let workspacesFilePath = "";

/**
 * Must be called once at app startup before any other function.
 * Kept separate so we can override in tests.
 */
export function initWorkspaces(userDataPath: string): void {
  workspacesFilePath = path.join(userDataPath, "workspaces.json");
}

/** Load workspaces from disk. Falls back to [] on missing/corrupt file. */
export function loadWorkspaces(): Workspace[] {
  if (!workspacesFilePath) {
    console.error("[workspaces] initWorkspaces() was not called before loadWorkspaces()");
    return [];
  }
  try {
    if (!fs.existsSync(workspacesFilePath)) {
      console.log("[workspaces] load: file does not exist yet, returning empty list");
      return [];
    }
    const raw = fs.readFileSync(workspacesFilePath, "utf8");
    const parsed = JSON.parse(raw) as WorkspacesFile;
    if (!Array.isArray(parsed.workspaces)) {
      console.error("[workspaces] load: unexpected format, falling back to []");
      return [];
    }
    console.log(`[workspaces] load: loaded ${parsed.workspaces.length} workspace(s) from ${workspacesFilePath}`);
    // Run idempotent migration to add Sprint 2 optional fields
    const { workspaces: migrated, changed } = migrateWorkspaces(parsed.workspaces);
    if (changed) {
      console.log("[workspaces] load: migration applied — writing updated workspaces.json");
      saveWorkspaces(migrated);
    }
    return migrated;
  } catch (err) {
    console.error("[workspaces] load: JSON parse error (corrupt file), falling back to []:", err);
    return [];
  }
}

/** Persist workspaces to disk. */
export function saveWorkspaces(workspaces: Workspace[]): void {
  if (!workspacesFilePath) {
    console.error("[workspaces] initWorkspaces() was not called before saveWorkspaces()");
    return;
  }
  const file: WorkspacesFile = { version: 1, workspaces };
  try {
    fs.writeFileSync(workspacesFilePath, JSON.stringify(file, null, 2), "utf8");
    console.log(`[workspaces] save: persisted ${workspaces.length} workspace(s) to ${workspacesFilePath}`);
  } catch (err) {
    console.error("[workspaces] save: failed to write file:", err);
  }
}

/** Normalize a path for dedup comparison: resolve to absolute, remove trailing slash. */
function normalizePath(p: string): string {
  // path.resolve makes it absolute and removes trailing slashes
  return path.resolve(p);
}

/** Add a workspace. Returns the new list, or null if the path is a duplicate. */
export function addWorkspace(
  existing: Workspace[],
  absolutePath: string
): { workspaces: Workspace[]; duplicate: boolean } {
  const normalized = normalizePath(absolutePath);

  const isDuplicate = existing.some(
    (w) => normalizePath(w.absolutePath) === normalized
  );

  if (isDuplicate) {
    console.log(`[workspaces] add: duplicate path ignored: ${normalized}`);
    return { workspaces: existing, duplicate: true };
  }

  const name = path.basename(normalized) || normalized; // fallback for root "/"
  const newEntry: Workspace = {
    id: `ws-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    absolutePath: normalized,
    addedAt: new Date().toISOString(),
  };

  const updated = [...existing, newEntry];
  saveWorkspaces(updated);
  console.log(`[workspaces] add: added "${name}" at ${normalized}`);
  return { workspaces: updated, duplicate: false };
}

/** Remove a workspace by id. Returns updated list. */
export function removeWorkspace(
  existing: Workspace[],
  id: string
): Workspace[] {
  const removed = existing.find((w) => w.id === id);
  if (removed) {
    console.log(`[workspaces] remove: removed "${removed.name}" (${removed.absolutePath})`);
  }
  const updated = existing.filter((w) => w.id !== id);
  saveWorkspaces(updated);
  return updated;
}

/**
 * Toggle archived status for a workspace by id.
 * Returns updated list, or null if id not found.
 */
export function archiveToggleWorkspace(
  existing: Workspace[],
  id: string,
  archived: boolean
): Workspace[] | null {
  const index = existing.findIndex((w) => w.id === id);
  if (index === -1) {
    console.warn(`[workspaces] archiveToggle: id not found: ${id}`);
    return null;
  }
  const updated = existing.map((w, i) =>
    i === index ? { ...w, archived } : w
  );
  saveWorkspaces(updated);
  console.log(`[workspaces] archiveToggle: id=${id} archived=${archived}`);
  return updated;
}

/**
 * Rename a workspace by id. Returns updated list, or null if id not found.
 * Path is never changed by this function — only the display name.
 */
export function renameWorkspace(
  existing: Workspace[],
  id: string,
  newName: string
): Workspace[] | null {
  const trimmed = newName.trim();
  if (!trimmed) {
    console.warn(`[workspaces] rename: empty name ignored for id=${id}`);
    return null;
  }

  const index = existing.findIndex((w) => w.id === id);
  if (index === -1) {
    console.warn(`[workspaces] rename: id not found: ${id}`);
    return null;
  }

  const updated = existing.map((w, i) =>
    i === index ? { ...w, name: trimmed } : w
  );
  saveWorkspaces(updated);
  console.log(`[workspaces] rename: renamed id=${id} to "${trimmed}"`);
  return updated;
}
