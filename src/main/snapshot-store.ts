// ---------------------------------------------------------------------------
// Snapshot Store utilities (Sprint 1: Session Restore)
//
// Pure functions for validating / capping snapshot data before it is embedded
// in sessions.json. No I/O here — callers own the read/write cycle.
//
// Design: main process never touches the ANSI bytes for rendering; it only
// validates size and passes through. Actual serialization happens in the
// renderer (snapshot-capture.ts).
// ---------------------------------------------------------------------------

/** Maximum bytes for a single leaf snapshot (must match renderer cap). */
export const SNAPSHOT_BYTES_CAP = 200 * 1024; // 200 KB

/**
 * Validate and cap a snapshot string received from the renderer.
 * Returns the (possibly truncated) snapshot string, or empty string if invalid.
 *
 * Truncates from the end to keep the most-recent terminal output.
 */
export function capSnapshot(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0) return "";
  if (raw.length > SNAPSHOT_BYTES_CAP) {
    return raw.slice(raw.length - SNAPSHOT_BYTES_CAP);
  }
  return raw;
}

/**
 * Walk a SavedPaneNode tree and cap every leaf's scrollback field in-place.
 * Safe to call on untrusted data from sessions.json — guards against type
 * mismatches at each level.
 */
export function capSnapshotsInTree(node: unknown): void {
  if (!node || typeof node !== "object") return;
  const n = node as Record<string, unknown>;
  if (n["type"] === "leaf") {
    if (typeof n["scrollback"] === "string" && n["scrollback"].length > 0) {
      n["scrollback"] = capSnapshot(n["scrollback"]);
    }
    return;
  }
  if (n["type"] === "split" && Array.isArray(n["children"])) {
    for (const child of n["children"]) {
      capSnapshotsInTree(child);
    }
  }
}

/**
 * Estimate the total bytes of scrollback data across all tabs in a parsed
 * sessions.json payload. Used for observability/logging — not for capping.
 */
export function estimateTotalSnapshotBytes(
  tabs: Array<{ layout?: unknown }>
): number {
  let total = 0;
  function walk(node: unknown): void {
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    if (n["type"] === "leaf" && typeof n["scrollback"] === "string") {
      total += n["scrollback"].length;
      return;
    }
    if (n["type"] === "split" && Array.isArray(n["children"])) {
      for (const child of n["children"]) walk(child);
    }
  }
  for (const tab of tabs) {
    walk(tab.layout);
  }
  return total;
}
