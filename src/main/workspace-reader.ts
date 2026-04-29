/**
 * workspace-reader.ts — Sprint 2 + Sprint 4 (card revamp)
 * Reads CLAUDE.md, progress.md, and git log for a workspace path.
 * All errors are isolated per-field; callers should treat null as "unavailable".
 */

import * as fs from "fs";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface GitLogEntry {
  hash: string;
  msg: string;
  relTime: string;
}

export interface CardDataErrors {
  claude?: string;
  progress?: string;
  gitLog?: string;
}

export interface CardData {
  claude: string | null;
  progress: string | null;
  gitLog: GitLogEntry[] | null;
  notAGitRepo: boolean;
  errors: CardDataErrors;
}

/**
 * Read CLAUDE.md from the workspace root.
 * Returns raw markdown string, or null + error message on failure.
 */
function readClaudeMd(workspacePath: string): { content: string | null; error?: string } {
  const filePath = path.join(workspacePath, "CLAUDE.md");
  console.log(`[workspace-reader] reading CLAUDE.md at ${filePath}`);
  try {
    if (!fs.existsSync(filePath)) {
      console.log(`[workspace-reader] CLAUDE.md not found at ${filePath}`);
      return { content: null, error: "not_found" };
    }
    const content = fs.readFileSync(filePath, "utf8");
    console.log(`[workspace-reader] CLAUDE.md read OK (${content.length} chars)`);
    return { content };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[workspace-reader] CLAUDE.md read error: ${msg}`);
    return { content: null, error: msg };
  }
}

/**
 * Read progress.md from the workspace root.
 * Returns raw markdown string, or null + error message on failure.
 */
function readProgressMd(workspacePath: string): { content: string | null; error?: string } {
  const filePath = path.join(workspacePath, "progress.md");
  console.log(`[workspace-reader] reading progress.md at ${filePath}`);
  try {
    if (!fs.existsSync(filePath)) {
      console.log(`[workspace-reader] progress.md not found at ${filePath}`);
      return { content: null, error: "not_found" };
    }
    const content = fs.readFileSync(filePath, "utf8");
    console.log(`[workspace-reader] progress.md read OK (${content.length} chars)`);
    return { content };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[workspace-reader] progress.md read error: ${msg}`);
    return { content: null, error: msg };
  }
}

/**
 * Run git log for the workspace. Returns last 5 entries.
 * Returns null with notAGitRepo=true if not a git repo.
 */
async function readGitLog(workspacePath: string): Promise<{
  entries: GitLogEntry[] | null;
  notAGitRepo: boolean;
  error?: string;
}> {
  console.log(`[workspace-reader] running git log at ${workspacePath}`);
  try {
    // Use pipe-safe delimiter to avoid issues with special chars in messages
    const { stdout } = await execFileAsync(
      "git",
      ["-C", workspacePath, "log", "-5", "--pretty=format:%h%x1F%s%x1F%cr"],
      { encoding: "utf8", timeout: 8000 }
    );

    const lines = stdout.trim().split("\n").filter((l) => l.length > 0);
    if (lines.length === 0) {
      // Repo exists but no commits yet
      console.log(`[workspace-reader] git log: empty repo at ${workspacePath}`);
      return { entries: [], notAGitRepo: false };
    }

    const entries: GitLogEntry[] = lines.map((line) => {
      const parts = line.split("\x1F");
      return {
        hash: parts[0]?.trim() ?? "",
        msg: parts[1]?.trim() ?? "",
        relTime: parts[2]?.trim() ?? "",
      };
    });

    console.log(`[workspace-reader] git log: ${entries.length} entries at ${workspacePath}`);
    return { entries, notAGitRepo: false };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // git exits with 128 when not a git repo
    const isNotRepo =
      msg.includes("not a git repository") ||
      (err as { code?: number }).code === 128 ||
      msg.includes("128");

    if (isNotRepo) {
      console.log(`[workspace-reader] git log: not a git repo at ${workspacePath}`);
      return { entries: null, notAGitRepo: true };
    }

    console.error(`[workspace-reader] git log error at ${workspacePath}: ${msg}`);
    return { entries: null, notAGitRepo: false, error: msg };
  }
}

/**
 * Validate that workspacePath is an absolute path (basic input check).
 */
function isValidPath(p: unknown): p is string {
  return typeof p === "string" && p.startsWith("/") && p.length > 1;
}

// ============================================================
// Sprint 4 — Overview Summary, Status Info, File Tree
// ============================================================

// --- Shared types ---

export interface OverviewGit {
  branch: string | null;
  commitsLast7d: number | null;
  dirty: boolean | null;
  notAGitRepo: boolean;
}

export interface OverviewSummary {
  goal: string | null;
  currentTask: string | null;
  nextSteps: string[];
  git: OverviewGit;
  errors: { claude?: string; progress?: string; git?: string };
}

