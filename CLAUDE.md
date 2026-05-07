# HyperTerm

## Objective
Claude Code · Codex 멀티세션 워크플로우에 최적화된 macOS 전용 터미널 앱 — 여러 프로젝트를 하나의 윈도우에서 빠르게 오가며 작업하도록 한다.

## Overview
HyperTerm — an Electron terminal app for macOS, built on xterm.js with direct `node-pty` shells (no tmux). Designed for multi-session work with Claude Code and OpenAI Codex CLI side-by-side.

## Session Continuity
- At session start, always check `progress.md` for current work status.
- Before ending a session, run `/stopwork` to save progress.

## Architecture: Group vs PTY
- **Group** = user-facing name for a tab. Persisted in `sessions.json` until the user deletes the group, and restored on app restart.
- **PTY** = shell process spawned via `node-pty`. PTYs are not preserved across app restarts — only group metadata (name, cluster, layout, claudeCwd, codexCwd) is restored; terminals start fresh.
- `tabLabels` Map: `tabId → group name` (user-defined label).
- `saveSessionMetadata()`: persists group names, clusters, layouts, claudeCwd, codexCwd to `sessions.json`.
- On restore: `savedTab.label → tabLabels.set(tabId, savedTab.label)`.

## Multi-tool support (Claude + Codex)
- Tool detection (`workspace-reader.ts:detectTool`): file presence only. CLAUDE.md → claude, AGENTS.md → codex, both → mixed, neither → none. Card footer always shows `[Claude] [Codex] [Open]`.
- Cross-tool click(예: codex 워크스페이스에서 Claude) → `confirmCrossTool` 다이얼로그로 빈 컨텍스트 진입 확인.
- State files: progress.md(claude/mixed), handoff.md(codex/mixed). 둘 다 `## Current Task | ## Current Status | ## Status | ## Current` + `## Next Steps | ## Next` fallback chain.
- PTY managers split by tool — see Architecture below.

## Architecture: PTY managers
- `src/main/pty-manager-base.ts` — shared `SessionStore` factory(write/resize/destroy/destroyAll/getCwd 등) + `findInProcessTree(rootPid, depth, binary, nodeFragment)` + `isCommandAvailable(cmd)` + helpers(getInteractiveShell, resolveSessionCwd, buildSessionEnv).
- `src/main/pty-manager.ts` — Claude. spawn 로직(`createSession`, `createSessionWithClaude`)만, 공통 ops는 base 위임. ID range 1+.
- `src/main/pty-manager-codex.ts` — Codex. spawn 로직(`createSessionWithCodex`)만, 공통 ops는 base 위임. ID range 50000+ (충돌 방지).
- main.ts `pty:write/resize/destroy/getCwd` 4개 핸들러는 `hasSession(id)` 분기로 두 매니저 라우팅.
- 향후 다른 CLI(예: aider) 추가 시 같은 패턴 — base 사용 + spawn 함수만 작성 + main.ts에 분기 추가.

## Architecture: dashboard renderer modules
Dashboard window는 script 모드(non-module). `dashboard.html`이 다음 순서로 로드:
1. `dashboard-autorefresh.js` — 60s auto-refresh 인터벌
2. `dashboard.js` — 핵심 state/render/handlers (가장 큰 파일)
3. `dashboard-gitflow.js` — Git Flow SVG/모달 (cache, render, zoom, keyboard)
4. `dashboard-discovery.js` — Discovery banner/Review 모달
5. `dashboard-newproject.js` — New Project wizard

자식 모듈 패턴:
- `var` 글로벌 + `function` 정의 — script 모드 same-window scope에서 공유
- 다른 모듈에서 정의한 globals은 `declare var/function`으로 type 선언
- 새 자식 모듈 추가 시: (1) `dashboard-xxx.ts` 작성, (2) `dashboard.html`에 script 태그 추가, (3) `global.d.ts`에 declare 추가, (4) cross-script `Window` augmentation은 `interface Window { ... }`에 추가.
