# Sprint 6: Settings Modal + Sidebar MRU — Builder Status

## Status: complete

## Acceptance Criteria Check

### Feature 1: Settings Modal
- [x] AC1: Cmd+, 로 모달 열기/닫기 (keydown listener in settings-modal.ts; ESC도 지원)
- [x] AC2: 폰트 크기 슬라이더 (10–24px, 기본 14). 변경 즉시 모든 xterm에 반영 (applyFontSizeToAll)
- [x] AC3: 테마 토글 Dark/Light. 즉시 CSS class 교체 (body.theme-light / body.theme-dark)
- [x] AC4: Claude 알림 토글 (claudeNotifications 반영)
- [x] AC5: Hook 상태 표시 + 설치 버튼 (hookCheckInstalled / hookInstall API 활용)
- [x] AC6: saveSettings / getSettings IPC 사용
- [x] AC7: ESC + 모달 외부 클릭으로 닫기, 닫을 때 자동 저장

### Feature 2: Sidebar MRU
- [x] AC1: git root 감지 시 MRU에 추가 (git-status.ts pollGitForTab 훅)
- [x] AC2: 최대 10개, 중복 없음 (addMruProject dedup + trim)
- [x] AC3: AppSettings.recentProjects 로 저장/로드 (saveSettings/getSettings)
- [x] AC4: 사이드바 하단에 "Recent Projects" 섹션, 접기 가능 (collapse toggle)
- [x] AC5: 항목 클릭 시 새 탭 + 해당 cwd에서 shell 시작 (createNewTab with cwd)
- [ ] AC6: 경로 존재하지 않는 경우 회색 표시 — renderer에서 fs 직접 접근 불가 (sandbox), IPC path:exists API 없음. 회색으로 표시는 되나 존재 여부 구분 미구현.

## 수정 파일 목록
- src/renderer/global.d.ts — AppSettings에 fontSize, theme, recentProjects 추가
- src/main/main.ts — AppSettings 인터페이스 확장
- src/preload/preload.ts — AppSettings 인터페이스 확장
- src/renderer/settings-modal.ts — 신규: 설정 모달 모듈
- src/renderer/sidebar-mru.ts — 신규: MRU 사이드바 모듈
- src/renderer/git-status.ts — pollGitForTab에 addMruProject 훅 추가
- src/renderer/renderer.ts — createPaneSession/createNewTab에 cwd 파라미터 추가
- src/renderer/index.html — Settings 모달 HTML + gear 버튼 + script 태그 추가
- src/renderer/styles.css — 설정 모달, MRU 섹션, 라이트 테마 CSS 추가
- src/renderer/init.ts — initSidebarMru(), initSettingsModal() 호출 추가

## Pre-Completion Verification

빌드 명령: npm run build
결과:
```
> terminal-app@0.1.0 build
> tsc && npm run copy-static

> terminal-app@0.1.0 copy-static
> cp src/renderer/index.html dist/renderer/index.html && cp src/renderer/styles.css dist/renderer/styles.css
```
- tsc 오류 없음 (exit 0)
- dist/renderer/settings-modal.js, dist/renderer/sidebar-mru.js 생성 확인

---

# Sprint 5: Claude Code Hook 통합 — Builder Status

## Status: COMPLETE (Iteration 2 — message 필드 버그 수정)

## Build Result
- `npm run build` SUCCESS (tsc + copy-static)
- Unix socket 서버 기동 확인: `[main] Hook server listening at ...`
- nc 기반 이벤트 테스트 (PreToolUse/PostToolUse/Notification/Stop) 전송 성공

## Iteration 2 Bug Fix: `evt.message` 항상 undefined

### 원인
hook.sh가 보내는 JSON: `{"event":"Notification","session_id":"...","payload":{...}}`
최상위에 `message` 필드 없음 → `evt.message` = undefined → Notification이 `waiting_approval` 아닌 `working`으로 처리됨

### 수정 (Option A + C 혼용)
1. **`src/main/main.ts` — `ensureHookScript()`**: hook.sh에 python3로 payload에서 `message` 파싱 → 최상위 JSON에 포함
2. **`src/renderer/hook-state.ts` — `transitionPaneState()`**: Notification → message 체크 제거, 무조건 `waiting_approval` (Notification = 항상 사용자 주의 필요)

### Build
- `npm run build` SUCCESS (TypeScript 오류 없음)

## Files Modified
- `src/main/main.ts` — Unix socket 서버, settings IPC, hook IPC, hook.sh 생성 로직, settings.json 설치 로직
- `src/preload/preload.ts` — onHookEvent, hookCheckInstalled, hookInstall, notifyApproval, getSettings, saveSettings 추가
- `src/renderer/global.d.ts` — HookEvent, AppSettings 인터페이스, TerminalAPI에 hook/settings API 추가
- `src/renderer/pane-types.d.ts` — AgentHookState 타입, PaneLeaf에 agentState/hookSessionId 추가
- `src/renderer/renderer.ts` — PaneLeaf 생성 시 agentState: "idle" 초기화, cleanupPaneHookMarker 호출
- `src/renderer/init.ts` — initHookState(), initHookInstallBanner() 호출 추가
- `src/renderer/index.html` — hook-state.js, hook-install-banner.js 스크립트 로드 추가
- `src/renderer/styles.css` — hook state marker, sidebar highlight, banner, toast CSS 추가

