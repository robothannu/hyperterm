# Work Progress

## Current Task
- **completed** — New Project 플로우 개편:
  - parent directory를 OS 디렉터리 선택창으로 고르게 변경
  - git init은 항상 수행
  - Claude / Codex 선택에 따라 초기 파일 생성 분기
  - Codex는 `AGENT.md` + `codex-handoff.md` 생성
  - dashboard card는 `codex-handoff.md`를 읽어 Codex 상태를 갱신
  - `npm run build`, `npm run dist`, 관련 테스트 통과

## Last Session (2026-05-06 ~ 05-07)

### 1. Session Restore 기능 완전 제거 (commit da699f3)
사용자 보고: hypersim3_ide 그룹에 `—— restored from previous session (...) ——` divider 7개 누적.
원인: `snapshot-capture.ts`의 strip 정규식이 SerializeAddon 직렬화 결과(`\x1b[m` / `\x1b[22m` 변형)와 안 맞음.
사용자 결정: 기능 자체 제거.
- 삭제: `src/renderer/snapshot-capture.ts`, `src/main/snapshot-store.ts`
- `@xterm/addon-serialize` 의존성 제거 (uninstall + index.html script 태그 제거)
- 30s 자동 저장, 종료 시점 캡처, divider 모두 제거 → 누적 버그 자연 해소
- SavedPaneLeaf의 `scrollback?`, `snapshotSavedAt?` 필드 제거. 기존 sessions.json scrollback은 다음 save 때 자연 소멸.

### 2. handoff.md fallback (commit da699f3)
- `workspace-reader.ts:extractTaskFromContent`에 짧은 헤더 fallback 추가:
  - `## Current` (codex/handoff 친화)
  - `## Next` (단축형, `## Next Steps`보다 후순위)
- 결과: ocr_app_ios의 handoff.md 템플릿(옵션 A)에서 Current/Next 자동 매칭 확인.
  - dev 로그: `summarizeOverview: currentTask fallback="## Current" for /Users/davidhan/minimax_workspace/ocr_app_ios`
- ocr_app_ios에 `handoff.md` placeholder 생성 (Current 빈 본문 + Next 3 항목).
- quizplatform에 AGENT.md 추가 (CLAUDE.md 복사) → 카드 마커 Mixed 전환.

### 3. 10항목 audit (Plan/Build/Evaluate 대신 정적 두 패스)
- **Agent A (모듈화/품질)**: dashboard.ts 7분할 권고, pty-manager*/agent-status* 거울 코드 base 추출 권고, `(window as any)` 30+건 → Window augmentation 1회 처방.
- **Agent B (데이터/IPC/버그)**: HIGH 0, MEDIUM 4 (A.4 dedup raw 비교, D.2 _teardownAll 누락 timer, D.5 newProject 부분 실패 침묵, C.4 cross-tool 빈 컨텍스트), LOW 4 (A.3 v1 schema, B.1 codex pty 핸들러 누락, D.4 ID overflow, D.6 taskText 길이).

### 4. Phase 1 — 작은 패치 (commit 14055d8)
| 항목 | 위치 | 변경 |
|---|---|---|
| `(window as any)` 25건 | dashboard*.ts | global.d.ts에 Window augmentation 1회로 일괄 정리 |
| A.4 dedup normalize | renderer.ts | `normalizeCwd` helper 추가, 비교/저장 4곳에 적용 |
| D.2 timer leak | renderer.ts, changed-files-panel.ts, activity-log.ts | `_teardownAll`에 stopChangedFilesAutoRefresh / stopActivityRefresh + 모든 leaf에 pane-destroy dispatch (cwdPollTimer) |
| D.5 newProject warnings | main.ts, dashboard-newproject.ts | `result.warnings: string[]` 추가 → toast로 사용자 노출 |
| C.4 cross-tool confirm | dashboard.ts | `confirmCrossTool(clicked, workspaceTool)` helper, footer/list 두 곳 적용 |
| A.3 v1 schema 신호 | renderer.ts | 미지원 version 발견 시 `console.warn` |
| 죽은 export 제거 | pty-manager.ts, pty-manager-codex.ts | `getSessionPid`, `getActiveSessionIds` 삭제 |

