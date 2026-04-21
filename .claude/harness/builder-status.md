# Builder Status

## Sprint: 멀티탭 세션 상태 감지 수정 (Sprint 1, Iteration 1)

## Status: COMPLETE

## Commit
852d6a8 — fix: 멀티탭 세션 상태 감지 — 전체탭 폴링 + active tab 우선 매핑

## 변경 파일
- `src/renderer/agent-status.ts`
- `src/renderer/hook-state.ts`

## AC 이행 요약

### AC1 (전체 탭 폴링)
`pollAgentStatus()`를 `tabMap.entries()` 전체 순회로 변경.
모든 pane의 `leaf.agentStatus` + pane header 마커(● Claude) 업데이트.
`updateSidebarAgentMarker`는 `activeTabId` 기준으로만 호출 — 유지.

### AC2 (active tab 우선 매핑)
`findOrAssignLeaf()`에서 새 session_id 매핑 시 `orderedTabIds` 배열을
[activeTabId, ...나머지 탭] 순서로 구성해 active tab 우선 탐색.
기존 hookSessionMap에 있는 session_id는 변경 없음.

### AC3 (setSidebarPaneRowState 직접 호출 제거)
`!wasRunning && isRunning → setSidebarPaneRowState(..., "running")`,
`wasRunning && !isRunning → setSidebarPaneRowState(..., "idle")` 두 블록 모두 제거.
폴링은 `agentStatus` 필드 + pane header 마커 업데이트만 담당.

## 검증
- `npx tsc --noEmit` → 오류 없음
- `agent-status.ts`에 `setSidebarPaneRowState` 호출 없음 (grep 확인)
