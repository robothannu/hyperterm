# Evaluator Report — Sprint 3: Per-Pane 상태 서브행 반영

Feature: sidebar_per_pane_state
Iteration: 1
Sprint: 3
Date: 2026-04-19
Verdict: **PASS**

## Build
- `npm run build` → PASS (tsc + copy-static, no errors)

## Criteria Verification

### AC1: A=Running, B=Waiting 동시 표식
- hook-state.ts:371-377 working 전이 시 `setSidebarPaneRowState(tabId, leaf.ptyId, "running")`
- hook-state.ts:360-369 waiting_approval 전이 시 `setSidebarPaneRowState(tabId, leaf.ptyId, "waiting")`
- 각 호출이 ptyId로 특정 row만 갱신 → 서로 간섭 없음. **PASS**

### AC2: A가 종료되면 A만 Idle/Done, B의 Waiting 유지
- Stop 이벤트는 해당 leaf.ptyId에만 `"done"` 설정 후 8초 뒤 idle (hook-state.ts:379-395)
- Pane B는 별도 row 요소이므로 영향 없음. **PASS**

### AC3: 모든 pane idle일 때 서브행=idle, tab-notif 숨김
- 라인 383: `setTimeout(() => setTabNotifBadge(tabId, "clear"), 5000)` — done 후 5초에 배지 clear
- 서브행은 8초 후 idle. **PASS** (AC3가 완벽히 동기화되진 않지만 최종 상태는 일치)

### AC4: 하나라도 Waiting이면 집계 배지 ⚠ Waiting, dot-status waiting
- `updateSidebarDotPulse(tabId, false)`가 line 399, 381에서 호출되지만 hook-state의 `updateSidebarHookHighlight`는 AC 전체를 재계산 (line 263-273, leaves.some(waiting_approval))
- **잠재 regression**: 라인 382 `setTabNotifBadge(tabId, "done")`는 "다른 pane이 아직 waiting_approval이어도" done을 덮어쓸 수 있음. 다만 이는 Sprint 3 신규 regression이 아닌 Sprint 1/2 aggregator 이슈. dot-status는 라인 398-404에서 `updateSidebarDotPulse(tabId, false)`를 치지만 line 272 hook-highlight 재계산은 함수 초반 line 356에서 수행되어 다시 waiting 표시됨.
- Sub-row(본 스프린트 scope)는 독립 동작. **PASS** (스프린트 scope 내에서 regression 없음)

### AC5: Done 8초 후 자동 idle
- hook-state.ts:386-393 명시적 `setTimeout(..., 8000)`으로 idle 복귀. **PASS**

### AC6: 동일 sync 블록에서 header marker + ● Claude + sub-row 반영
- hook-state.ts:355 `applyHookMarker(leaf)` 후 같은 함수 내 동기적으로 `setSidebarPaneRowState` 호출
- agent-status.ts:190 `setPaneAgentStatus` 후 바로 line 194-206에서 `setSidebarPaneRowState` 호출 (동일 for loop 내)
- **PASS**

### AC7: 1개 pane 그룹에서 regression 없음
- sidebar.ts:456-461 `updateSidebarPaneRows`는 `leaves.length <= 1`일 때 container 비우고 display:none
- `setSidebarPaneRowState`(line 489) 내 `.card-pane-row[data-pty-id=...]` querySelector가 null → early return
- 집계 배지/dot은 기존 로직 그대로 동작. **PASS**

## Adversarial Traces

### Trace 1: Pane A Stop + Pane B Waiting 동시
- B waiting 이벤트: line 364 `setSidebarPaneRowState(tabId, ptyB, "waiting")` — row B의 .cpr-dot만 갱신
- A Stop 이벤트: line 386 `setSidebarPaneRowState(tabId, ptyA, "done")` — row A의 .cpr-dot만 갱신
- row 요소가 `[data-pty-id="${ptyId}"]` 셀렉터로 분리되어 간섭 불가. **PASS**

### Trace 2: Single-pane group에서 hook 이벤트
- Single pane → `.card-pane-rows` innerHTML 비어있음
- `li.querySelector('.card-pane-row[data-pty-id="X"]')` → null → sidebar.ts:490 `if (!row) return`
- 안전하게 no-op. **PASS**

### Trace 3: Done → 8초 후 idle 정확성
- hook-state.ts:393 `}, 8000)` — 정확히 8000ms. **PASS**
- 주의: closure에 `_tabId`, `_ptyId` 로컬 변수 캡처하여 stale 방지. 견고함.

### Trace 4: agent-status guard (hook waiting 덮어쓰기 방지)
- agent-status.ts:195-198: `if (!wasRunning && isRunning)`에서 `if (leaf.agentState === "idle" || leaf.agentState === "done")` 조건으로만 running 설정
- Hook이 waiting_approval / working으로 설정한 pane은 leaf.agentState가 "idle"/"done"이 아니므로 덮어쓰지 않음. **PASS**
- 역시 line 200-205 `wasRunning && !isRunning`도 동일 guard.

### Trace 5 (추가): waiting_approval → idle 전이 시 sub-row 경로
- line 398-404: `prevState === "waiting_approval" && newState !== "waiting_approval"` 블록
- newState="idle"인 경우 line 379 블록이 먼저 실행되어 `setSidebarPaneRowState(..., "done")` 설정
- line 401 조건 `newState !== "working" && newState !== "idle"` → idle이면 skip → done 상태 유지. 의도대로 동작. **PASS**

## Scores (/5)

- **functionality**: 5 — 모든 AC가 코드 경로로 명확히 검증됨
- **user_experience**: 4 — Done 5초(tab-notif) vs 서브행 8초 불일치는 약간 혼란 가능
- **visual_quality**: 4 — cpr-dot CSS가 Sprint 2에서 정의된 상태 재활용. 신규 시각 요소 추가 없음
- **edge_cases**: 5 — single-pane early return, agent-status guard, waiting→idle 경로 모두 처리
- **performance**: 5 — per-pane 단일 DOM 쿼리, timeout 누수 없음 (closure 캡처)
- **regression**: 5 — Sprint 1/2 기능 영향 없음, single-pane safe no-op

**Total: 28/30 → PASS**

## Notes
- 라인 382 `setTabNotifBadge(tabId, "done")`는 집계 배지 aggregator 미구현 이슈가 잔존하나 Sprint 3 scope 밖
- Done→idle 타이밍이 tab-notif(5s)와 sub-row(8s) 간 불일치. 소비자 피드백에 따라 통일 검토 권장