### 5. Phase 2 — 거울 코드 통합 (commit 7fc5661)
- 신규 `src/main/pty-manager-base.ts` (271 lines):
  - SessionEntry, SessionStore factory(write/resize/destroy/destroyAll/sessionKey/has/cwd)
  - findInProcessTree(rootPid, depth, binary, nodeFragment) — claude/codex 공통 BFS
  - isCommandAvailable(cmd), buildSessionEnv, resolveSessionCwd, getInteractiveShell
- `pty-manager.ts`: 443→203 (claude spawn + 공통 ops 위임)
- `pty-manager-codex.ts`: 314→116 (codex spawn + 공통 ops 위임)
- 공개 API(main.ts에서 호출하는 export)는 그대로 유지.
- agent-status common factory + main.ts pty:create* 통합은 ROI 낮아 skip.

### 6. Phase 3 — 큰 파일 분할 (commit 015a395, 8b7b100)
| 모듈 | Lines |
|---|---|
| dashboard.ts | 2259 → 1588 (−30%) |
| dashboard-newproject.ts | 661 |
| dashboard-gitflow.ts (신규) | 423 |
| dashboard-discovery.ts (신규) | 272 |
| dashboard-autorefresh.ts | 108 |
| dashboard-sidebar.ts | 16 |

`dashboard-gitflow.ts` 책임:
- 캐시(`_gitFlowCache`, `_gitFlowInflight`) + `clearGitflowCache()`
- 렌더(LANE_*, gitflowLaneKey, gitflowAssignLanes, renderGitflowSVG, paintGitflowInto)
- 모달(_gitflowModal*, openGitflowModal, closeGitflowModal, setGitflowZoom(Fit))
- ensureGitflowForWorkspace, initGitflowModalControls
- 자체 keydown listener (ESC/+/-/0/F, 모달 open 시에만 fire)

`dashboard-discovery.ts` 책임:
- 상태(`_discoveryCandidates`, `_discoveryDismissed`)
- fetch / banner render / Review modal / batch add / initDiscoveryModalControls

dashboard.ts → 두 모듈에 declare로 cross-script 함수 호출. _workspaces / _expandedIds / _filter / _search / _homeDir 같은 var globals은 script 모드 same-window scope 공유.

### 검증
- 매 phase tsc 0 errors, npm run build 통과
- dev 모드 boot 로그에 ReferenceError/TypeError 없음, gitflow 모듈 정상 로드.
- 기존 release/HyperTerm-0.1.0-arm64.dmg(05-06 22:11)은 phase 1-3 미반영.

## Next Steps
- [ ] **HIGH: 새 프로젝트 모달 실사용 검증**
  - `release/mac-arm64/HyperTerm.app`에서 아이콘 클릭 후 새 프로젝트 생성
  - macOS 디렉터리 선택창이 뜨는지 확인
  - Claude / Codex 선택에 따라 `CLAUDE.md` / `AGENT.md` + `codex-handoff.md`가 생기는지 확인
  - 생성 직후 dashboard 카드와 tool 표시가 바로 갱신되는지 확인
- [ ] **MEDIUM: 남은 UI 검증**
  - 카드 expand → Git Flow 트리거(`paintGitflowInto`) + 모달 zoom/keyboard
  - Discovery 배너 + Review 모달 + batch add
  - cross-tool 카드(예: codex 워크스페이스에서 Claude 클릭) → confirm 다이얼로그
  - Run with Claude/Codex dedup (path normalize 적용 후 trailing slash 흡수)
- [ ] **MEDIUM (남은 audit 권고, 미진행)**:
  - main.ts 4-5분할 (1800 lines, IPC 핸들러 결합도 높음 — 분할 시 위험 평가 필요)
  - workspace-reader.ts:summarizeOverview 235줄 → 섹션별 분할
  - dashboard.ts cards/render/handlers/meta 분할 (populateCardData 229줄, renderCard 125줄)
  - agent-status common factory (claude/codex 알고리즘 차이 있음)
  - subagent-watcher debounce 50-100ms
  - sidebar.ts (terminalList as any).__delegationInstalled 패턴 정리
