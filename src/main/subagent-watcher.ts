/**
 * subagent-watcher.ts
 *
 * Sprint 2: Watcher + IPC broadcast
 *
 * Responsibilities:
 *  - Watch ~/.claude/state/hyperterm/ for new/changed jsonl files
 *  - Parse start/stop events per PTY (filename = ptyId)
 *  - Maintain per-PTY active subagent count (simple counter: start +1, stop -1, floor 0)
 *  - Broadcast { ptyId, activeCount, agents } to renderer via IPC on every change
 *  - On boot: read all existing jsonl files to compute initial state (AC2.5)
 *  - Per-file offset: reset to 0 when file is deleted/rotated (AC2.6)
 *
 * Hard constraints:
 *  - Does NOT modify hook.sh / installClaudeHooks() / startHookServer()
 *  - IPC channel: "subagent:status" (new, no collision with "hook:event")
 *  - snapshot channel: "subagent:snapshot" (handled in main.ts via ipcMain.handle)
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { BrowserWindow } from "electron";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SubagentAgent {
  agent_type?: string;
  task_description?: string;
  started_at: number;
}

export interface SubagentStatusPayload {
  ptyId: string;
  activeCount: number;
  agents: SubagentAgent[];
}

interface JsonlRecord {
  ts: number;
  event: "start" | "stop";
  agent_type?: string;
  task_description?: string;
  claude_session_id?: string;
}

interface PtyState {
  activeCount: number;
  agents: SubagentAgent[];   // FIFO queue of active agents
  fileOffset: number;        // bytes read so far
  watcher: fs.FSWatcher | null;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const STATE_DIR = path.join(os.homedir(), ".claude", "state", "hyperterm");

// Map from ptyId (string) → per-PTY state
const ptyStates = new Map<string, PtyState>();

// Directory watcher handle
let dirWatcher: fs.FSWatcher | null = null;

// Callback to get the current BrowserWindow for broadcast
let getWindow: (() => BrowserWindow | null) | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract ptyId from filename, e.g. "42.jsonl" → "42" */
function ptyIdFromFilename(filename: string): string | null {
  if (!filename.endsWith(".jsonl")) return null;
  const base = path.basename(filename, ".jsonl");
  // Allow any non-empty string as pty id (numeric or otherwise)
  return base.length > 0 ? base : null;
}

/** Broadcast current state for a ptyId to renderer */
function broadcast(ptyId: string): void {
  const win = getWindow?.();
  if (!win || win.isDestroyed()) return;

  const state = ptyStates.get(ptyId);
  const payload: SubagentStatusPayload = {
    ptyId,
    activeCount: state ? Math.max(0, state.activeCount) : 0,
    agents: state ? [...state.agents] : [],
  };

  win.webContents.send("subagent:status", payload);
}

/** Initialize state entry for a ptyId if not already present */
function ensurePtyState(ptyId: string): PtyState {
  let state = ptyStates.get(ptyId);
  if (!state) {
    state = {
      activeCount: 0,
      agents: [],
      fileOffset: 0,
      watcher: null,
    };
    ptyStates.set(ptyId, state);
  }
  return state;
}

/**
 * Process new bytes from a jsonl file starting at state.fileOffset.
 * Updates state in place. Returns true if any records were processed.
 */
function processNewLines(ptyId: string, filePath: string): boolean {
  const state = ptyStates.get(ptyId);
  if (!state) return false;

  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    // File disappeared — reset offset
    state.fileOffset = 0;
    return false;
  }

  const fileSize = stat.size;

  // File shrank (rotation/rm + recreate): reset offset
  if (fileSize < state.fileOffset) {
    console.log(`[subagent-watcher] File rotated for pty ${ptyId}, resetting offset`);
    state.fileOffset = 0;
    state.activeCount = 0;
    state.agents = [];
  }

  if (fileSize === state.fileOffset) return false; // no new data

  // Read only new bytes
  let fd: number;
  try {
    fd = fs.openSync(filePath, "r");
  } catch {
    return false;
  }

  const bytesToRead = fileSize - state.fileOffset;
  const buf = Buffer.alloc(bytesToRead);
  let bytesRead = 0;
  try {
    bytesRead = fs.readSync(fd, buf, 0, bytesToRead, state.fileOffset);
  } finally {
    fs.closeSync(fd);
  }

  if (bytesRead === 0) return false;

  state.fileOffset += bytesRead;

  const chunk = buf.slice(0, bytesRead).toString("utf8");
  const lines = chunk.split("\n");

  let changed = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let record: JsonlRecord;
    try {
      record = JSON.parse(trimmed);
    } catch {
      continue; // skip malformed lines
    }
    applyRecord(ptyId, record);
    changed = true;
  }

  return changed;
}

/** Apply a single parsed record to state */
function applyRecord(ptyId: string, record: JsonlRecord): void {
  const state = ptyStates.get(ptyId);
  if (!state) return;

  if (record.event === "start") {
    const agent: SubagentAgent = {
      started_at: record.ts,
    };
    if (record.agent_type) agent.agent_type = record.agent_type;
    if (record.task_description) agent.task_description = record.task_description;

    state.agents.push(agent);
    state.activeCount = Math.max(0, state.activeCount) + 1;

  } else if (record.event === "stop") {
    // Simple counter: -1, remove oldest (FIFO)
    state.activeCount = Math.max(0, state.activeCount - 1);
    if (state.agents.length > 0) {
      state.agents.shift(); // FIFO: remove oldest active agent
    }
  }
}

