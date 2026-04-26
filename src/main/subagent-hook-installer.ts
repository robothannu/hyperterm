/**
 * subagent-hook-installer.ts
 *
 * Sprint 1: 이벤트 파이프라인 (hook → jsonl)
 *
 * Responsibilities:
 *  - ensureSubagentHookScript(): writes ~/.config/hyperterm/subagent-hook.sh (mode 0755)
 *  - installSubagentHooks(): registers PreToolUse(Task) + SubagentStop in ~/.claude/settings.json
 *  - ensureSubagentStateDir(): mkdir -p ~/.claude/state/hyperterm/
 *
 * Hard constraints:
 *  - NEVER touches hook.sh, installClaudeHooks(), or startHookServer()
 *  - hook script MUST produce zero stdout (AC1.4)
 *  - HYPERTERM_PTY_ID absent → silent exit 0 (AC1.6)
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const hookScriptDir = path.join(os.homedir(), ".config", "hyperterm");
const subagentHookScriptPath = path.join(hookScriptDir, "subagent-hook.sh");
const claudeSettingsPath = path.join(os.homedir(), ".claude", "settings.json");
const subagentStateDirPath = path.join(os.homedir(), ".claude", "state", "hyperterm");

// ---------------------------------------------------------------------------
// ensureSubagentStateDir
// ---------------------------------------------------------------------------

/**
 * Creates ~/.claude/state/hyperterm/ if it doesn't exist.
 */
export function ensureSubagentStateDir(): void {
  try {
    fs.mkdirSync(subagentStateDirPath, { recursive: true });
  } catch (err) {
    console.error("[subagent-hook-installer] Failed to create state dir:", err);
  }
}

// ---------------------------------------------------------------------------
// ensureSubagentHookScript
// ---------------------------------------------------------------------------

/**
 * Writes ~/.config/hyperterm/subagent-hook.sh with mode 0755.
 *
 * The script:
 *  - Exits 0 silently if HYPERTERM_PTY_ID is unset (AC1.6)
 *  - Produces ZERO stdout (AC1.4) — all output goes to stderr or the jsonl file
 *  - Uses /usr/bin/python3 (Apple-signed, avoids macOS Gatekeeper dialogs)
 *  - Appends a single JSON line per event to ~/.claude/state/hyperterm/<pty_id>.jsonl
 *
 * Schema: {"ts": <epoch ms>, "event": "start|stop",
 *          "agent_type": "...", "task_description": "...", "claude_session_id": "..."}
 */
