# Work Progress

## Current Task
- 완료 (코드 리뷰 이슈 15개 전체 수정 + 사이드바 개선)

## Last Session (2026-04-19)

### 사이드바 텍스트 오버플로우 & 리사이즈 (pre-harness)
- `.terminal-label` — `white-space: nowrap` 제거 → `word-break: break-all` 적용 (긴 브랜치명 wrapping)
- `#sidebar` resize handle 추가 — 드래그로 150~500px 조정, `localStorage` 저장
- `src/renderer/sidebar-resize.ts` 신규 모듈 생성

### 코드 리뷰 이슈 15개 수정 (harness 3-sprint, 브랜치 `feature/code-review-fixes` → `2d_gui` 머지)

**Sprint 1: Leak & Lifecycle Hygiene (28/30)**
- `sidebar.ts` — event delegation 패턴 전환 (`#terminal-list`에 7개 리스너 ONE-TIME 설치, `__delegationInstalled` 가드)
- `renderer.ts` — `_teardownAll()` 추가, `beforeunload` + `onBeforeQuit` 연결 (ResizeObserver, polling, keydown 해제)
- `keybindings.ts` — named handler → `teardownKeybindings()` 추가
- `renderSidebar()` 버그 수정: `innerHTML=""` 후 빈 DOM에서 tabId 읽던 것 → `tabMap.keys()` 사용

**Sprint 2: Correctness & Failure Visibility (27/30)**
- `renderer.ts` — `createNewTab()` try-catch: 실패 시 tabMap/tabLabels/tabClusters/ptyToTab/DOM 전체 rollback + `showToast()` 표시
- `renderer.ts` — `closePaneByPtyId()` race condition 수정, `splitFocusedPane()` DOM rollback
- `agent-status.ts` — FAIL_SENTINEL 패턴, 연속 3회 실패 시 statusbar indicator + throttled console.warn
- `hook-state.ts` — `KNOWN_HOOK_EVENTS` Set, 미지정 이벤트 `console.warn` + state 무변경
- `changed-files-panel.ts` — `typeof` 런타임 검사 제거

**Sprint 3: Polling Efficiency & UX Polish (27/30)**
- `git-status.ts` — `pollAllGitStatus` 제거 → `pollActiveGitStatus()` (activeTabId만), `pollGitOnTabSwitch()` 탭 전환 시 on-demand
- `agent-status.ts` — activeTabId 전용 polling 로그 추가
- `notes-panel.ts` — `tryCloseNotesPanel()`: 미저장 텍스트 시 `window.confirm()`, 취소/폐기 처리 (close버튼·ESC·overlay 모두)
- `sidebar-mru.ts` — `path:checkExists` IPC, `validateMruProjects()` 앱 로드 시 실행, 클릭 시 showToast
- `settings-modal.ts` + `renderer.ts` — `activeSessionSettings` 전역, 신규 세션 생성 시 적용

## Next Steps
- [ ] **HIGH: 실제 Claude Code 연동 검증** — packaged .app에서 `claude` 실행 후 hook 이벤트 왕복 확인
- [ ] **HIGH: DevTools Memory 프로파일링** — packaged .app에서 Criterion 1·2 런타임 검증 (event listener bounded, detached node 없음)
- [ ] **MEDIUM: /Applications 배포** — `cp -r release/mac-arm64/HyperTerm.app /Applications/HyperTerm.app`
- [ ] **LOW: Settings 확장** — auto-switch on approval 토글, sound 알림 옵션
- [ ] **LOW: Diff 뷰어 prev/next** — 파일 간 연속 review 키보드 네비
- [ ] **LOW: 죽은 코드 제거** — `pty-manager.ts`의 미사용 함수들

## Key Decisions
- **Event Delegation**: sidebar `#terminal-list`에 단일 delegation. `innerHTML=""` 후에도 리스너 유지됨.
- **`_teardownAll()`**: `beforeunload`와 `onBeforeQuit` 양쪽 연결. 모든 op idempotent.
- **activeTabId-only polling**: git/agent 모두 비활성 탭 IPC 차단. 탭 전환 시 on-demand poll.
- **`activeSessionSettings`**: font/theme 전역 변수로 신규 세션에 즉시 반영.
- **`window.confirm()`**: notes 미저장 경고에 브라우저 내장 confirm 사용 (외부 의존성 없음).
- **Rename**: `tabLabels` Map이 source of truth.
- **Hook 통합**: `nc -U` (socat 불필요).

## Harness State
- Phase: complete — 코드 리뷰 이슈 전체 수정 완료 (branch merged into 2d_gui)
- Feature: -
- Branch: -

## Blockers / Notes
- macOS arm64 전용 빌드 (Intel 미테스트)
- Claude Code 연동은 HyperTerm 앱 실행 중일 때만 소켓 생성됨
- `beforeunload` + `onBeforeQuit` 이중 연결로 teardown 로그 2회 출력 가능 (idempotent, 기능 문제 없음)
- `createNewTab` catch가 `createPaneSession` 이후 동기 throw 시 일부 map 누수 가능성 (낮음)
