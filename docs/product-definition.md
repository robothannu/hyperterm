# HyperTerm Product Definition

## Purpose

HyperTerm is a macOS terminal workspace manager for developers who work across multiple projects and AI assistants at the same time.

It combines terminal groups, pane layouts, a workspace dashboard, and Claude Code / OpenAI Codex project-state awareness. Live PTY processes are not restored after app relaunch; workspace metadata and layouts are restored.

## Core Product Principles

- Keep terminal sessions organized by workspace.
- Restore workspace metadata and pane layout, not live terminal processes.
- Make active work visible at a glance.
- Keep Claude and Codex project state separate when both exist.
- Prefer card-level dashboard refresh over full-screen rebuilds.
- Use English-first user-facing UI and docs.

## Primary User Surfaces

### Terminal Groups

The main app view shows terminal groups in the sidebar and terminals in the active group.

- Create, switch, rename, and close groups.
- Persist group labels, clusters, cwd metadata, and pane layout.
- Restore saved group structure on relaunch.
- Keep terminals fresh after relaunch instead of attempting PTY process restore.

### Pane Layouts

Each group can contain one or more panes.

- Split panes horizontally or vertically.
- Resize panes with dividers.
- Move focus between panes.
- Show cwd, branch, and change metadata for active work.

### Dashboard

The dashboard is the workspace control surface.

- Lists tracked workspaces.
- Reads project state from Claude and Codex files.
- Shows goal, current task, next steps, git status, open state, running state, and changed-file state.
- Keeps Claude and Codex state visually separate.
- Chooses the primary side from file presence and the most recently modified side.
- Refreshes changed cards without rebuilding the entire dashboard when possible.

### New Project Flow

The dashboard can create a new workspace folder.

- Uses the macOS directory picker for the parent directory.
- Creates the project folder.
- Always runs `git init`.
- Creates either Claude starter files or Codex starter files.
- Adds the new folder as a workspace and opens it with the selected tool.

### Command Palette

The command palette is the fast access surface.

- Searches tabs, workspaces, workflows, recent items, and actions.
- Supports fuzzy matching.
- Opens workspaces with the primary or alternate AI tool.

### Changed Files Panel

The changed files panel shows git changes for the active group.

- Lists modified, added, deleted, renamed, and untracked files.
- Opens file diffs.
- Helps the user review work before committing or handing off.

### Activity And Status Indicators

Sidebar and dashboard indicators represent state, not counts or decorative badges.

- Claude states: idle, running, waiting, done.
- Codex state: running or idle.
- Git states: branch, ahead count, and changed-file count.
- Dashboard states: active, has changes, running, archived.

## Dashboard State Model

Dashboard status definitions are user-facing contracts.

- `Running`: Claude/Codex is actively running, or the Claude harness phase is `building`, `evaluating`, or `running`.
- `Has changes`: git staged, unstaged, or untracked changes exist.
- `Active`: the workspace is not archived. Running, open, changed, and recent git activity affect filters, badges, and sorting.
- `Archived`: only workspaces manually archived by the user. Old git activity does not automatically archive a workspace.
- `Recent`: a sort mode named `Recently active`, not a workspace status or dashboard group.

## Workspace Open Model

A workspace is considered open when any saved terminal pane cwd is the workspace root or a descendant path.

Examples:

- `/project` opens workspace `/project`.
- `/project/src` opens workspace `/project`.
- `/project/packages/app` opens workspace `/project`.
- `/project-other` does not open workspace `/project`.

## Claude And Codex Project State

HyperTerm does not merge Claude and Codex state into one progress file.

- Claude side files: `CLAUDE.md`, `progress.md`.
- Codex side files: `AGENTS.md`, `AGENT.md`, `.codex/HANDOFF.md`, `docs/codex-handoff.md`, `codex-handoff.md`, `HANDOFF.md`, `handoff.md`.
- If only one side exists, the dashboard uses that side.
- If both sides exist, the dashboard uses the side with the most recently modified project-state file as primary.
- If multiple Codex handoff files exist, the dashboard reads the newest handoff file.
- The dashboard can still show both Claude and Codex project states when both are available.

## User Scenarios

### Resume Work After Relaunch

1. The user launches HyperTerm.
2. The app restores saved group metadata and pane layout.
3. The user sees the same workspace structure as before quitting.
4. Terminals start fresh because live PTYs are not restored.
5. The user resumes from dashboard and repo-local state files.

### Start A New Project

1. The user opens New Project from the dashboard.
2. The user chooses a parent folder with the macOS picker.
3. HyperTerm creates the project folder and initializes git.
4. The user selects Claude or Codex.
5. HyperTerm creates the matching starter files and registers the workspace.
6. The workspace appears in the dashboard and opens with the selected tool.

### Inspect Workspace State

1. The user opens the dashboard.
2. HyperTerm reads Claude and Codex project files.
3. The dashboard shows goal, current task, next steps, git state, and status.
4. If both Claude and Codex files exist, the most recently updated side is primary.
5. The user can open the workspace with Claude, Codex, Terminal, IDE, or Finder.

### Continue AI-Assisted Work

1. The user selects a workspace.
2. The user opens it with Claude or Codex.
3. HyperTerm starts the selected tool in the workspace cwd.
4. Cross-tool launches confirm when the expected project file is missing.
5. Sidebar and dashboard states update as work progresses.

### Review Changes

1. The user selects a group with git changes.
2. The changed files panel lists changed files.
3. The user opens diffs.
4. The user reviews work before committing or handing off.

## Out Of Scope

- Replacing xterm.js as the terminal emulator.
- Restoring live PTY processes after relaunch.
- Automatically archiving stale workspaces.
- Combining Claude and Codex state into one shared file.
- Adding a full bilingual runtime language switch.

## Reference Files

- `CLAUDE.md`
- `AGENTS.md`
- `AGENT.md`
- `.codex/HANDOFF.md`
- `docs/codex-handoff.md`
- `progress.md`
- `src/main/workspace-reader.ts`
- `src/main/session-state.ts`
- `src/renderer/dashboard.ts`
