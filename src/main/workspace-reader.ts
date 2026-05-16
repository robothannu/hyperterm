/**
 * workspace-reader.ts — Sprint 2 + Sprint 4 (card revamp)
 * Reads Claude/Codex project files and git log for a workspace path.
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

const CLAUDE_SIDE_FILES = ["CLAUDE.md", "progress.md"] as const;
const CODEX_SIDE_FILES = [
  "AGENT.md",
  ".codex/HANDOFF.md",
  "HANDOFF.md",
  "codex-handoff.md",
  "handoff.md",
] as const;

function latestExistingMtime(workspacePath: string, relPaths: readonly string[]): number | null {
  let latest: number | null = null;
  for (const relPath of relPaths) {
    const mtime = fileMtimeMs(path.join(workspacePath, relPath));
    if (mtime !== null && (latest === null || mtime > latest)) {
      latest = mtime;
    }
  }
  return latest;
}

function readFirstExistingFile(
  workspacePath: string,
  relPaths: readonly string[],
  logLabel: string
): { content: string | null; error?: string } {
  for (const relPath of relPaths) {
    const absPath = path.join(workspacePath, relPath);
    if (!fs.existsSync(absPath)) {
      continue;
    }
    try {
      const content = fs.readFileSync(absPath, "utf8");
      console.log(`[workspace-reader] ${logLabel} read OK (${content.length} chars) from ${absPath}`);
      return { content };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[workspace-reader] ${logLabel} read error at ${absPath}: ${msg}`);
      return { content: null, error: msg };
    }
  }

  console.log(
    `[workspace-reader] ${logLabel} not found at ${relPaths.map((relPath) => path.join(workspacePath, relPath)).join(", ")}`
  );
  return { content: null, error: "not_found" };
}

function readNewestExistingFile(
  workspacePath: string,
  relPaths: readonly string[],
  logLabel: string
): { content: string | null; error?: string } {
  let newest: { relPath: string; mtimeMs: number } | null = null;

  for (const relPath of relPaths) {
    const absPath = path.join(workspacePath, relPath);
    const mtimeMs = fileMtimeMs(absPath);
    if (mtimeMs === null) {
      continue;
    }
    if (newest === null || mtimeMs > newest.mtimeMs) {
      newest = { relPath, mtimeMs };
    }
  }

  if (!newest) {
    console.log(
      `[workspace-reader] ${logLabel} not found at ${relPaths.map((relPath) => path.join(workspacePath, relPath)).join(", ")}`
    );
    return { content: null, error: "not_found" };
  }

  const absPath = path.join(workspacePath, newest.relPath);
  try {
    const content = fs.readFileSync(absPath, "utf8");
    console.log(
      `[workspace-reader] ${logLabel} read OK (${content.length} chars) from ${absPath} (mtime=${new Date(newest.mtimeMs).toISOString()})`
    );
    return { content };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[workspace-reader] ${logLabel} read error at ${absPath}: ${msg}`);
    return { content: null, error: msg };
  }
}

/**
 * Detect which AI tool is newer in this workspace.
 * If only one side exists, choose it. If both exist, choose the side with
 * the most recently modified project file.
 */
export function detectTool(workspacePath: string): WorkspaceTool {
  const claudeMtime = latestExistingMtime(workspacePath, CLAUDE_SIDE_FILES);
  const codexMtime = latestExistingMtime(workspacePath, CODEX_SIDE_FILES);
  const hasClaude = claudeMtime !== null;
  const hasCodex = codexMtime !== null;

  if (hasClaude && !hasCodex) return "claude";
  if (hasCodex && !hasClaude) return "codex";
  if (!hasClaude && !hasCodex) return "none";
  if ((claudeMtime ?? 0) >= (codexMtime ?? 0)) return "claude";
  return "codex";
}

/**
 * Read CLAUDE.md from the workspace root.
 * Returns raw markdown string, or null + error message on failure.
 */
