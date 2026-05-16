# Codex Handoff

## Last Updated
2026-05-16 19:20 KST

## Goal
Stabilize the Workspace Dashboard so workspace cards, list view, tool-state selection, Git Flow information, and app quit behavior are clear enough for daily product use.

## Current State
- Latest code commit: `62fbdff Add clickable git flow detail panel`.
- Previous dashboard hardening commit: `9bbfc10 Improve dashboard state rendering and quit guard`.
- Dashboard now shows only the primary/latest tool state when both Claude and Codex state files exist.
- Card-level duplicate Goal/Current/Next rendering was removed when `Project states` is available.
- Running state labels distinguish `codex running` from Claude harness phases.
- Grid/list workspace cards can be reordered by drag and the order is persisted via `workspace:reorder`.
- List view refresh no longer stacks duplicate rows; reconcile now finds both `.ws-card` and `.list-row` nodes and removes duplicate list rows by workspace id.
- Closing HyperT now prompts in English and warns that closing terminates terminal sessions before destroying PTYs.
- Git Flow modal now has a fixed detail panel. Clicking branch lanes, branch chips, legend items, or commit nodes shows branch/commit/repository details without relying on tooltip hover.
- Packaged app was rebuilt with `./node_modules/.bin/electron-builder --mac dir` after the Git Flow detail-panel change.

## Git State
- Branch: `main`
- Status before handoff commit: working tree contains `.codex/HANDOFF.md` update only.
- Local branch was observed as ahead of `origin/main` by 46 commits before this handoff commit and push.

## Changed Files
- `src/renderer/dashboard-gitflow.ts`: added Git Flow selection/detail rendering, clickable branch/commit targets, overview/branch/commit detail views, and modal selection event wiring.
- `src/renderer/dashboard.html`: added Git Flow modal side detail panel layout, responsive behavior, clickable branch/legend styling, and selected item highlighting.
- `.codex/HANDOFF.md`: refreshed durable resume state for the current dashboard work.

## Decisions
- Tooltip remains as supplemental context, but Git Flow branch/commit information should be available through click-driven UI.
- Git Flow detail panel lives inside the existing modal instead of opening another popup, so selected context stays visible while zooming or scrolling the graph.
- Dashboard state should prefer the latest primary tool state and avoid showing Claude and Codex state side-by-side when that creates ambiguity.

## Open Tasks
- [ ] After push, confirm remote contains commits `9bbfc10`, `62fbdff`, and the handoff commit.
- [ ] Manually verify in the running app that Git Flow modal clicks update the right-side detail panel for branch lanes, branch chips, legend items, and commit nodes.
- [ ] If users need external Terminal/iTerm Codex detection, design a process-discovery path; current running detection only covers HyperT-owned PTY sessions.

## Verification
- `npm run build` - passed
- `node test/dashboard.test.mjs` - passed
- `node test/workspace-reader-overview.test.mjs` - passed
- `node test/workspaces.test.mjs` - passed earlier for the dashboard/order/quit guard change
- `git diff --check` - passed
- `./node_modules/.bin/electron-builder --mac dir` - passed

## Next Command
`git push origin main`

## Resume Prompt
Read `.codex/HANDOFF.md`, then run `git status --short --branch`. Continue from the Workspace Dashboard Git Flow detail-panel work. First verify whether the latest commits were pushed; then manually test the Git Flow modal click behavior in the packaged `release/mac-arm64/HyperTerm.app`.