export interface StatusInfo {
  notAGitRepo: boolean;
  branch: string | null;
  dirty: boolean | null;
  staged: number | null;
  unstaged: number | null;
  untracked: number | null;
  ahead: number | null;
  behind: number | null;
  remoteUrl: string | null;
  lastCommitRelTime: string | null;
  error?: string;
}

export interface FileTreeNode {
  name: string;
  path: string; // workspace-relative
  type: "file" | "dir";
  children?: FileTreeNode[];
}

export interface FileTreeResult {
  tree: FileTreeNode[] | null;
  error?: string;
}

// --- Helpers ---

/**
 * Extract the first occurrence of a markdown section (## Heading).
 * Returns the text content of the section up to the next ## heading.
 */
function extractMdSection(md: string, heading: string): string | null {
  // Match "## Heading" lines (case-insensitive, leading whitespace tolerant)
  const pattern = new RegExp(
    `^#{1,6}\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`,
    "im"
  );
  const match = pattern.exec(md);
  if (!match) return null;

  const start = match.index + match[0].length;
  const rest = md.slice(start);
  // Find the next heading at same or higher level
  const nextHeading = /^#{1,6}\s/m.exec(rest);
  const section = nextHeading ? rest.slice(0, nextHeading.index) : rest;
  return section.trim() || null;
}

/**
 * Parse bullet list items from a markdown section string.
 * Returns up to `limit` items with leading - / * / [ ] / [x] stripped.
 */
function parseBulletItems(section: string, limit: number): string[] {
  const lines = section.split("\n");
  const items: string[] = [];
  for (const line of lines) {
    const m = /^\s*[-*]\s+(?:\[[ xX]\]\s+)?(.+)$/.exec(line);
    if (m && m[1]) {
      items.push(m[1].trim());
      if (items.length >= limit) break;
    }
  }
  return items;
}

// --- Dirs excluded from file tree (gitignore-common + well-known heavy dirs) ---
const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "release",
  ".venv",
  "__pycache__",
  ".next",
  "build",
  ".cache",
  ".turbo",
  "coverage",
  ".nyc_output",
  "out",
  ".expo",
]);

/**
 * Load .gitignore patterns from the repo root (simple exact-dir match only).
 * Returns a Set of directory names to exclude (supplement to EXCLUDED_DIRS).
 */
function loadGitignoreDirs(workspacePath: string): Set<string> {
  const extra = new Set<string>();
  try {
    const gi = path.join(workspacePath, ".gitignore");
    if (!fs.existsSync(gi)) return extra;
    const lines = fs.readFileSync(gi, "utf8").split("\n");
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      // Simple patterns: "dirname/" or "dirname" (no globs)
      const name = line.endsWith("/") ? line.slice(0, -1) : line;
      if (/^[A-Za-z0-9_.@-]+$/.test(name)) {
        extra.add(name);
      }
    }
  } catch {
    // ignore
  }
  return extra;
}

/**
 * Walk file system up to `depth` levels, excluding known heavy dirs.
 * For git repos, also uses .gitignore dir patterns.
 */
function walkDir(
  absPath: string,
  relPath: string,
  excludeDirs: Set<string>,
  depth: number
): FileTreeNode[] {
  if (depth <= 0) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const nodes: FileTreeNode[] = [];
  for (const entry of entries) {
    const name = entry.name;
    const entryRelPath = relPath ? `${relPath}/${name}` : name;

    if (entry.isDirectory()) {
      if (excludeDirs.has(name)) continue;
      const children = walkDir(
        path.join(absPath, name),
        entryRelPath,
        excludeDirs,
        depth - 1
      );
      nodes.push({ name, path: entryRelPath, type: "dir", children });
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      nodes.push({ name, path: entryRelPath, type: "file" });
    }
  }

  // Sort: dirs first, then files, alphabetically within each group
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return nodes;
}

// --- Exported Sprint 4 functions ---

/**
 * Build a heuristic overview summary for the given workspace.
 * Returns structured data; each field is independently nullable on failure.
 */