- [ ] **LOW**: codex `pty:getProcessInfo`/`pty:getAgentStatus`에 hasSession 분기 가드 또는 명시 주석
- [ ] **LOW (이전부터 누적)**:
  - dashboard.ts 추가 분할 후보 (cards 가장 위험)
  - codexNotifications 실제 gating, hook-state.ts:159 done 8s clear codex 가드
  - Block-style 출력 (OSC 133)
  - gitflow cache invalidation 자동화, lane overflow

## Key Decisions

### 이번 세션 결정
- **Session Restore 통째 제거**: divider 누적 fix 시도(정규식 완화) 대신 기능 자체 제거. 사용자 의도가 "안 쓴다"이므로 strip 정규식만 손보는 부분 수정보다 깔끔.
- **handoff.md 헤더 = 옵션 A**: 짧은 `## Current` / `## Next` 채택. progress.md 컨벤션과 충돌하지 않게 fallback 끝쪽에 배치 (Current Task / Current Status / Status보다 후순위).
- **quizplatform: 옵션 2 (Mixed) 선택**: AGENT.md 신규 추가, CLAUDE.md 그대로 복사. 도구 분담 가이드는 향후 필요 시.
- **거울 코드 통합 범위**: pty-manager 두 파일만 base 추출. agent-status 두 파일은 알고리즘이 다른 책임(IPC fail counter + 전체 탭 vs prev-cache + 필터 + per-pane silent fail)이라 ROI 낮음으로 skip. main.ts pty:create* 핸들러 통합도 IPC 시그니처가 달라 skip.
- **dashboard.ts 분할 범위**: gitflow + discovery 두 분할만 진행. cards/render/handlers/meta는 populateCardData(229줄) 등 dashboard.ts 본문 흐름과 결합도가 높아 다음 sprint로 미룸.
- **분할 패턴**: dashboard 자식 모듈은 모두 `<script>` (non-module) 모드 + `declare` cross-file globals. 같은 window scope에서 `var` 공유. dashboard.html script 순서 의존(자식이 dashboard.js 다음).
- **cross-tool confirm vs disable**: confirm 채택. 사용자 의도 확인이 가능하면서 정상 케이스(Mixed/같은 도구) 흐름은 끊지 않음.
- **A.3 v1 schema**: 자동 마이그레이션 안 함, 명시적 console.warn만 추가. v1 사용자 거의 없을 것 + 빈 상태 fallback이 데이터 손상 측면 중성적.

### (이전 세션 결정 유지)
- argv 배열 인자 + path 3중 검증으로 command injection 차단 (pty-manager-base 추출 후에도 유지)
- 모든 그룹의 cwd 자동 저장 (snapshot 제거 후에도 cwd만 유지 — saveSessionMetadata)
- claude PTY ID 1+, codex PTY ID 50000+ 분리 (pty-manager-base SessionStore factory의 idStart 인자)
- Run with Claude dedup 정책 (claudeCwd 단일 source of truth, 정확 매치)
- 카드 footer `[Claude] [Codex] [Open]` 3버튼 패턴

## Harness State
- Phase: idle
- Feature: -
- Branch: -
- Sprint: -
- Resume: `/harness` (다음 기능 요청 시)
- 참고: 이번 세션은 audit 기반 리팩터링이라 harness 미적용. 5 commit 모두 sprint 합성 없이 phase 단위로 직접.

## Blockers / Notes
- **사용자 시각 검증 필요** — phase 1-3 변경 영향 영역 전체 (gitflow 모달, discovery 배너, cross-tool confirm, dedup, teardown 누수)
- main과 origin/main 동기화 필요 — 현재 ahead 35 commits 추정 (push 미수행)
- macOS arm64 전용 — Cursor 외 IDE 자동 감지 미지원
- workspaces.json: `~/Library/Application Support/HyperTerm/workspaces.json`
- sessions.json: 같은 디렉토리. SavedPaneLeaf에서 scrollback / snapshotSavedAt 필드 제거됨 (Phase에서)
- dashboard.ts 1588 lines (2259→) — 추가 분할 가능 (cards/render/handlers/meta)
- pty-manager-base.ts 271 lines — 향후 다른 CLI 추가(예: aider) 시 같은 패턴으로 spawn 매니저만 작성하면 됨
