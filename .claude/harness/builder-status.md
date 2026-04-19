# Builder Status
## Sprint: 1 — Per-Pane Git Branch 추적
## Iteration: 1
## Status: complete

## What I Built
- `git-status.ts`에 `paneGitCache = new Map<ptyId, GitCacheEntry>()` 추가
- `pollGitForPane(ptyId)` 함수 신규: 단일 pane의 cwd → git root → status를 독립적으로 polling
- `pollGitForTab()`을 `Promise.all(leaves.map(pollGitForPane))`로 변경 → 모든 pane 병렬 polling
- 사이드바 card-meta: focused pane의 git info 표시 (focused pane이 사용자가 활성으로 작업 중인 pane)
- `tabGitCache`는 backward compat 유지 (changed-files-panel.ts가 이를 읽음) — focused pane 데이터로 동기화
- `getGitCacheForPane(ptyId)` 노출 함수 추가
- `cleanupPaneGitCache(ptyId)` 노출 함수 추가
- `renderer.ts`: `updatePaneHeadersFromGitCache()`를 per-pane cache 기반으로 변경
- `renderer.ts`: `startCwdPoll()` 내부 branch 업데이트도 `getGitCacheForPane()` 사용
- `renderer.ts`: `closePaneByPtyId()` / `closeTab()`에서 `cleanupPaneGitCache()` 호출 추가
- `global.d.ts`: `getGitCacheForPane`, `cleanupPaneGitCache` 타입 선언 추가

## Acceptance Criteria Status
1. [x] pane A(main) / pane B(feat/login) 각각 독립 branch 표시 — pollGitForPane이 ptyId별로 독립 polling하므로 충족
2. [x] pane B에서 cd로 이동 시 polling 주기(5s) 내 branch 갱신, pane A 영향 없음 — paneGitCache가 ptyId별 독립이므로 충족
3. [x] git repo 아닌 pane은 branch 숨김, 같은 그룹 타 pane 영향 없음 — info=null이면 브랜치 요소 hide, 다른 pane cache 무관
4. [x] 단일 pane 그룹 동작 유지 (regression 없음) — pollGitForTab이 leaves[0]만 있어도 정상 동작, tabGitCache도 업데이트
5. [x] pane 닫힐 때 cache 정리 — closePaneByPtyId/closeTab에서 cleanupPaneGitCache() 호출, pane-destroy 이벤트도 유지

## Implementation Decisions
- **사이드바 card-meta = focused pane info**: 사용자가 현재 작업 중인 pane의 branch가 sidebar에 표시되는 것이 가장 자연스럽다.
- **tabGitCache 유지 (backward compat)**: `changed-files-panel.ts`가 `getGitCacheForTab()`을 통해 파일 목록을 읽으므로, 탭 레벨 캐시를 삭제하지 않고 focused pane 데이터로 동기화 유지.
- **병렬 polling**: `Promise.all`로 탭 내 모든 pane을 동시에 polling → 총 latency가 최악 1개 pane과 동일.
- **pollGitForPane이 gitFiles도 fetching**: 기존 pollGitForTab과 동일하게 files를 가져옴 — changed-files-panel에 영향 없음.

## Test Results
- TypeScript build: `npm run build` → pass (0 errors)

## Pre-Completion Verification
- Build: `npm run build` → exit 0, no TypeScript errors
- `dist/renderer/git-status.js` 에 `paneGitCache`, `pollGitForPane`, `getGitCacheForPane`, `cleanupPaneGitCache` 모두 컴파일 확인
- `dist/renderer/renderer.js` 에 `getGitCacheForPane` 참조, `cleanupPaneGitCache` 호출 2곳 확인
- Criterion 1: `pollGitForPane`이 각 leaf.ptyId에 대해 독립 getCwd → gitFindRoot → gitStatus 수행
- Criterion 2: `paneGitCache`는 ptyId key라 다른 pane cache에 영향 없음; poll 주기 5s (10s 이내 기준 충족)
- Criterion 3: `gitFindRoot` 반환 null → `info=null` → `updatePaneHeadersFromGitCache`에서 branch hide
- Criterion 4: 단일 pane: leaves.length==1이면 pollGitForPane 1번 호출, tabGitCache 동기화, sidebar badge 업데이트
- Criterion 5: `closePaneByPtyId` L584-585, `closeTab` L631-632 에 cleanupPaneGitCache 호출

## Files Modified
- `src/renderer/git-status.ts`: paneGitCache, pollGitForPane, pollGitForTab 전면 재작성, cleanupPaneGitCache 추가
- `src/renderer/renderer.ts`: updatePaneHeadersFromGitCache (per-pane), startCwdPoll branch logic, closePaneByPtyId/closeTab cleanup
- `src/renderer/global.d.ts`: getGitCacheForPane, cleanupPaneGitCache 선언 추가

## Handoff Artifact
- `paneGitCache: Map<ptyId, GitCacheEntry>` — Sprint 2가 sidebar sub-row에 per-pane branch 표시할 때 `getGitCacheForPane(ptyId)` 사용 가능
- `getGitCacheForPane(ptyId)` 함수 — pane별 branch/dirty/ahead 읽기
- `tabGitCache`는 여전히 focused pane 기준으로 유지되어 changed-files-panel 등 기존 코드 무영향

## Risk Assessment
- Auth/DB/SQL/crypto: no
- User data rendering: no
- Concurrency/shared state: yes — Map mutations during polling interval (setInterval 5s vs async polling). 단, JS는 single-threaded이므로 실제 race condition 없음. Promise.all 내부는 순차 microtask로 처리됨.
- Large change (100+ lines): yes (git-status.ts 전체 재작성 + renderer.ts 다수 패치)