export async function summarizeOverview(
  workspacePath: unknown
): Promise<OverviewSummary | { error: string }> {
  if (!isValidPath(workspacePath)) {
    return { error: "invalid_path" };
  }
  if (!fs.existsSync(workspacePath)) {
    return { error: "path_not_found" };
  }
  if (!fs.statSync(workspacePath).isDirectory()) {
    return { error: "not_a_directory" };
  }

  console.log(`[workspace-reader] summarizeOverview start: ${workspacePath}`);

  const errors: OverviewSummary["errors"] = {};
  let goal: string | null = null;
  let currentTask: string | null = null;
  let nextSteps: string[] = [];
  const git: OverviewGit = {
    branch: null,
    commitsLast7d: null,
    dirty: null,
    notAGitRepo: false,
  };

  // 1. CLAUDE.md → goal
  try {
    const { content, error } = readClaudeMd(workspacePath);
    if (content) {
      const overviewSection = extractMdSection(content, "Overview");
      if (overviewSection) {
        // Take first 200 chars of the section text
        goal = overviewSection.slice(0, 200).trim() || null;
      }
    } else if (error && error !== "not_found") {
      errors.claude = error;
    }
  } catch (e) {
    errors.claude = e instanceof Error ? e.message : String(e);
  }

  // 2. progress.md → currentTask + nextSteps
  try {
    const { content, error } = readProgressMd(workspacePath);
    if (content) {
      const taskSection = extractMdSection(content, "Current Task");
      if (taskSection) {
        // First non-empty line
        const firstLine = taskSection.split("\n").find((l) => l.trim().length > 0);
        if (firstLine) {
          // Strip leading - * bullet
          currentTask = firstLine.replace(/^\s*[-*]\s+(?:\[[ xX]\]\s+)?/, "").trim() || null;
        }
      }
      const nextSection = extractMdSection(content, "Next Steps");
      if (nextSection) {
        nextSteps = parseBulletItems(nextSection, 3);
      }
    } else if (error && error !== "not_found") {
      errors.progress = error;
    }
  } catch (e) {
    errors.progress = e instanceof Error ? e.message : String(e);
  }

  // 3. git info
  try {
    // branch
    const branchResult = await execFileAsync(
      "git",
      ["-C", workspacePath, "rev-parse", "--abbrev-ref", "HEAD"],
      { encoding: "utf8", timeout: 8000 }
    ).catch((e: unknown) => ({ error: e }));

    if ("stdout" in branchResult) {
      git.branch = branchResult.stdout.trim() || null;
    } else {
      const msg = branchResult.error instanceof Error
        ? branchResult.error.message
        : String(branchResult.error);
      if (msg.includes("not a git repository") || msg.includes("128")) {
        git.notAGitRepo = true;
      } else {
        errors.git = msg;
      }
    }

    if (!git.notAGitRepo) {
      // commits last 7 days
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];
      const logResult = await execFileAsync(
        "git",
        ["-C", workspacePath, "log", `--since=${since}`, "--oneline"],
        { encoding: "utf8", timeout: 8000 }
      ).catch(() => ({ stdout: "" }));
      const lines = ("stdout" in logResult ? logResult.stdout : "")
        .trim()
        .split("\n")
        .filter((l: string) => l.length > 0);
      git.commitsLast7d = lines.length;

      // dirty check
      const statusResult = await execFileAsync(
        "git",
        ["-C", workspacePath, "status", "--porcelain"],
        { encoding: "utf8", timeout: 8000 }
      ).catch(() => ({ stdout: "" }));
      const porcelain = ("stdout" in statusResult ? statusResult.stdout : "").trim();
      git.dirty = porcelain.length > 0;
    }
  } catch (e) {
    errors.git = e instanceof Error ? e.message : String(e);
  }

  console.log(`[workspace-reader] summarizeOverview done: ${workspacePath}`);
  return { goal, currentTask, nextSteps, git, errors };
}

/**
 * Collect detailed git status info for a workspace.
 * Returns StatusInfo with notAGitRepo flag if not a git repo — never throws.
 */