function readClaudeMd(workspacePath: string): { content: string | null; error?: string } {
  console.log(`[workspace-reader] reading Claude files in ${workspacePath}`);
  return readFirstExistingFile(workspacePath, ["CLAUDE.md"], "Claude project file");
}

/**
 * Read AGENT.md from the workspace root (OpenAI Codex CLI convention).
 * Returns raw markdown string, or null + error message on failure.
 * Parsing strategy: same as CLAUDE.md (first paragraph after H1 / ## Overview section).
 */
function readAgentsMd(workspacePath: string): { content: string | null; error?: string } {
  console.log(`[workspace-reader] reading Codex agent files in ${workspacePath}`);
  return readFirstExistingFile(workspacePath, ["AGENT.md"], "Codex agent file");
}

/**
 * Read .codex/HANDOFF.md / codex-handoff.md / HANDOFF.md / handoff.md from the workspace root.
 * Returns raw markdown string, or null + error message on failure.
 */
function readCodexHandoffMd(workspacePath: string): { content: string | null; error?: string } {
  console.log(`[workspace-reader] reading Codex handoff files in ${workspacePath}`);
  return readNewestExistingFile(
    workspacePath,
    [".codex/HANDOFF.md", "codex-handoff.md", "HANDOFF.md", "handoff.md"],
    "Codex handoff file"
  );
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

function fileMtimeMs(filePath: string): number | null {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() ? stat.mtimeMs : null;
  } catch {
    return null;
  }
}

