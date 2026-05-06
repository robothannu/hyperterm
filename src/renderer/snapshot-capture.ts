/// <reference path="./global.d.ts" />
/// <reference path="./pane-types.d.ts" />
/// <reference path="./terminal-session.ts" />

// ---------------------------------------------------------------------------
// Snapshot Capture (Sprint 1: Session Restore)
//
// Manages per-PTY scrollback snapshots in the renderer process.
// Uses SerializeAddon (already loaded in TerminalSession) to capture ANSI
// buffer content. Snapshots are included in sessions.json via SavedPaneLeaf.
//
// Loaded as a plain <script> tag (same as terminal-session.ts) — no module
// exports. All functions are declared globally and available to renderer.ts.
// ---------------------------------------------------------------------------

/** Maximum bytes stored per pane leaf snapshot. ~200 KB keeps 20 tabs under 5 MB. */
const SNAPSHOT_BYTES_CAP = 200 * 1024; // 200 KB

/**
 * Match previously-written restore dividers so they don't accumulate
 * across multiple restart cycles.
 */
const DIVIDER_PATTERN =
  /\x1b\[0?m?\x1b\[2m—— restored from previous session \([^)]*\) ——\x1b\[0m\r?\n/g;

/**
 * Capture the scrollback buffer of a TerminalSession using SerializeAddon.
 * Returns the serialized ANSI string, truncated to the last SNAPSHOT_BYTES_CAP
 * bytes if it exceeds the cap. Strips any prior divider lines so they don't
 * accumulate after multiple restart cycles.
 *
 * Returns empty string if serialization fails or produces no content.
 */
function captureSnapshot(session: TerminalSession): string {
  try {
    const raw = session.serialize();
    if (!raw || raw.length === 0) return "";

    // Strip any previously-written restore dividers — prevents accumulation
    const stripped = raw.replace(DIVIDER_PATTERN, "");

    // Truncate from the end to preserve the most recent output
    if (stripped.length > SNAPSHOT_BYTES_CAP) {
      console.log(
        `[snapshot-capture] truncating snapshot: ${stripped.length} → ${SNAPSHOT_BYTES_CAP} bytes`
      );
      return stripped.slice(stripped.length - SNAPSHOT_BYTES_CAP);
    }
    return stripped;
  } catch (err) {
    console.warn("[snapshot-capture] serialize failed:", err);
    return "";
  }
}

/**
 * Build the divider string for display in xterm after restoring a snapshot.
 * Format: "—— restored from previous session (YYYY-MM-DD HH:MM) ——"
 * Styled with ANSI dim + reset so it is visually distinct from shell output.
 *
 * @param timestamp  ISO date string or Date; defaults to now.
 */
function buildDivider(timestamp?: string | Date): string {
  const d = timestamp ? new Date(timestamp) : new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const label = `—— restored from previous session (${yyyy}-${mm}-${dd} ${hh}:${mi}) ——`;
  // ESC[0m resets any open ANSI state from the previous (truncated) snapshot
  // so an unterminated escape sequence doesn't bleed into the divider.
  // ESC[2m = dim, ESC[0m = reset.
  return `\x1b[0m\x1b[2m${label}\x1b[0m\r\n`;
}

/**
 * Write a snapshot + divider into a TerminalSession.
 * If snapshot is empty, does nothing (no divider either — AC #6).
 *
 * @param session   Target TerminalSession to write into.
 * @param snapshot  ANSI serialized string from a previous captureSnapshot call.
 * @param savedAt   ISO timestamp of when the snapshot was saved (shown in divider).
 */
function restoreSnapshot(
  session: TerminalSession,
  snapshot: string,
  savedAt?: string
): void {
  if (!snapshot || snapshot.length === 0) return;

  try {
    // Write the historical output first
    session.write(snapshot);
    // Then the divider separating past from new shell output
    session.write(buildDivider(savedAt));
    console.log(
      `[snapshot-capture] restored snapshot (${snapshot.length} bytes) + divider`
    );
  } catch (err) {
    console.warn("[snapshot-capture] restoreSnapshot write failed:", err);
  }
}