export function ensureSubagentHookScript(): void {
  try {
    fs.mkdirSync(hookScriptDir, { recursive: true });

    // The script body. Python3 handles all JSON parsing and file writing.
    // stdout is intentionally never written (AC1.4).
    // PreToolUse fires for ALL tools — only "Task" tool_name is recorded (AC1.3/AC1.5).
    const script = `#!/bin/bash
# Claude Code subagent hook → ~/.claude/state/hyperterm/<pty_id>.jsonl
# HyperTerm Sprint 1: event pipeline (hook → jsonl)
#
# Rules:
#  - Zero stdout (AC1.4): all output goes to stderr or the jsonl file
#  - No HYPERTERM_PTY_ID → silent exit 0 (AC1.6)
#  - PreToolUse: only records "Task" tool (AC1.3)
#  - SubagentStop: always records stop event

PTY_ID="\${HYPERTERM_PTY_ID:-}"
if [ -z "\$PTY_ID" ]; then
  exit 0
fi

PAYLOAD=$(cat)
STATE_DIR="\$HOME/.claude/state/hyperterm"
JSONL_FILE="\$STATE_DIR/\$PTY_ID.jsonl"

mkdir -p "\$STATE_DIR" 2>/dev/null || true

echo "\$PAYLOAD" | /usr/bin/python3 -c '
import sys, json, os, time

pty_id = os.environ.get("HYPERTERM_PTY_ID", "")
state_dir = os.path.join(os.path.expanduser("~"), ".claude", "state", "hyperterm")
jsonl_file = os.path.join(state_dir, pty_id + ".jsonl")

try:
    raw = sys.stdin.read()
    d = json.loads(raw)
except Exception as e:
    print("[subagent-hook] JSON parse error: " + str(e), file=sys.stderr)
    sys.exit(0)

hook_event = d.get("hook_event_name", "")
tool_name = d.get("tool_name", "")
tool_input = d.get("tool_input", {}) or {}
session_id = d.get("session_id", "")

record = None

if hook_event == "PreToolUse" and tool_name == "Task":
    record = {
        "ts": int(time.time() * 1000),
        "event": "start",
        "agent_type": tool_input.get("subagent_type", ""),
        "task_description": tool_input.get("description", ""),
        "claude_session_id": session_id,
    }
elif hook_event == "SubagentStop":
    record = {
        "ts": int(time.time() * 1000),
        "event": "stop",
        "claude_session_id": session_id,
    }

if record is not None:
    try:
        os.makedirs(state_dir, exist_ok=True)
        with open(jsonl_file, "a", encoding="utf-8") as f:
            f.write(json.dumps(record) + "\\n")
    except Exception as e:
        print("[subagent-hook] Write error: " + str(e), file=sys.stderr)

# stdout intentionally empty
' 2>/dev/null || true
`;

    // Always overwrite to keep subagent-hook.sh up-to-date
    fs.writeFileSync(subagentHookScriptPath, script, { mode: 0o755, encoding: "utf8" });
  } catch (err) {
    console.error("[subagent-hook-installer] Failed to write subagent-hook.sh:", err);
  }
}

// ---------------------------------------------------------------------------
// installSubagentHooks
// ---------------------------------------------------------------------------

/**
 * Registers two hook entries in ~/.claude/settings.json:
 *  - hooks.PreToolUse: { matcher: "Task", hooks: [{ type: "command", command: subagentHookScriptPath }] }
 *  - hooks.SubagentStop: { matcher: "", hooks: [{ type: "command", command: subagentHookScriptPath }] }
 *
 * Existing entries are preserved. Duplicate commands are skipped.
 */
export function installSubagentHooks(): void {
  try {
    ensureSubagentHookScript();
    ensureSubagentStateDir();

    const claudeDir = path.join(os.homedir(), ".claude");
    try { fs.mkdirSync(claudeDir, { recursive: true }); } catch { /* already exists */ }

    // Read existing settings.json (or start fresh)
    let existing: Record<string, unknown> = {};
    try {
      if (fs.existsSync(claudeSettingsPath)) {
        existing = JSON.parse(fs.readFileSync(claudeSettingsPath, "utf8"));
      }
    } catch {
      existing = {};
    }

    const hooks = (existing.hooks as Record<string, unknown[]> | undefined) || {};

    // Helper: ensure the hook entry is registered, skip if already present
    function registerHook(
      eventName: string,
      matcher: string,
    ): void {
      if (!Array.isArray(hooks[eventName])) {
        hooks[eventName] = [];
      }
      const arr = hooks[eventName] as Array<{
        matcher: string;
        hooks: Array<{ type: string; command: string }>;
      }>;

      // Skip if this exact command is already registered for this event
      const alreadyPresent = arr.some(
        (e) =>
          Array.isArray(e.hooks) &&
          e.hooks.some((h) => h.command === subagentHookScriptPath),
      );
      if (!alreadyPresent) {
        arr.push({
          matcher,
          hooks: [{ type: "command", command: subagentHookScriptPath }],
        });
      }
    }

    registerHook("PreToolUse", "Task");
    registerHook("SubagentStop", "");

    existing.hooks = hooks;
    fs.writeFileSync(claudeSettingsPath, JSON.stringify(existing, null, 2), "utf8");
  } catch (err) {
    console.error("[subagent-hook-installer] Failed to install subagent hooks:", err);
  }
}
