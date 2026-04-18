# Plan: tmux 제거 및 node-pty 직접 관리 전환

## Iteration: 1
## Project Type: web (Electron desktop app)
## Strategy: NEW

## Goal
tmux 의존성을 완전히 제거하고, 각 터미널 세션을 node-pty로 직접 shell spawn하여 관리한다. 앱 종료 시 세션은 소멸되며(사용자 동의 완료), xterm.js가 scrollback을 직접 관리한다.

## Sprints

### Sprint 1: pty-manager.ts 재작성 — node-pty 직접 spawn
**Deliverable**: tmux 없이 node-pty가 직접 shell을 spawn하고, 기존 IPC 인터페이스와 호환되는 pty-manager

**Acceptance Criteria** (sprint contract):
1. [ ] `createSession()`이 tmux 없이 node-pty로 사용자의 기본 shell(`$SHELL`)을 직접 spawn한다
2. [ ] `createSession()`의 반환값이 `{ id, sessionKey }` 형태이며, sessionKey는 세션을 식별할 수 있는 고유 문자열(예: `session-1`)이다. 기존 코드에서 `tmuxName`으로 참조하던 부분과 호환된다
3. [ ] `writeToSession(id, data)`가 해당 pty에 데이터를 전달한다
4. [ ] `resizeSession(id, cols, rows)`가 해당 pty의 크기를 변경한다
5. [ ] `destroySession(id)`가 해당 pty process를 kill하고 맵에서 제거한다
6. [ ] `getCwd(id)`가 pty process의 PID를 기반으로 macOS에서 현재 작업 디렉토리를 반환한다 (`lsof -p <pid> -Fn | grep '^n/' | grep 'cwd'` 또는 동등한 방식)
7. [ ] `destroyAll()`이 모든 pty process를 kill한다
8. [ ] `getProcessInfo(id)`가 pty process의 PID를 직접 사용하여 CPU/메모리 정보를 반환한다
9. [ ] tmux 전용 함수들(`isTmuxAvailable`, `listTmuxSessions`, `getTmuxSessionCwd`, `getTmuxSessionName`, `getTmuxPaneCurrentCommand`, `getTmuxPanePid`, `renameTmuxSession`, `listPanes`, `selectPane`, `splitPane`, `closePane`, `scrollSession`, `exitCopyMode`, `sendTmuxKey`, `sendTextToTmux`, `startTmuxSearch`, `navigatePane`)이 모두 제거된다
10. [ ] tmux 관련 import(`execSync`, `execFile`의 tmux 용도)와 상수(`TMUX_SOCKET`)가 제거된다
11. [ ] `npm run build`가 타입 에러 없이 통과한다

### Sprint 2: main.ts IPC + preload.ts + global.d.ts 정리
**Deliverable**: tmux 관련 IPC 핸들러를 제거하고, preload 브릿지와 타입 정의를 node-pty 직접 관리에 맞게 갱신

**Acceptance Criteria** (sprint contract):
1. [ ] main.ts에서 다음 IPC 핸들러가 모두 제거된다: `tmux:check`, `tmux:list`, `tmux:listPanes`, `tmux:selectPane`, `tmux:splitPane`, `tmux:closePane`, `tmux:navigatePane`, `tmux:scroll`, `tmux:exitCopyMode`, `tmux:sendKey`, `tmux:renameSession`, `tmux:getSessionName`, `tmux:getPaneCommand`, `tmux:getProcessInfo`
2. [ ] `pty:create` 핸들러가 `tmuxSession` 파라미터를 받지 않으며, 새 pty-manager의 `createSession()`을 호출한다
3. [ ] `pty:getCwd`가 새 pty-manager의 CWD 조회 방식을 사용한다
4. [ ] `app:quit-ready` 핸들러에서 `destroyAll()`을 호출한다 (세션 persist 없이 모든 pty 종료)
5. [ ] `pty:getProcessInfo` IPC 핸들러가 pty ID 기반으로 추가된다 (tmuxName 대신)
6. [ ] preload.ts에서 tmux 관련 API가 모두 제거된다: `isTmuxAvailable`, `listTmuxSessions`, `listPanes`, `selectPane`, `splitPane`, `closePane`, `navigatePane`, `scrollTmux`, `exitCopyMode`, `sendTmuxKey`, `renameTmuxSession`, `getTmuxSessionName`, `getPaneCommand`
7. [ ] preload.ts의 `createPty` 시그니처에서 `tmuxSession` 파라미터가 제거되고, 반환 타입이 `{ id: number; sessionKey: string }`이다
8. [ ] preload.ts의 `getProcessInfo`가 pty ID(number)를 받도록 변경된다
9. [ ] global.d.ts의 `TerminalAPI` 인터페이스가 새 API에 맞게 갱신된다 (tmux 관련 메서드 제거, 시그니처 변경)
10. [ ] notes IPC에서 키가 sessionKey를 사용한다 (기존 tmuxName과 동일한 역할)
11. [ ] `npm run build`가 타입 에러 없이 통과한다

### Sprint 3: renderer.ts + terminal-session.ts 갱신 및 통합 검증
**Deliverable**: renderer가 tmux 없이 node-pty 직접 관리 방식으로 동작하며, xterm.js scrollback이 활성화되고, 앱이 정상 실행된다