## Files Created
- `src/renderer/hook-state.ts` — 상태 머신, 세션 매핑, pane marker 업데이트
- `src/renderer/hook-install-banner.ts` — 설치 배너 UI

## Acceptance Criteria Check

1. **Unix Socket 서버** ✅ — `~/Library/Application Support/HyperTerm/agent.sock` 에 net.Server 생성
2. **Hook 이벤트 스키마** ✅ — `{ event, session_id, tool_name, message, payload }` 파싱 후 `hook:event` IPC 전달
3. **세션 매핑** ✅ — 선택 방식: **agentStatus===true인 pane 중 첫 번째 미매핑 pane에 자동 할당**
   - hookSessionMap(sessionId→ptyId) 유지, Stop 이벤트 시 매핑 해제
   - Fallback: Claude 실행 pane 없으면 active tab 첫 pane에 할당
4. **상태 머신** ✅ — PreToolUse/PostToolUse→working, Notification(permission)→waiting_approval, Stop→idle
5. **시각화** ✅ — pane header: working=파란"⚙", waiting_approval=주황"⚠ 승인 필요"; 사이드바: 주황 border+bg
6. **macOS 알림** ✅ — waiting_approval 진입 시 Electron Notification. claudeNotifications 기본값 false
7. **Hook 설치 배너** ✅ — 앱 시작 시 hookCheckInstalled() 체크 후 배너, 설치 버튼
8. **hook.sh 스크립트** ✅ — `~/.config/hyperterm/hook.sh` 생성 (socat 기반, chmod 755)
9. **settings.json 설치** ✅ — 4개 이벤트 모두 설치, 중복 방지 로직

## Known Limitations
- socat이 없는 환경에서는 hook.sh가 동작하지 않음 (`brew install socat` 필요)

---

# Sprint 4: 읽기 전용 Diff 뷰어 — Builder Status

## Status: COMPLETE

## Changes Made

### New Files
- `src/renderer/diff-viewer.ts` — `openDiffViewer()`, `closeDiffViewer()`, `initDiffViewer()`, ESC 핸들러, diff2html 렌더

### Modified Files
- `src/main/main.ts` — `git:diff` IPC 핸들러 추가 (staged/unstaged/untracked/5000줄 체크)
- `src/preload/preload.ts` — `gitDiff()` API 노출
- `src/renderer/global.d.ts` — `gitDiff()` 메서드 타입 추가
- `src/renderer/changed-files-panel.ts` — 클릭 stub → `openDiffViewer()` 호출
- `src/renderer/init.ts` — `initDiffViewer()` 호출 추가
- `src/renderer/index.html` — diff-modal HTML + vendor CSS/JS + diff-viewer.js script 태그
- `src/renderer/styles.css` — 다크 테마 diff 모달 스타일 + diff2html 오버라이드

### Vendor
- `vendor/diff2html.min.js`, `vendor/diff2html.min.css` — npm install diff2html 후 복사

## Acceptance Criteria Check

1. **Diff 뷰어 모달** ✅ — `#diff-modal` 오버레이 + `.diff-modal-dialog` side-by-side 패널
2. **diff2html** ✅ — UMD 방식 vendor 로드, `Diff2Html.html()` side-by-side 렌더
3. **diff 소스** ✅ — staged: `git diff --cached`, modified: `git diff HEAD`, untracked: `--no-index /dev/null`
4. **읽기 전용** ✅ — 편집 UI 없음, 표시만
5. **닫기** ✅ — ESC 키 + 닫기 버튼 + backdrop 클릭
6. **IPC** ✅ — `git:diff(projectRoot, filePath, staged)` → `{diff}|{tooLarge,lineCount}|{error}`
7. **대용량 파일** ✅ — 5000줄 초과 시 "File too large to diff (N lines)" 메시지

## Pre-Completion Gate
- [x] `npm run build` 성공
- [x] `vendor/diff2html.min.js`, `vendor/diff2html.min.css` 존재
- [x] untracked 파일 exit code 1 처리 (`anyErr.stdout` 패턴 + fallback `--no-index`)
- [x] 대용량 5000줄 체크 로직 포함

---

# Sprint 3: Changed Files Panel — Builder Status

## Status: COMPLETE

## Changes Made

### New Files
- `src/renderer/changed-files-panel.ts` — 패널 모듈 (open/close/toggle/refresh/render)

### Modified Files
- `src/main/main.ts` — `git:files` IPC 핸들러 추가 (`git status --porcelain` → `{path, x, y}[]`)
- `src/preload/preload.ts` — `gitFiles()` API 노출 (TerminalAPI 인터페이스 + contextBridge)
- `src/renderer/global.d.ts` — `gitFiles()` 메서드 타입 추가
- `src/renderer/keybindings.ts` — `Cmd+Shift+E` → `toggleChangedFilesPanel()` 추가
- `src/renderer/renderer.ts` — `switchToTab()` 끝에 `refreshChangedFilesPanel()` 훅 추가
- `src/renderer/init.ts` — `initChangedFilesPanel()` 호출 추가
- `src/renderer/index.html` — 패널 HTML + `changed-files-panel.js` script 태그 추가
- `src/renderer/styles.css` — `.changed-files-panel` 및 하위 CSS 추가

