import * as path from "path";

export const ACTIVE_HARNESS_PHASES = new Set(["building", "evaluating", "running"]);

export function isActiveHarnessPhase(phase: string | null | undefined): boolean {
  return typeof phase === "string" && ACTIVE_HARNESS_PHASES.has(phase);
}

export function isPathInsideWorkspace(candidatePath: string, workspacePath: string): boolean {
  const normalizedCandidate = path.resolve(candidatePath);
  const normalizedWorkspace = path.resolve(workspacePath);
  if (normalizedCandidate === normalizedWorkspace) return true;
  const relative = path.relative(normalizedWorkspace, normalizedCandidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function isWorkspaceOpenFromCwds(openCwds: Iterable<string>, workspacePath: string): boolean {
  for (const cwd of openCwds) {
    if (isPathInsideWorkspace(cwd, workspacePath)) return true;
  }
  return false;
}
