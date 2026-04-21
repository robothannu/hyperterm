# HyperTerm

## Overview
HyperTerm — an Electron terminal app for macOS, built on xterm.js with direct `node-pty` shells (no tmux). Designed for multi-session work with Claude Code.

## Session Continuity
- At session start, always check `progress.md` for current work status.
- Before ending a session, run `/stopwork` to save progress.

## Architecture: Group vs PTY
- **Group** = user-facing name for a tab. Persisted in `sessions.json` until the user deletes the group, and restored on app restart.
- **PTY** = shell process spawned via `node-pty` (`src/main/pty-manager.ts`). PTYs are not preserved across app restarts — only group metadata (name, cluster, layout) is restored; terminals start fresh.
- `tabLabels` Map: `tabId → group name` (user-defined label).
- `saveSessionMetadata()`: persists group names, clusters, and layouts to `sessions.json`.
- On restore: `savedTab.label → tabLabels.set(tabId, savedTab.label)`.