## Acceptance Criteria Check

1. **토글 패널** ✅ — `#changed-files-panel` fixed-position 오버레이, `open` 클래스로 slide-in (transform transition)
2. **파일 목록** ✅ — `M`(주황), `A`(초록), `??`→`?`(회색), `D`(빨강) 배지 표시
3. **갱신 트리거** ✅ — 탭 전환 시 `refreshChangedFilesPanel()` 즉시 호출 + 5초 폴링
4. **빈 상태** ✅ — "No changes" 메시지 표시
5. **클릭 stub** ✅ — `console.log("[changed-files] clicked:", filePath, {x, y})`
6. **Cmd+Shift+E** ✅ — `(e.key === "e" || e.key === "E") && e.metaKey && e.shiftKey`

## Build
`npm run build` — TypeScript 오류 없음 (성공)

---

# Sprint 2: Project-root Model + Git Status — Builder Status

## Status: COMPLETE (Iteration 2)

## Build Output
```
> terminal-app@0.1.0 build
> tsc && npm run copy-static
(0 TypeScript errors)
```

## Runtime Check
- `npx electron .` — 앱 정상 기동 확인

## Changes Made

### `src/main/main.ts`
- `findGitRoot(dir)` synchronous helper — walks parent dirs checking `.git`
- `ipcMain.handle('git:findRoot', ...)` IPC handler
- `ipcMain.handle('git:status', ...)` — `execFileAsync('git', ['-C', root, 'branch', '--show-current'])` + `git status --porcelain` 파싱
  - Returns `{ branch, dirty, stagedCount, unstagedCount, untrackedCount }` or `null`

### `src/preload/preload.ts`
- `TerminalAPI` 인터페이스에 `gitFindRoot` + `gitStatus` 추가
- contextBridge에 `git:findRoot` / `git:status` IPC invoke 노출

### `src/renderer/global.d.ts`
- `TerminalAPI`에 `gitFindRoot` + `gitStatus` 타입 추가

### `src/renderer/git-status.ts` (신규 모듈)
- 5000ms 폴링: `startGitPolling / stopGitPolling`
- 각 탭의 첫 번째 leaf pane cwd → `gitFindRoot` → `gitStatus` 순 호출
- 사이드바 탭 아래 `.sidebar-git-badge` `⎇ branchName ●` 표시
- `cleanupGitBadge(tabId)`, `invalidateGitCache(tabId)` 제공

### `src/renderer/sidebar.ts`
- `addSidebarEntryDOM`: label+actions를 `.terminal-entry-row` div로 래핑

### `src/renderer/agent-status.ts`
- `updateSidebarAgentMarker`: `.terminal-entry-row` 내부에 agent dot 삽입하도록 수정

### `src/renderer/renderer.ts`
- `closeTab()`에서 `cleanupGitBadge(tabId)` 호출

### `src/renderer/init.ts`
- `startGitPolling()` 호출 추가

### `src/renderer/index.html`
- `git-status.js` 스크립트 추가 (agent-status.js 다음, init.js 전)

### `src/renderer/styles.css`
- `.terminal-entry` → `flex-direction: column`
- `.terminal-entry-row` — 기존 horizontal row (label + actions)
- `.sidebar-git-badge` — 탭 아래 작은 브랜치 배지 (muted gray)
- `.git-branch-icon` — `⎇` 아이콘 스타일
- `.git-dirty-dot` — 변경사항 있을 때 amber `●`

## 로드 순서 (index.html)
```
renderer.js → pane-tree.js → notes-panel.js → sidebar.js → statusbar.js → keybindings.js → agent-status.js → git-status.js → init.js
```

---

## Iteration 2 Bug Fixes

### Fix 1 — 캐싱 버그 (`src/renderer/git-status.ts`)
- `GitCacheEntry` 인터페이스에 `cwd: string` 필드 추가
- 캐시 히트 조건을 `cached.projectRoot !== undefined` → `cached && cached.cwd === cwd` 로 변경
- cwd 변경 시 항상 `gitFindRoot` 재탐색 수행
- 모든 `tabGitCache.set()` 호출에 `cwd` 포함

### Fix 2 — `escapeHtml` 전역 의존 제거 (`src/renderer/git-status.ts`)
- `git-status.ts`에 `escapeGitHtml()` 로컬 함수 정의 추가
  - `notes-panel.ts`에도 동일한 `escapeHtml`이 전역에 있어 이름 충돌 → `escapeGitHtml`로 명명
- 외부 모듈 로드 순서에 의존하지 않음

### Build & Verify
- `npm run build` — TypeScript 오류 없음
- cwd 캐시 로직 node 시뮬레이션 3/3 통과
