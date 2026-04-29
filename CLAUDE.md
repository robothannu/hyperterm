# HyperTerm

## Objective
Claude Code 멀티세션 워크플로우에 최적화된 macOS 전용 터미널 앱 — 여러 프로젝트를 하나의 윈도우에서 빠르게 오가며 작업하도록 한다.

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
