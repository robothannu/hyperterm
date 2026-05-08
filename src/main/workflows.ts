import * as fs from "fs";
import * as path from "path";

// Workflow = saved command snippet, optionally bound to a cwd.
// Surfaced via Command Palette; running it opens (or reuses) a tab in `cwd`
// (or the current focused pane's cwd) and writes the command followed by Enter.
export interface Workflow {
  id: string;
  label: string;
  command: string;
  cwd?: string;
  createdAt: string;
}

type WorkflowsFile = {
  version: number;
  workflows: Workflow[];
};

let workflowsFilePath = "";

export function initWorkflows(userDataPath: string): void {
  workflowsFilePath = path.join(userDataPath, "workflows.json");
}

// Test-only helper: lets unit tests bypass initWorkflows() and target a temp path.
export function _setWorkflowsPathForTesting(p: string): void {
  workflowsFilePath = p;
}

export function loadWorkflows(): Workflow[] {
  if (!workflowsFilePath) {
    console.error("[workflows] initWorkflows() not called before loadWorkflows()");
    return [];
  }
  try {
    if (!fs.existsSync(workflowsFilePath)) return [];
    const raw = fs.readFileSync(workflowsFilePath, "utf8");
    const parsed = JSON.parse(raw) as WorkflowsFile;
    if (!Array.isArray(parsed.workflows)) {
      console.error("[workflows] load: unexpected format, returning []");
      return [];
    }
    return parsed.workflows.filter(_isValidWorkflow);
  } catch (err) {
    console.error("[workflows] load: parse error, returning []:", err);
    return [];
  }
}

export function saveWorkflows(workflows: Workflow[]): void {
  if (!workflowsFilePath) {
    console.error("[workflows] initWorkflows() not called before saveWorkflows()");
    return;
  }
  const file: WorkflowsFile = { version: 1, workflows };
  try {
    fs.writeFileSync(workflowsFilePath, JSON.stringify(file, null, 2), "utf8");
  } catch (err) {
    console.error("[workflows] save: failed to write file:", err);
  }
}

function _isValidWorkflow(w: unknown): w is Workflow {
  if (!w || typeof w !== "object") return false;
  const o = w as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.label === "string" &&
    typeof o.command === "string" &&
    typeof o.createdAt === "string" &&
    (o.cwd === undefined || typeof o.cwd === "string")
  );
}

function _genId(): string {
  // Time + small entropy. Workflows are user-driven and low-frequency; collisions vanishingly unlikely.
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `wf-${t}-${r}`;
}

// Pure validation + creation. Returns the new workflow or an error.
export function makeWorkflow(input: { label: string; command: string; cwd?: string }):
  | { ok: true; workflow: Workflow }
  | { ok: false; error: string } {
  const label = (input.label || "").trim();
  const command = (input.command || "").trim();
  if (label.length === 0) return { ok: false, error: "label_empty" };
  if (label.length > 80) return { ok: false, error: "label_too_long" };
  if (command.length === 0) return { ok: false, error: "command_empty" };
  if (command.length > 4000) return { ok: false, error: "command_too_long" };
  let cwd: string | undefined;
  if (input.cwd !== undefined) {
    const c = String(input.cwd).trim();
    if (c.length === 0) {
      cwd = undefined;
    } else if (!path.isAbsolute(c)) {
      return { ok: false, error: "cwd_must_be_absolute" };
    } else {
      cwd = c;
    }
  }
  return {
    ok: true,
    workflow: {
      id: _genId(),
      label,
      command,
      cwd,
      createdAt: new Date().toISOString(),
    },
  };
}

// Add a workflow; dedup by exact (label, command, cwd) triple.
// Returns { workflows, duplicate } similar to addWorkspace.
export function addWorkflow(
  existing: Workflow[],
  workflow: Workflow
): { workflows: Workflow[]; duplicate: boolean } {
  const isDup = existing.some(
    (w) =>
      w.label === workflow.label &&
      w.command === workflow.command &&
      (w.cwd || "") === (workflow.cwd || "")
  );
  if (isDup) return { workflows: existing, duplicate: true };
  return { workflows: [...existing, workflow], duplicate: false };
}

export function removeWorkflow(existing: Workflow[], id: string): Workflow[] {
  return existing.filter((w) => w.id !== id);
}

export function findWorkflow(existing: Workflow[], id: string): Workflow | undefined {
  return existing.find((w) => w.id === id);
}
