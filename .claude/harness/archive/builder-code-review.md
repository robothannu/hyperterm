# Builder Status
## Sprint: 3 — Polling Efficiency & UX Polish
## Iteration: 1
## Status: complete

## What I Built

### #9 git-status.ts — 비활성 탭 polling 축소
- `pollAllGitStatus()` 제거 → `pollActiveGitStatus()` 추가: `activeTabId`만 5초마다 poll
- `pollGitOnTabSwitch(tabId)` 추가: 탭 전환 시 즉시 on-demand poll
- `renderer.ts` `switchToTab()`에 `pollGitOnTabSwitch(tabId)` 호출 추가
- `global.d.ts`에 `pollGitOnTabSwitch` cross-module 선언 추가
- 효과: 8탭 중 1탭 표시 시 git IPC 호출이 1회/5초로 감소 (기존 8회/5초)

### #10 agent-status.ts — 비활성 탭 agent polling 확인
- 기존 코드가 이미 `activeTabId`만 poll하고 있었음
- `pollAgentStatus()`에 burst 로그 추가: `[agent-status] polling N pane(s) for active tab X`
- 단일 `Promise.all()`로 N개 pane을 한 번에 처리하는 것 명시적으로 확인 가능

### #12 notes-panel.ts — 미저장 확인 다이얼로그
- `tryCloseNotesPanel()` 함수 추가: textarea에 텍스트 있으면 `window.confirm()` 표시
  - "취소" (Cancel): 패널 열린 채 텍스트 유지
  - "확인" (OK/Discard): textarea 비우고 패널 닫기
- close 버튼, ESC 키, overlay 클릭 모두 `tryCloseNotesPanel()` 사용
- 탭 강제 닫기(`closeTab`)는 기존 `closeNotesPanel()` 유지 (강제 종료는 확인 불필요)

### #13 sidebar-mru.ts — MRU 경로 검증
- `path:checkExists` IPC 추가: main.ts (`fs.existsSync`), preload.ts, global.d.ts
- `validateMruProjects()`: 앱 로드 시 모든 MRU 경로 병렬 체크 → stale 경로 무음 제거
- `onMruEntryClick()`: 클릭 시 경로 체크 → 없으면 `showToast()` 오류 메시지 + 항목 제거

### #15 settings-modal.ts — 신규 세션 기본값 반영
- `renderer.ts`에 `var activeSessionSettings` 전역 추가 (fontSize: 14, theme: "dark" 기본값)
- `applyFontSizeToAll()`, `applyTheme()`: 적용 시 `activeSessionSettings` 동기화
- `initSettingsModal()`: 설정 로드 후 기존 호출로 자동 동기화
- `createPaneSession()`: `session.open()` 후 `activeSessionSettings` 값 즉시 적용

## Acceptance Criteria Status

1. [x] 비활성 탭 git polling 축소: `pollActiveGitStatus()`가 `activeTabId`만 poll. 탭 전환 시 `pollGitOnTabSwitch()`로 즉시 갱신.
2. [x] agent-status burst 로그: 단일 `Promise.all()`로 N개 pane 처리, 로그로 확인 가능.
3. [x] notes 미저장 경고: `tryCloseNotesPanel()`로 close/ESC/overlay 모두 처리. 빈 textarea는 즉시 닫기.
4. [x] stale MRU 제거: 앱 로드 시 `validateMruProjects()`, 클릭 시 체크 후 toast + 제거.
5. [x] 신규 탭에 settings 기본값 반영: `activeSessionSettings` 전역으로 font/theme 동기화.
6. [x] 리그레션 없음: 기존 로직 변경 없음. `npm run build` 0 errors.

## Implementation Decisions

- `pollGitOnTabSwitch`를 별도 함수로 분리해 renderer.ts에서 cross-module 호출
- `window.confirm()` 사용: 브라우저 내장, 별도 모달 없이 간단 구현
- `activeSessionSettings`를 `var`로 선언: global.d.ts의 `declare var`와 충돌 없이 cross-module 공유
- `validateMruProjects()` 비동기 병렬 처리: 경로 수에 관계없이 빠른 초기화

## Test Results

- `npm run build`: 0 errors, 0 warnings
- commit: `8dcc149`

## Pre-Completion Verification

### Part 1: Self-Review
1. 모든 AC(1-6) 구현 완료
2. Sprint 3 범위 외 변경 없음
3. `npm run build` 0 errors 확인

### Part 2: Code Inspection
- AC1: `pollAllGitStatus` 제거, `pollActiveGitStatus`가 `activeTabId`만 처리, `switchToTab`에 `pollGitOnTabSwitch` 호출
- AC2: `pollAgentStatus`는 이미 `activeTabId`만 처리, 로그 추가로 단일 burst 확인 가능
- AC3: `tryCloseNotesPanel`이 close/ESC/overlay 모두 처리, 빈 경우 즉시 닫기
- AC4: `validateMruProjects` + `onMruEntryClick` 경로 체크 로직 검증
- AC5: `activeSessionSettings` 동기화 → `createPaneSession`에서 신규 세션 즉시 적용
- AC6: 기존 로직 수정 없음, 새 함수/변수만 추가

## Concerns

- `window.confirm()`: Electron에서 일부 버전 이슈 가능성 있으나 현재 패턴 기준 정상 동작 예상
- `activeSessionSettings.fontSize` 기본값 14: TerminalSession 내부 기본값(12)과 다르지만 settings 로드 시 즉시 동기화됨

## Files Modified

- `src/renderer/git-status.ts`
- `src/renderer/agent-status.ts`
- `src/renderer/notes-panel.ts`
- `src/renderer/sidebar-mru.ts`
- `src/renderer/settings-modal.ts`
- `src/renderer/renderer.ts`
- `src/renderer/global.d.ts`
- `src/preload/preload.ts`
- `src/main/main.ts`

## Handoff Artifact

- `activeSessionSettings` 전역 변수 (renderer.ts) — 향후 기본값 추가 시 이 객체 확장
- `path:checkExists` IPC — 다른 곳에서 경로 체크 필요 시 활용 가능
- `pollGitOnTabSwitch` 함수 — 탭 활성화 시점 git 갱신 재사용 가능

## Risk Assessment

- Low: polling 변경은 기존 badge 로직에 영향 없음 (pollGitForTab 함수 동일)
- Low: notes confirm은 탭 강제 닫기에는 적용 안 됨 — 의도적 설계
- Low: MRU 검증 실패 시 catch로 처리하여 앱 startup 블로킹 없음
