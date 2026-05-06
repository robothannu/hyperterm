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
 * Detect which AI tool(s) are configured in this workspace.
 * Checks for CLAUDE.md (Claude Code) and AGENTS.md (OpenAI Codex CLI).
 */
export function detectTool(workspacePath: string): WorkspaceTool {
  const hasClaude = fs.existsSync(path.join(workspacePath, "CLAUDE.md"));
  const hasAgents = fs.existsSync(path.join(workspacePath, "AGENTS.md"));
  if (hasClaude && hasAgents) return "mixed";
  if (hasClaude) return "claude";
  if (hasAgents) return "codex";
  return "none";
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
 * Read AGENTS.md from the workspace root (OpenAI Codex CLI convention).
 * Returns raw markdown string, or null + error message on failure.
 * Parsing strategy: same as CLAUDE.md (first paragraph after H1 / ## Overview section).
 */
function readAgentsMd(workspacePath: string): { content: string | null; error?: string } {
  const filePath = path.join(workspacePath, "AGENTS.md");
  console.log(`[workspace-reader] reading AGENTS.md at ${filePath}`);
  try {
    if (!fs.existsSync(filePath)) {
      console.log(`[workspace-reader] AGENTS.md not found at ${filePath}`);
      return { content: null, error: "not_found" };
    }
    const content = fs.readFileSync(filePath, "utf8");
    console.log(`[workspace-reader] AGENTS.md read OK (${content.length} chars)`);
    return { content };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[workspace-reader] AGENTS.md read error: ${msg}`);
    return { content: null, error: msg };
  }
}

/**
 * Read handoff.md from the workspace root (Codex project state convention).
 * Returns raw markdown string, or null + error message on failure.
 */
function readHandoffMd(workspacePath: string): { content: string | null; error?: string } {
  const filePath = path.join(workspacePath, "handoff.md");
  console.log(`[workspace-reader] reading handoff.md at ${filePath}`);
  try {
    if (!fs.existsSync(filePath)) {
      console.log(`[workspace-reader] handoff.md not found at ${filePath}`);
      return { content: null, error: "not_found" };
    }
    const content = fs.readFileSync(filePath, "utf8");
    console.log(`[workspace-reader] handoff.md read OK (${content.length} chars)`);
    return { content };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[workspace-reader] handoff.md read error: ${msg}`);
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

export type WorkspaceTool = "claude" | "codex" | "mixed" | "none";

export interface OverviewSummary {
  objective: string | null;
  goal: string | null;
  currentTask: string | null;
  nextSteps: string[];
  git: OverviewGit;
  tool: WorkspaceTool;
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

  // 1. Agent config file → goal (CLAUDE.md → AGENTS.md → fallback chain)
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

  try {
    // Try CLAUDE.md first (for claude/mixed/none tools)
    const claudeResult = readClaudeMd(workspacePath);
    if (claudeResult.content) {
      const extracted = extractGoalFromMd(claudeResult.content);
      goal = extracted.goal;
      objective = extracted.objective;
    } else if (claudeResult.error && claudeResult.error !== "not_found") {
      errors.claude = claudeResult.error;
    }

    // If no goal from CLAUDE.md, try AGENTS.md (for codex/mixed/none tools)
    if (!goal) {
      const agentsResult = readAgentsMd(workspacePath);
      if (agentsResult.content) {
        const extracted = extractGoalFromMd(agentsResult.content);
        goal = extracted.goal;
        objective = extracted.objective;
      }
      // AGENTS.md not_found is normal for non-codex projects; only log real errors
    }
  } catch (e) {
    errors.claude = e instanceof Error ? e.message : String(e);
  }

  // 2. State file → currentTask + nextSteps
  // Priority by tool: claude/mixed → progress.md; codex → handoff.md; none → try both
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

    const nextSection = extractMdSection(content, "## Next Steps");
    const extractedNextSteps = nextSection ? parseBulletItems(nextSection, 3) : [];

    return { currentTask: extractedTask, nextSteps: extractedNextSteps };
  }

  try {
    // Determine which state file(s) to read based on tool detection
    const tryProgress = tool === "claude" || tool === "mixed" || tool === "none";
    const tryHandoff = tool === "codex" || tool === "mixed" || tool === "none";

    let stateContent: string | null = null;
    let stateError: string | undefined;

    if (tryProgress) {
      const progressResult = readProgressMd(workspacePath);
      if (progressResult.content) {
        stateContent = progressResult.content;
      } else if (progressResult.error && progressResult.error !== "not_found") {
        stateError = progressResult.error;
      }
    }

    // For codex/mixed/none: try handoff.md if no content yet (or as primary for codex)
    if (!stateContent && tryHandoff) {
      const handoffResult = readHandoffMd(workspacePath);
      if (handoffResult.content) {
        stateContent = handoffResult.content;
      } else if (handoffResult.error && handoffResult.error !== "not_found") {
        stateError = stateError ?? handoffResult.error;
      }
    }

    if (stateContent) {
      const extracted = extractTaskFromContent(stateContent);
      currentTask = extracted.currentTask;
      nextSteps = extracted.nextSteps;
    } else if (stateError) {
      errors.progress = stateError;
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

  console.log(`[workspace-reader] summarizeOverview done: ${workspacePath}, tool=${tool}`);
  return { objective, goal, currentTask, nextSteps, git, tool, errors };
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
