# HyperTerm

## Objective
macOS Electron terminal app for multi-session Claude Code / Codex workflows.

## Current Direction
- Dashboard cards choose Claude vs Codex by file presence first, then by the most recently modified side.
- Claude side = `CLAUDE.md` + `progress.md`.
- Codex side = `AGENT.md` + handoff files (`.codex/HANDOFF.md`, `codex-handoff.md`, `HANDOFF.md`, `handoff.md`).
- Keep the dashboard. Prefer refreshing only the changed cards instead of tearing down the whole view.
- New Project must use the OS folder picker and always run `git init`.

## Architecture
- `src/main/workspace-reader.ts` owns tool detection, overview summarization, and git/file-tree reads.
- `src/main/main.ts` owns IPC, workspace registration, new project creation, session state, and dashboard launch.
- `src/renderer/dashboard.ts` is the core dashboard shell.
- `dashboard-autorefresh.ts`, `dashboard-gitflow.ts`, `dashboard-discovery.ts`, and `dashboard-newproject.ts` are loaded as plain scripts and share the same window scope.

## Commands
- Build: `npm run build`
- Package: `npm run dist`
- Run app: `npm start`
- Focused checks: `node test/workspace-reader-overview.test.mjs`, `node test/dashboard-status.test.mjs`

## Workflow Rules
- At session start, check `progress.md`, `.codex/HANDOFF.md`, and `git status --short`.
- Use `apply_patch` for edits and keep changes scoped.
- Update or add tests whenever dashboard classification or card data behavior changes.
- Before ending work, update `.codex/HANDOFF.md` and report any skipped verification.
- Prefer exact file paths and commands in notes; avoid generic placeholders.

## Known Constraints
- Dashboard scripts are plain `<script>` files, not ES modules; script order in `dashboard.html` matters.
- `workspace-reader.ts` is mtime-aware; when both sides exist, the newer side wins.
- Use macOS-safe UX for file pickers and project creation.