**Acceptance Criteria** (sprint contract):
1. [ ] terminal-session.ts의 `scrollback`이 0에서 10000으로 변경된다
2. [ ] renderer.ts에서 `sessionTmuxNames` 맵이 `sessionKeys` 맵(또는 동등한 이름)으로 변경되어 sessionKey를 저장한다
3. [ ] `createPaneSession()`에서 tmuxSession 파라미터가 제거되고, `createPty(cols, rows, cwd)` 형태로 호출된다
4. [ ] tmux 세션 이름 기반 pane title polling(`getPaneCommand`, `getTmuxSessionName` 호출)이 제거된다. pane 제목은 사용자가 설정한 이름 또는 기본 "Terminal" 표시
5. [ ] pane header 더블클릭 rename에서 `renameTmuxSession` 호출이 제거되고, 로컬 상태(`sessionKeys` 맵과 pane title)만 변경된다
6. [ ] wheel 이벤트의 tmux scrollback 프록시(`scrollTmux`)가 제거되고, xterm.js 네이티브 스크롤이 동작한다 (wheel 이벤트 캡처 리스너 제거)
7. [ ] `onData` 콜백에서 `exitCopyMode` 호출이 제거된다
8. [ ] `restoreFromTmux()` 함수가 제거되고, 앱 시작 시 `sessions.json`에서 그룹 이름/클러스터/레이아웃 구조를 읽어 각 leaf마다 새 pty를 spawn한다 (세션 내용은 복원하지 않음)
9. [ ] `saveSessionMetadata()`와 `serializePaneTree()`에서 tmuxName 대신 sessionKey를 사용한다
10. [ ] Cmd+Arrow 단축키의 tmux `navigatePane` 호출이 제거되고, 앱 내부 pane tree에서 focus를 이동하는 로직으로 대체된다
11. [ ] notes 기능이 sessionKey 기반으로 정상 동작한다 (load, save, delete)
12. [ ] `npm run build` 후 `npm run start`로 앱이 실행되어 터미널에 shell prompt가 표시되고, 명령어 입출력이 동작한다
13. [ ] 마우스 휠로 xterm.js scrollback 스크롤이 동작한다
14. [ ] 새 탭 생성(Cmd+N), 탭 전환(사이드바 클릭), 탭 닫기(X 버튼)가 정상 동작한다
15. [ ] pane split(우클릭 메뉴 > Split Horizontal/Vertical)과 pane close가 정상 동작한다
16. [ ] 앱 종료 후 재실행 시 그룹 이름과 레이아웃 구조(split 방향/비율)가 복원되고, 각 leaf에 새 shell이 spawn된다

## Architecture Blueprint (advisory)

> 이 섹션은 가이드이며, Builder가 더 나은 방법을 찾으면 변경 가능합니다.

### Affected Files
- `src/main/pty-manager.ts` — 전면 재작성. tmux 의존성 제거, node-pty 직접 shell spawn으로 전환
- `src/main/main.ts` — tmux IPC 핸들러 제거, pty:create 파라미터 변경, quit 로직 변경
- `src/preload/preload.ts` — tmux API 제거, createPty 시그니처 변경
- `src/renderer/global.d.ts` — TerminalAPI 인터페이스 갱신 (tmux 메서드 제거, 시그니처 변경)
- `src/renderer/renderer.ts` — tmux 세션 이름 기반 로직 제거, 복원 로직 변경, 스크롤 변경
- `src/renderer/terminal-session.ts` — scrollback 값 0 → 10000 변경

### Component Relationships
- pty-manager → node-pty: shell 직접 spawn (현재: tmux binary → attach)
- main.ts → pty-manager: IPC 핸들러에서 호출 (tmux IPC 제거됨)
- preload.ts → main.ts: 브릿지 (tmux API 제거됨)
- renderer.ts → preload API: tmux 의존 호출 제거, sessionKey 기반으로 전환
- renderer.ts → terminal-session.ts: scrollback 직접 사용 (tmux copy-mode 제거)

### Key Interfaces
- pty-manager `createSession(cols, rows, onData, onExit, cwd?)` → `{ id: number, sessionKey: string }`
- pty-manager `getCwd(id)` → string: macOS에서 `lsof -p <pid>` 기반 CWD 조회
- pty-manager `getProcessInfo(id)` → `{ cpu: number, memory: number }`
- preload `createPty(cols, rows, cwd?)` → `{ id: number; sessionKey: string }`
- `SavedPaneLeaf`의 식별자 필드가 tmuxName에서 sessionKey로 변경 (또는 필드명 유지 후 의미만 변경)

## UX Expectations
- 앱 실행 시 터미널이 즉시 열리고 shell 입출력이 동작해야 한다
- 마우스 휠 스크롤이 xterm.js 네이티브로 부드럽게 동작해야 한다
- 탭 생성/전환/닫기가 기존과 동일한 느낌이어야 한다
- pane split/close가 기존과 동일하게 동작해야 한다
- 앱 종료 후 재실행 시 그룹 이름과 레이아웃이 복원되어야 한다 (터미널 내용은 소멸, 사용자 동의 완료)
- tmux binary가 없어도 앱이 정상 작동해야 한다 (tmux 설치/번들링 여부 무관)

## Constraints
- bundler 미사용 환경: UMD `<script>` + declare 방식 유지
- macOS arm64 전용 타겟 (CWD 조회 방식은 macOS 기준)
- `sessions.json` 포맷 변경 시 기존 V3 포맷과의 하위 호환 고려 (기존 데이터가 있을 수 있음)
- vendor/ 디렉토리 내 tmux binary 제거는 이 작업 범위 밖 (추후 별도 정리)
- pane split은 현재 xterm.js/DOM 레벨에서 관리 중 (tmux split-window가 아님). 각 pane이 독립 pty를 가지므로 기존 구조 유지

## Pivot History
- None. 첫 번째 iteration.
