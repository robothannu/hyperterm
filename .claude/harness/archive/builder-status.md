# Builder Status — Sprint 3: Per-Pane 상태 서브행 반영
## Iteration: 1
## Status: complete

## Commit
`9446d25` — sprint 3: per-pane hook state in sidebar sub-rows

## Files Modified
- `src/renderer/hook-state.ts` — `handleHookEvent`에 `setSidebarPaneRowState` 호출 추가
- `src/renderer/agent-status.ts` — `pollAgentStatus`에 sub-row 동기화 추가

## Implementation Summary

### hook-state.ts
- `waiting_approval` 전환 시: `setSidebarPaneRowState(tabId, ptyId, "waiting")` — `setTabNotifBadge`와 동일 synchronous 블록 (AC6)
- `working` 전환 시: `setSidebarPaneRowState(tabId, ptyId, "running")` — `setTabNotifBadge`와 동일 synchronous 블록 (AC6)
- `idle` 전환 시 (Stop): `setSidebarPaneRowState(tabId, ptyId, "done")` 즉시 호출 후 8초 뒤 "idle" (AC5)
- `waiting_approval` 해제 시 working/idle 외 상태이면 "idle"로 복구

### agent-status.ts
- `wasRunning=false → isRunning=true`: `leaf.agentState`가 idle/done이면 sub-row를 "running"으로 (hook 이전 폴백)
- `wasRunning=true → isRunning=false`: `leaf.agentState`가 idle/done이면 sub-row를 "idle"로 복구

## Acceptance Criteria 검증

| AC | Status | Evidence |
|----|--------|---------|
| 1 | PASS | `setSidebarPaneRowState` 호출이 `leaf.ptyId` 기반 — 각 pane 독립적으로 running/waiting 설정 |
| 2 | PASS | Stop 이벤트는 해당 leaf만 처리, B pane의 waiting 상태 미변경 |
| 3 | PASS | 기존 `setTabNotifBadge("clear")` 로직 유지 (수정 안 함) |
| 4 | PASS | 기존 `updateSidebarDotPulse` + `setTabNotifBadge("approval")` 유지 (수정 안 함) |
| 5 | PASS | done 즉시 표시 후 `setTimeout(8000)` → idle |
| 6 | PASS | 모든 `setSidebarPaneRowState` 호출이 `applyHookMarker`/`setTabNotifBadge`와 동일 sync 블록 |
| 7 | PASS | `setSidebarPaneRowState`는 `.card-pane-row` 없으면 early return — single-pane 무영향 |

## Build
`npm run build` PASS — TypeScript 컴파일 오류 없음

## Handoff Artifact
- `setSidebarPaneRowState` wiring 완료
- CSS classes (`cpr-dot-idle/running/waiting/done`) Sprint 2에서 이미 정의됨
- `data-pty-id` attribute로 O(1) sub-row 조회 확인
- 기존 aggregate badge/dot-status 로직 무변경 (regression 없음)