export async function getStatusInfo(
  workspacePath: unknown
): Promise<StatusInfo | { error: string }> {
  if (!isValidPath(workspacePath)) {
    return { error: "invalid_path" };
  }
  if (!fs.existsSync(workspacePath)) {
    return { error: "path_not_found" };
  }
  if (!fs.statSync(workspacePath).isDirectory()) {
    return { error: "not_a_directory" };
  }

  console.log(`[workspace-reader] getStatusInfo start: ${workspacePath}`);

  const result: StatusInfo = {
    notAGitRepo: false,
    branch: null,
    dirty: null,
    staged: null,
    unstaged: null,
    untracked: null,
    ahead: null,
    behind: null,
    remoteUrl: null,
    lastCommitRelTime: null,
  };

  try {
    // Branch
    const branchOut = await execFileAsync(
      "git",
      ["-C", workspacePath, "rev-parse", "--abbrev-ref", "HEAD"],
      { encoding: "utf8", timeout: 8000 }
    ).catch((e: unknown) => ({ error: e, stdout: "" }));

    if ("error" in branchOut && branchOut.error) {
      const msg = branchOut.error instanceof Error
        ? branchOut.error.message
        : String(branchOut.error);
      if (msg.includes("not a git repository") || msg.includes("128")) {
        result.notAGitRepo = true;
        console.log(`[workspace-reader] getStatusInfo: not a git repo at ${workspacePath}`);
        return result;
      }
      result.error = msg;
      return result;
    }

    result.branch = branchOut.stdout.trim() || null;

    // Porcelain v1: staged/unstaged/untracked counts
    const porcelainOut = await execFileAsync(
      "git",
      ["-C", workspacePath, "status", "--porcelain"],
      { encoding: "utf8", timeout: 8000 }
    ).catch(() => ({ stdout: "" }));
    const porcelain = porcelainOut.stdout.trim();

    let staged = 0;
    let unstaged = 0;
    let untracked = 0;
    if (porcelain) {
      for (const line of porcelain.split("\n")) {
        if (!line) continue;
        const x = line[0];
        const y = line[1];
        if (x === "?") {
          untracked++;
        } else {
          if (x && x !== " " && x !== "?") staged++;
          if (y && y !== " " && y !== "?") unstaged++;
        }
      }
    }
    result.dirty = porcelain.length > 0;
    result.staged = staged;
    result.unstaged = unstaged;
    result.untracked = untracked;

    // Ahead / behind via rev-list
    try {
      const trackingOut = await execFileAsync(
        "git",
        ["-C", workspacePath, "rev-list", "--left-right", "--count", "@{u}...HEAD"],
        { encoding: "utf8", timeout: 8000 }
      );
      const parts = trackingOut.stdout.trim().split(/\s+/);
      result.behind = parseInt(parts[0] ?? "0", 10) || 0;
      result.ahead = parseInt(parts[1] ?? "0", 10) || 0;
    } catch {
      // No upstream tracking branch — leave null
    }

    // Remote URL
    try {
      const remoteOut = await execFileAsync(
        "git",
        ["-C", workspacePath, "remote", "get-url", "origin"],
        { encoding: "utf8", timeout: 8000 }
      );
      result.remoteUrl = remoteOut.stdout.trim() || null;
    } catch {
      // No origin remote — leave null
    }

    // Last commit relative time
    try {
      const logOut = await execFileAsync(
        "git",
        ["-C", workspacePath, "log", "-1", "--pretty=format:%cr"],
        { encoding: "utf8", timeout: 8000 }
      );
      result.lastCommitRelTime = logOut.stdout.trim() || null;
    } catch {
      // No commits yet
    }
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
  }

  console.log(`[workspace-reader] getStatusInfo done: ${workspacePath}`);
  return result;
}

/**
 * Build a file tree for a workspace path.
 * Excludes .gitignore-listed dirs and known heavy dirs.
 * Falls back to fs walk when not a git repo.
 * Max depth: 4 levels to keep response size reasonable.
 */
export async function getFileTree(
  workspacePath: unknown
): Promise<FileTreeResult> {
  if (!isValidPath(workspacePath)) {
    return { tree: null, error: "invalid_path" };
  }
  if (!fs.existsSync(workspacePath)) {
    return { tree: null, error: "path_not_found" };
  }
  if (!fs.statSync(workspacePath).isDirectory()) {
    return { tree: null, error: "not_a_directory" };
  }

  console.log(`[workspace-reader] getFileTree start: ${workspacePath}`);

  try {
    // Combine static excludes + .gitignore dirs
    const giDirs = loadGitignoreDirs(workspacePath);
    const excludeDirs = new Set([...EXCLUDED_DIRS, ...giDirs]);

    const tree = walkDir(workspacePath, "", excludeDirs, 4);
    console.log(
      `[workspace-reader] getFileTree done: ${workspacePath}, top-level nodes: ${tree.length}`
    );
    return { tree };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[workspace-reader] getFileTree error: ${msg}`);
    return { tree: null, error: msg };
  }
}

// ============================================================
// Original Sprint 2 entry point (unchanged)
// ============================================================

/**
 * Main entry point: load all card data for a workspace.
 * Each field is isolated — one failure does not block others.
 */
export async function getCardData(workspacePath: unknown): Promise<CardData | { error: string }> {
  if (!isValidPath(workspacePath)) {
    return { error: "invalid_path" };
  }

  console.log(`[workspace-reader] getCardData for: ${workspacePath}`);

  // Run all reads in parallel, each isolated
  const [claudeResult, progressResult, gitResult] = await Promise.all([
    Promise.resolve(readClaudeMd(workspacePath)),
    Promise.resolve(readProgressMd(workspacePath)),
    readGitLog(workspacePath),
  ]);

  const errors: CardDataErrors = {};
  if (claudeResult.error && claudeResult.error !== "not_found") {
    errors.claude = claudeResult.error;
  }
  if (progressResult.error && progressResult.error !== "not_found") {
    errors.progress = progressResult.error;
  }
  if (gitResult.error) {
    errors.gitLog = gitResult.error;
  }

  return {
    claude: claudeResult.content,
    progress: progressResult.content,
    gitLog: gitResult.entries,
    notAGitRepo: gitResult.notAGitRepo,
    errors,
  };
}
