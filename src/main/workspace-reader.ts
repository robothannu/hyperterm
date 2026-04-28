/**
 * workspace-reader.ts — Sprint 2
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