function toIsoOrNull(mtimeMs: number | null): string | null {
  if (mtimeMs === null || !Number.isFinite(mtimeMs)) return null;
  return new Date(mtimeMs).toISOString();
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

export type WorkspaceTool = "claude" | "codex" | "mixed" | "none";
export type WorkspacePrimaryTool = "claude" | "codex";

export interface ToolProjectState {
  objective: string | null;
  goal: string | null;
  currentTask: string | null;
  nextSteps: string[];
  updatedAt: string | null;
}

export interface OverviewSummary {
  objective: string | null;
  goal: string | null;
  currentTask: string | null;
  nextSteps: string[];
  git: OverviewGit;
  tool: WorkspaceTool;
  primaryTool: WorkspacePrimaryTool | null;
  claudeState: ToolProjectState | null;
  codexState: ToolProjectState | null;
  errors: { claude?: string; agent?: string; progress?: string; handoff?: string; git?: string };
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
 * Returns the text content of the section up to the next same-or-higher-level heading.
 * Supports prefix matching: "## Last Session" also matches "## Last Session (2026-04-28)".
 */
function extractMdSection(md: string, heading: string): string | null {
  // Determine the heading level from the search heading
  const levelMatch = heading.match(/^(#+)\s/);
  const level = levelMatch ? levelMatch[1].length : 2;
  // Strip the hashes to get the heading text
  const headingText = heading.replace(/^#+\s+/, "").trim();
  const escapedText = headingText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Match "## HeadingText" or "## HeadingText <anything>" (prefix match)
  // Use [^\S\r\n] (non-newline whitespace) so \s doesn't consume newlines in multiline mode
  const pattern = new RegExp(
    `^#{${level}}[^\\S\\r\\n]+${escapedText}(?:[^\\S\\r\\n]+.*)?$`,
    "im"
  );
  const match = pattern.exec(md);
  if (!match) return null;

  const start = match.index + match[0].length;
  const rest = md.slice(start);
  // Stop at the next heading at the same or higher level (fewer # signs)
  const stopPattern = new RegExp(`^#{1,${level}}\\s`, "m");
  const nextHeading = stopPattern.exec(rest);
  const section = nextHeading ? rest.slice(0, nextHeading.index) : rest;
  return section.trim() || null;
}

/**
 * Extract the first paragraph after the first H1 heading.
 * Skips blank lines, returns null if the next non-blank content is a heading.
 * Trims to 200 chars.
 */
function extractFirstParagraphAfterH1(md: string): string | null {
  const lines = md.split("\n");
  let foundH1 = false;
  const paragraphLines: string[] = [];

  for (const line of lines) {
    if (!foundH1) {
      if (/^#\s/.test(line)) {
        foundH1 = true;
      }
      continue;
    }

    // After H1: skip blank lines until we hit content
    if (paragraphLines.length === 0 && line.trim() === "") {
      continue;
    }

    // If first content is a heading, return null
    if (paragraphLines.length === 0 && /^#+\s/.test(line)) {
      return null;
    }

    // Collect paragraph lines until blank line or heading
    if (line.trim() === "" || /^#+\s/.test(line)) {
      break;
    }

    paragraphLines.push(line.trim());
  }

  const text = paragraphLines.join(" ").trim();
  if (!text) return null;
  return text.slice(0, 200);
}

/**
 * Strip markdown emphasis/inline-code/heading-prefix and return first sentence
 * (cut at . / 。 / ! / ? / newline). Bounded to maxLen chars.
 */
function firstSentenceClean(src: string, maxLen = 140): string | null {
  if (!src) return null;
  // drop markdown heading lines (### Foo) entirely; keep body lines
  const cleaned = src
    .split("\n")
    .filter((l) => !/^#+\s/.test(l))
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join(" ")
    // strip bold/italic/inline code markers
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
  if (!cleaned) return null;
  // sentence boundary
  const m = cleaned.match(/^[\s\S]*?[.。!?](?:\s|$)/);
  let sentence = m ? m[0].trim() : cleaned;
  if (sentence.length > maxLen) sentence = sentence.slice(0, maxLen).trim() + "…";
  return sentence || null;
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

  const workspaceRoot = workspacePath as string;

  console.log(`[workspace-reader] summarizeOverview start: ${workspacePath}`);

  // Detect which AI tool(s) are configured in this workspace
  const tool = detectTool(workspacePath);

  const errors: OverviewSummary["errors"] = {};
  let objective: string | null = null;
  let goal: string | null = null;
  let currentTask: string | null = null;
  let nextSteps: string[] = [];
  const git: OverviewGit = {
    branch: null,
    commitsLast7d: null,
    dirty: null,
    notAGitRepo: false,
  };

  // 1. Agent config file → goal (CLAUDE.md → AGENT.md → fallback chain)
  // Helper: extract goal from any markdown agent config (shared parsing logic)
  function extractGoalFromMd(content: string): { goal: string | null; objective: string | null } {
    let goalSection: string | null = null;
    let fallbackUsed = "none";

    goalSection = extractMdSection(content, "## Overview");
    if (goalSection) { fallbackUsed = "## Overview"; }

    if (!goalSection) {
      goalSection = extractMdSection(content, "## Project Overview");
      if (goalSection) { fallbackUsed = "## Project Overview"; }
    }

    if (!goalSection) {
      goalSection = extractMdSection(content, "## Project Background");
      if (goalSection) { fallbackUsed = "## Project Background"; }
    }

    if (!goalSection) {
      goalSection = extractMdSection(content, "## Project Intent");
      if (goalSection) { fallbackUsed = "## Project Intent"; }
    }

    if (!goalSection) {
      goalSection = extractFirstParagraphAfterH1(content);
      if (goalSection) { fallbackUsed = "first-paragraph-after-h1"; }
    }

    let extractedGoal: string | null = null;
    let extractedObjective: string | null = null;

    if (goalSection) {
      extractedGoal = goalSection.slice(0, 200).trim() || null;
      if (fallbackUsed !== "none") {
        console.log(`[workspace-reader] summarizeOverview: goal fallback="${fallbackUsed}" for ${workspacePath}`);
      }
    }

    // Objective: explicit ## Objective / ## Goal / ## 목적, else first sentence of goal
    const objectiveSection: string | null =
      extractMdSection(content, "## Objective") ??
      extractMdSection(content, "## Goal") ??
      extractMdSection(content, "## 목적");
    if (objectiveSection) {
      extractedObjective = firstSentenceClean(objectiveSection, 140);
    } else if (extractedGoal) {
      extractedObjective = firstSentenceClean(extractedGoal, 140);
    }

    return { goal: extractedGoal, objective: extractedObjective };
  }

  function extractTaskFromContent(content: string): { currentTask: string | null; nextSteps: string[] } {
    let taskSection: string | null = null;
    let taskFallback = "none";

    taskSection = extractMdSection(content, "## Current Task");
    if (taskSection) { taskFallback = "## Current Task"; }

    if (!taskSection) {
      taskSection = extractMdSection(content, "## Current Status");
      if (taskSection) { taskFallback = "## Current Status"; }
    }

    if (!taskSection) {
      taskSection = extractMdSection(content, "## Status");
      if (taskSection) { taskFallback = "## Status"; }
    }

    if (!taskSection) {
      taskSection = extractMdSection(content, "## Current");
      if (taskSection) { taskFallback = "## Current"; }
    }

    let extractedTask: string | null = null;
    if (taskSection) {
      const firstLine = taskSection.split("\n").find((l) => l.trim().length > 0);
      if (firstLine) {
        extractedTask = firstLine.replace(/^\s*[-*]\s+(?:\[[ xX]\]\s+)?/, "").trim() || null;
      }
      if (taskFallback !== "## Current Task") {
        console.log(`[workspace-reader] summarizeOverview: currentTask fallback="${taskFallback}" for ${workspacePath}`);
      }
    }

    const nextSection =
      extractMdSection(content, "## Next Steps") ??
      extractMdSection(content, "## Next");
    const extractedNextSteps = nextSection ? parseBulletItems(nextSection, 3) : [];

    return { currentTask: extractedTask, nextSteps: extractedNextSteps };
  }

  function summarizeToolState(
    configResult: { content: string | null; error?: string },
    stateResult: { content: string | null; error?: string },
    configPaths: readonly string[],
    statePaths: readonly string[],
  ): { state: ToolProjectState | null; error?: string } {
    const goalSource = configResult.content || stateResult.content;
    const taskSource = stateResult.content || configResult.content;
    const goalExtract = goalSource ? extractGoalFromMd(goalSource) : { goal: null, objective: null };
    const taskExtract = taskSource ? extractTaskFromContent(taskSource) : { currentTask: null, nextSteps: [] as string[] };
    const updatedAt = Math.max(
      ...configPaths.map((relPath) => fileMtimeMs(path.join(workspaceRoot, relPath)) ?? 0),
      ...statePaths.map((relPath) => fileMtimeMs(path.join(workspaceRoot, relPath)) ?? 0),
    );

    const hasAnyContent = !!(configResult.content || stateResult.content);
    if (!hasAnyContent) {
      const err = configResult.error && configResult.error !== "not_found"
        ? configResult.error
        : stateResult.error && stateResult.error !== "not_found"
          ? stateResult.error
          : undefined;
      return { state: null, error: err };
    }

    return {
      state: {
        objective: goalExtract.objective,
        goal: goalExtract.goal,
        currentTask: taskExtract.currentTask,
        nextSteps: taskExtract.nextSteps,
        updatedAt: toIsoOrNull(updatedAt > 0 ? updatedAt : null),
      },
    };
  }

  let claudeState: ToolProjectState | null = null;
  let codexState: ToolProjectState | null = null;
  let primaryTool: WorkspacePrimaryTool | null = null;
  let primaryObjective: string | null = null;
  let primaryGoal: string | null = null;
  let primaryCurrentTask: string | null = null;
  let primaryNextSteps: string[] = [];

  try {
    const claudeConfig = readClaudeMd(workspacePath);
    const claudeProgress = readProgressMd(workspacePath);
    const claudeSummary = summarizeToolState(
      claudeConfig,
      claudeProgress,
      ["CLAUDE.md"],
      ["progress.md"]
    );
    claudeState = claudeSummary.state;
    if (claudeSummary.error) {
      errors.claude = claudeSummary.error;
    }

    const agentsConfig = readAgentsMd(workspacePath);
    const handoffState = readCodexHandoffMd(workspacePath);
    const codexSummary = summarizeToolState(
      agentsConfig,
      handoffState,
      ["AGENT.md"],
      [".codex/HANDOFF.md", "codex-handoff.md", "HANDOFF.md", "handoff.md"]
    );
    codexState = codexSummary.state;
    if (codexSummary.error) {
      errors.agent = codexSummary.error;
    }

    const claudeUpdated = claudeState?.updatedAt ? Date.parse(claudeState.updatedAt) : null;
    const codexUpdated = codexState?.updatedAt ? Date.parse(codexState.updatedAt) : null;

    if (claudeUpdated !== null || codexUpdated !== null) {
      if (claudeUpdated !== null && (codexUpdated === null || claudeUpdated >= codexUpdated)) {
        primaryTool = "claude";
        primaryObjective = claudeState?.objective ?? null;
        primaryGoal = claudeState?.goal ?? null;
        primaryCurrentTask = claudeState?.currentTask ?? null;
        primaryNextSteps = claudeState?.nextSteps ?? [];
      } else if (codexUpdated !== null) {
        primaryTool = "codex";
        primaryObjective = codexState?.objective ?? null;
        primaryGoal = codexState?.goal ?? null;
        primaryCurrentTask = codexState?.currentTask ?? null;
        primaryNextSteps = codexState?.nextSteps ?? [];
      }
    } else {
      // If neither side has timestamps, still prefer whichever side has content.
      if (claudeState) {
        primaryTool = "claude";
        primaryObjective = claudeState.objective;
        primaryGoal = claudeState.goal;
        primaryCurrentTask = claudeState.currentTask;
        primaryNextSteps = claudeState.nextSteps;
      } else if (codexState) {
        primaryTool = "codex";
        primaryObjective = codexState.objective;
        primaryGoal = codexState.goal;
        primaryCurrentTask = codexState.currentTask;
        primaryNextSteps = codexState.nextSteps;
      }
    }

    if (!primaryTool) {
      // Fall back to the configured tool order if timestamps are absent.
      if (tool === "claude") primaryTool = "claude";
      else if (tool === "codex") primaryTool = "codex";
      else if (tool === "mixed" || tool === "none") primaryTool = claudeState ? "claude" : codexState ? "codex" : null;
    }

    if (primaryTool === "claude" && claudeState) {
      primaryObjective = claudeState.objective;
      primaryGoal = claudeState.goal;
      primaryCurrentTask = claudeState.currentTask;
      primaryNextSteps = claudeState.nextSteps;
    } else if (primaryTool === "codex" && codexState) {
      primaryObjective = codexState.objective;
      primaryGoal = codexState.goal;
      primaryCurrentTask = codexState.currentTask;
      primaryNextSteps = codexState.nextSteps;
    } else if (!primaryTool && claudeState) {
      primaryTool = "claude";
      primaryObjective = claudeState.objective;
      primaryGoal = claudeState.goal;
      primaryCurrentTask = claudeState.currentTask;
      primaryNextSteps = claudeState.nextSteps;
    } else if (!primaryTool && codexState) {
      primaryTool = "codex";
      primaryObjective = codexState.objective;
      primaryGoal = codexState.goal;
      primaryCurrentTask = codexState.currentTask;
      primaryNextSteps = codexState.nextSteps;
    }
  } catch (e) {
    errors.claude = e instanceof Error ? e.message : String(e);
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

  // 4. Compute public fields from the primary tool state.
  objective = primaryObjective;
  goal = primaryGoal;
  currentTask = primaryCurrentTask;
  nextSteps = primaryNextSteps;

  console.log(`[workspace-reader] summarizeOverview done: ${workspacePath}, tool=${tool}, primary=${primaryTool ?? "none"}`);
  return {
    objective,
    goal,
    currentTask,
    nextSteps,
    git,
    tool,
    primaryTool,
    claudeState,
    codexState,
    errors,
  };
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