/** Do a full read of a jsonl file from scratch (used during boot for AC2.5) */
function fullReadFile(ptyId: string, filePath: string): void {
  const state = ensurePtyState(ptyId);
  // Reset to start
  state.fileOffset = 0;
  state.activeCount = 0;
  state.agents = [];
  processNewLines(ptyId, filePath);
}

/**
 * Watch a single jsonl file for changes.
 * If the watcher already exists for this ptyId, does nothing.
 * AC2.6: on file deletion, offset is reset next time we try to read.
 */
function watchFile(ptyId: string, filePath: string): void {
  const state = ptyStates.get(ptyId);
  if (!state) return;
  if (state.watcher) return; // already watching

  try {
    const watcher = fs.watch(filePath, { persistent: true }, (eventType) => {
      if (eventType === "rename") {
        // File may have been deleted/rotated
        const exists = fs.existsSync(filePath);
        if (!exists) {
          // File deleted — close watcher, reset state
          state.watcher?.close();
          state.watcher = null;
          state.fileOffset = 0;
          state.activeCount = 0;
          state.agents = [];
          // Broadcast count 0
          broadcast(ptyId);
          return;
        }
        // File recreated (same name) — treat as rotation: processNewLines handles offset reset
      }
      // eventType === "change" or "rename" with file existing
      const changed = processNewLines(ptyId, filePath);
      if (changed) {
        broadcast(ptyId);
      }
    });

    watcher.on("error", (err) => {
      console.error(`[subagent-watcher] File watcher error for pty ${ptyId}:`, err);
      state.watcher?.close();
      state.watcher = null;
    });

    state.watcher = watcher;
  } catch (err) {
    console.error(`[subagent-watcher] Failed to watch file for pty ${ptyId}:`, err);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start the subagent watcher.
 *
 * - Ensures STATE_DIR exists.
 * - Reads all existing jsonl files on boot (AC2.5).
 * - Watches STATE_DIR for new files.
 * - Broadcasts initial state after boot read.
 *
 * @param windowFactory  Returns the current BrowserWindow (may be null at call time)
 */
export function startSubagentWatcher(
  windowFactory: () => BrowserWindow | null
): void {
  getWindow = windowFactory;

  // Ensure state directory exists (AC2.1)
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  } catch (err) {
    console.error("[subagent-watcher] Failed to create state dir:", err);
  }

  console.log(`[subagent-watcher] Starting. Watching: ${STATE_DIR}`);

  // --- Boot: read all existing jsonl files (AC2.5) ---
  try {
    const entries = fs.readdirSync(STATE_DIR);
    for (const entry of entries) {
      const ptyId = ptyIdFromFilename(entry);
      if (!ptyId) continue;
      const filePath = path.join(STATE_DIR, entry);
      fullReadFile(ptyId, filePath);
      // Broadcast initial state for each pty that has data
      if ((ptyStates.get(ptyId)?.activeCount ?? 0) > 0) {
        broadcast(ptyId);
      }
      // Start watching the file for future changes
      watchFile(ptyId, filePath);
    }
  } catch (err) {
    console.error("[subagent-watcher] Error during boot scan:", err);
  }

  // --- Watch directory for new files ---
  try {
    dirWatcher = fs.watch(STATE_DIR, { persistent: true }, (eventType, filename) => {
      if (!filename) return;
      const ptyId = ptyIdFromFilename(filename);
      if (!ptyId) return;

      const filePath = path.join(STATE_DIR, filename);

      if (eventType === "rename") {
        // Either a new file appeared or was deleted
        if (fs.existsSync(filePath)) {
          // New file or recreated after deletion
          const state = ptyStates.get(ptyId);
          if (!state || !state.watcher) {
            // Possibly a rotation — if we have stale state, fullReadFile resets it
            if (state && state.fileOffset > 0) {
              // Check if file is smaller (rotation)
              try {
                const s = fs.statSync(filePath);
                if (s.size < state.fileOffset) {
                  fullReadFile(ptyId, filePath);
                } else {
                  ensurePtyState(ptyId);
                }
              } catch {
                ensurePtyState(ptyId);
              }
            } else {
              ensurePtyState(ptyId);
            }
            watchFile(ptyId, filePath);
            const changed = processNewLines(ptyId, filePath);
            if (changed) broadcast(ptyId);
          }
        }
        // If file doesn't exist, file watcher will handle the deletion case
        return;
      }

      // eventType === "change" on a directory usually doesn't fire, but handle anyway
      const state = ptyStates.get(ptyId);
      if (!state) {
        ensurePtyState(ptyId);
        watchFile(ptyId, filePath);
      }
      const changed = processNewLines(ptyId, filePath);
      if (changed) broadcast(ptyId);
    });

    dirWatcher.on("error", (err) => {
      console.error("[subagent-watcher] Directory watcher error:", err);
    });
  } catch (err) {
    console.error("[subagent-watcher] Failed to watch state directory:", err);
  }

  console.log("[subagent-watcher] Watcher started successfully.");
}

/**
 * Stop all watchers (cleanup on app quit).
 */
export function stopSubagentWatcher(): void {
  dirWatcher?.close();
  dirWatcher = null;

  for (const [, state] of ptyStates) {
    state.watcher?.close();
    state.watcher = null;
  }

  ptyStates.clear();
  console.log("[subagent-watcher] Stopped.");
}

/**
 * Get a snapshot of all current PTY states.
 * Used by ipcMain.handle("subagent:snapshot") in main.ts.
 */
export function getSubagentSnapshot(): SubagentStatusPayload[] {
  const result: SubagentStatusPayload[] = [];
  for (const [ptyId, state] of ptyStates) {
    result.push({
      ptyId,
      activeCount: Math.max(0, state.activeCount),
      agents: [...state.agents],
    });
  }
  return result;
}
