# Work Progress

## Current Task
- **completed** — Sprint C: 세션 유지 Hybrid (3 sprints, all PASS), main 머지 완료. 패키지 빌드/시각 검증은 다음 단계
- (이전) Sprint B: New Project wizard — main 머지 완료
- (이전) Sprint A: Claude 버튼 폴리시 — main 머지 + 패키지 빌드 완료

## Last Session (2026-05-05)

### 세션 흐름
1. **이전 빌드 검증** — release/HyperTerm-0.1.0-arm64.dmg가 Run with Claude / Ask Claude 커밋 이전(05-04 12:40)이라 재빌드 → 21:50 빌드
2. **사용자 이슈 제보 3건**
   - Ask Claude 인라인 버튼 텍스트/버튼 클리핑 ("Play Console에 app-release.aab 업로...드", "Ask C...")
   - Claude 버튼 매 클릭마다 새 그룹 → 같은 워크스페이스 탭 누적
   - sidebar의 Running 표시가 한 번 켜진 후 영원히 stuck (탭 전환해도 안 꺼짐)
3. **사용자 추가 제안 검토** — Dashboard "+ New Project" wizard (이전 세션 분석한 사용자 시나리오 결과). 미구현 확인. Sprint B로 분리.
4. **세션 유지 Hybrid C 합의** — A 기본 복원 + B pinned 그룹만 daemon 위탁. Sprint C로 분리.
5. **우선순위 결정**: Sprint A → B → C 순서

### Harness 결과 (브랜치: feature/claude-button-polish → main 머지 완료)

| Sprint | 점수 | 커밋 | 변경 |
|---|---|---|---|
| A 1차 (클리핑+dedup) | 33/35 | (5674aca에 통합) | dashboard.html CSS + Tab.claudeCwd 영속화 + onOpenGroupWithCwdWithClaude 매치 |
| A 2차 (Running fix) | 32/35 | (5674aca에 통합) | agent-status.ts pollAgentStatus 모든 탭 갱신 |
| sprint A | — | 5674aca | 5 files changed, +96/-16 |
| merge | — | 8696dbe | merge: sprint A |

### Files Modified (Sprint A 누적)
- `src/renderer/dashboard.html`: `.todo-item` flex-start, `.todo-text` overflow-wrap:anywhere, `.todo-ask-btn` flex:0 0 auto + nowrap
- `src/renderer/pane-types.d.ts`: `Tab` + `SavedTab` 인터페이스에 `claudeCwd?: string` 추가
- `src/renderer/renderer.ts`: createNewTab/saveSessionMetadata/restoreFromSaved/onOpenGroupWithCwdWithClaude — claudeCwd 라이프사이클 4단계
- `src/main/main.ts`: 주석만 갱신 ("dedup handled in renderer")
- `src/renderer/agent-status.ts`: pollAgentStatus 끝부분 — `tabMap.keys()` false-seed Map → OR-aggregate → 모든 (tabId, hasAgent)에 updateSidebarAgentMarker 호출

### 검증
- TypeScript build 0 errors (각 sub-task)
- Evaluator 정적 분석: claudeCwd 8회 등장(dist), CSS rules 적용 확인, polling 로직 트레이스
- adversarial 분석 (정규화 비대칭, 호출자 누락, race condition) 모두 통과
- **시각 GUI 검증은 사용자 수동 필요** — 새 빌드(`release/HyperTerm-0.1.0-arm64.dmg`, 05-05 재빌드)로

## Sprint C 결과 (2026-05-05, 머지 a11ccee)

| Sprint | Verdict | 점수 | 커밋 |
|---|---|---|---|
| 1 (Snapshot 복원, daemon 없음) | PASS | 29/35 | c59e7d5 |
| 2 (htptyd daemon 인프라, UI 노출 0) | PASS | 32/35 | 85ecb02 |
| 3 iter 2 (pinned UX + reattach + crash 복구) | PASS | 30/35 | 258410e |

누적: 20 files changed, 3097 insertions, 7 deletions.

### Sprint C 핵심 결정
- **A 기본 (Sprint 1)**: SerializeAddon으로 xterm buffer 직렬화 + 200KB tail cap (그룹 20개 ~3.91MB ≤ 5MB) + dim ANSI divider. 30s 주기 자동 저장. SavedPaneLeaf optional 필드로 Sprint A claudeCwd 보존.
- **Daemon (Sprint 2)**: htptyd 별도 long-lived process. 위치 `~/Library/Application Support/HyperTerm/daemon/` (sock/pid/log). detach = `spawn detached + unref + ELECTRON_RUN_AS_NODE=1`. idle timeout HTPTYD_IDLE_MS env (default 5분). stale = PID kill(0) + connect 검증. tmux 0건.
- **ADOPT 전략 (Sprint 3)**: Daemon-Spawn (B 변형). fd passing 회피 (Node IPty 내부 fd 접근 불가). pinned 토글 ON → daemon이 처음부터 PTY 소유.
- **라우팅 (Sprint 3 iter 2)**: pinnedSessions Map (90000+ localPtyId → xterm session) + onPtyData 핸들러 분기. terminal-session onData() IDisposable 반환으로 pin/unpin 시 콜백 dispose+재등록.
- **재시작 흐름**: reconcilePinnedTabs (daemon LIST 비교) → ATTACH (살아있음) 또는 fallback (snapshot+toast 1회). attachRestoredPinnedTab이 wirePinnedSession 호출.
- **orphan 가드**: unpin / 그룹 삭제 → KILL 즉시.

### Sprint C carryover SHOULD FIX (non-blocking, 별도 cleanup 권장)
- Sprint 1: ANSI escape mid-cap 시 divider 직전 `\x1b[0m` reset (orphan 문자 방지)
- Sprint 1: before-quit 시 worst-case `tabs × 3s lsof timeout` — tab 병렬화 또는 cwd 캡처 생략
- Sprint 2: htptyd.log rotation/cap (현재 append-only)
- Sprint 3: pinned-ui.ts:367 dead comment, cleanupPinnedOnDelete의 leaf.onDataDisposable null 미설정, attachRestoredPinnedTab fire-and-forget 실패 시 UI 알림 부재

---

## Sprint B 결과 (2026-05-05, 머지 970a37b)

| 항목 | 값 |
|---|---|
| Verdict | PASS 31/35 |
| Sprint | 1/1, Iteration 1 |
| 신규 파일 | `src/renderer/dashboard-newproject.ts` (614줄) |
| dashboard.ts diff | +23줄 (목표 50줄 이하 달성) |
| main.ts diff | +166줄 (IPC `workspace:newProject` 핸들러) |
| 그 외 | dashboard.html(+7), global.d.ts(+18), preload(+21) |
| 검증 | TypeScript 0 errors, npm run build 성공, AC 11개 라이브 검증 통과, adversarial 12건 안전 |

### Sprint B 점수 (Dim별)
- Functionality 5, UX 4 (native confirm), Visual 4, Edge 4 (server defence 약함), Perf 5, Regression 5, Code Quality 4
- MUST FIX 없음. NICE TO HAVE 8건 (서버측 입력검증 강화, trailing space 거부, validateProjectName 단위테스트, `as any` 제거, 614줄 분할 등)

### Sprint B 핵심 결정
- 모듈 격리: 신규 로직 전체를 `dashboard-newproject.ts`에 격리. dashboard.ts에는 진입점 후크만
- 보안: `execFileAsync("git", ["init", absolutePath])` argv 배열 + `path.join` + `fs.promises`. shell injection live test 통과
- AC #5 (parent 미존재): native `window.confirm`으로 사용자 의도 확인 후 재귀 mkdir + toast
- 부분 실패 정책: 자동 삭제 안 함, 사용자에게 명시 알림

## Next Steps
- [ ] **HIGH: 새 빌드로 Sprint A + B 시각 검증**
  - **Sprint A** (이전):
    - Ask Claude 인라인 버튼: 긴 텍스트(한국어/이모지/영문)에서 버튼 라벨 안 잘리는지
    - Run with Claude dedup: 같은 워크스페이스 카드 "Claude" 두 번 클릭 → 두 번째는 새 탭 안 생기고 기존 탭 switch
    - Sidebar Running: claude 띄운 탭에서 다른 탭 전환 → claude 종료 → ≤5초 Running 사라짐
  - **Sprint B (NEW)**:
    - Dashboard에 "+ New Project" 버튼 보이는지, 기존 "Add Workspace" 옆 위치
    - 모달 입력 4개 (이름/parent/옵션 4종) 동작
    - 잘못된 이름(공백/슬래시/.) 인라인 에러
    - 이미 존재하는 디렉토리 → 인라인 에러
    - parent 미존재 → confirm dialog → 재귀 생성 toast
    - 모든 옵션 ON 생성 → Finder에서 .git/, CLAUDE.md, progress.md, .gitignore 확인
    - 생성 후 dashboard 카드 즉시 표시 + Run with Claude 다이얼로그 자동 오픈
- [ ] **MEDIUM: Sprint B SHOULD/NICE TO HAVE (non-blocking)**
  - 서버측 `workspace:newProject` defence-in-depth (validateProjectName 서버 mirror)
  - trailing space 거부, `as any` 캐스트 제거, 워크스페이스 ID 로깅, validateProjectName 단위테스트, 614줄 분할 검토
  - Ask Claude 인라인 버튼: 긴 텍스트(한국어/이모지/영문)에서 버튼 라벨 안 잘리는지, "+N more" 펼친 항목도 동일
  - Run with Claude dedup: 같은 워크스페이스 카드의 "Claude" 두 번 클릭 → 두 번째는 새 탭 안 생기고 기존 탭으로 switch + 토스트
  - Ask Claude는 dedup 적용 안 됨 — nextStep 두 번 클릭 시 새 탭 두 개 생김 확인
  - Sidebar Running: claude 띄운 탭에서 다른 탭으로 전환 → claude 종료 → ≤5초 이내 sidebar Running 표시 사라짐
- [ ] **HIGH: Sprint C 시각 검증** (사용자 수동, dev 모드 + 패키지 빌드)
  - **A 기본**: 그룹에서 긴 출력 후 앱 종료 → 재오픈 시 출력 + dim divider `—— restored from previous session (시각) ——` + 같은 cwd
  - **Daemon**: `ps aux | grep htptyd` 으로 daemon 살아있는지, 종료 후에도 살아있는지
  - **Pinned**: 그룹 우클릭/아이콘으로 📌 토글 → claude REPL/dev server 띄우고 앱 종료 → 재오픈 시 살아있음
  - **Crash 복구**: `kill -9 htptyd` 후 재오픈 → fallback + "pinned session lost: daemon crashed" toast 1회
  - **Orphan 정리**: unpin/그룹 삭제 시 daemon에서 PTY 사라짐 (`htptyd-client list` 또는 nc로 확인)
- [ ] **MEDIUM: Sprint C carryover SHOULD FIX 일괄 정리**
  - Sprint 1 ANSI mid-cap reset, before-quit lsof timeout
  - Sprint 2 htptyd.log rotation
  - Sprint 3 dead comment, cleanupPinnedOnDelete 미정리, fire-and-forget UI 알림
- [ ] **HIGH: Git Flow 모달 + 이전 미해결 항목** — Add Workspace 동작 확인 (이전 핫픽스 후 시각 검증 미완)
- [ ] **MEDIUM: Sprint A SHOULD FIX (non-blocking)**
  - 재시작 후 dedup 매치 시 "(claude REPL 종료되었을 수 있음)" 보조 안내 토스트
  - `agent-status.ts:172` `console.log("[agent-status] polling N panes...")` 2.5s마다 noisy → DEBUG flag로
  - waiting → running 덮어쓰기 의도성 주석으로 spec 명시
- [ ] **MEDIUM: dashboard.ts 모듈 분리** (1992+ lines 누적) — dashboard-{state,render,gitflow,discovery,modal}.ts 5분할
- [ ] **MEDIUM: Resume Session** — 마지막 N개 명령 + cwd 기록을 sessions.json에 추가, 재시작 시 카드 expand 영역에 "마지막 명령" 표시 (Sprint C에 일부 포함될 수 있음)
- [ ] **HIGH (큰 가치): Block-style 출력 (OSC 133)** — Warp 시그니처. xterm.js OSC handler 등록 + 명령어/출력 segmentation. 별도 다중 sprint 규모
- [ ] **LOW: gitflow cache invalidation 자동화** — fs/HEAD watch
- [ ] **LOW: gitflow lane overflow** — 모달 스크롤로 충분할 수도
- [ ] **LOW: CommonJS shim 근본 해결** (이월)
- [ ] **LOW: findClaudeInTree depth 3 false positive 검토** — 이번 sprint scope 외, 추후 필요 시

## Key Decisions

### 이번 세션 결정
- **Run with Claude dedup 정책 번복**: 이전 세션에서 "매 클릭마다 새 그룹, dedup 없음, 멘탈 모델 단순"으로 결정했으나, 실제 사용 시 같은 워크스페이스 탭 누적이 노이즈가 커서 dedup 적용으로 방향 변경. **Ask Claude(taskText 있음)는 dedup 제외** — claude REPL 입력 모드 알 수 없으므로 새 prompt를 기존 REPL에 안전하게 주입할 방법 없음.
- **dedup 단일 진실 공급원**: `Tab.claudeCwd` 필드 추가 (별도 Map 만들지 않음). SavedTab에도 반영해 앱 재시작 후에도 유지.
- **dedup 매치 키**: 정확한 cwd 문자열 일치 (`===`, 정규화 없음). main이 `path.resolve` 한 값을 그대로 사용 → renderer가 가공 없이 저장/비교하므로 일관성 보장.
- **Sidebar Running stuck 근본 원인**: `pollAgentStatus`가 모든 탭의 pane을 polling하면서도 sidebar marker는 active 탭만 갱신. 비활성 탭의 marker가 갱신 누락되어 stuck. fix는 `tabMap.keys()`를 false-seed로 Map 생성 후 모든 (tabId, hasAgent)에 호출.
- **`updateSidebarAgentMarker` 시그니처/내부 가드 보존**: hook-state의 waiting/done 상태가 절대 덮어써지지 않도록 기존 `if (currentState === "running") setState idle` 가드 유지.
- **Sprint 순서**: A(폴리시 small) → B(New Project medium) → C(세션 유지 large). 한 번에 하나씩 harness.
- **Sprint A 분할**: 클리핑+dedup과 Running fix를 같은 sprint A 내 추가 작업으로 처리. 한 커밋으로 묶음. evaluator 두 번 spawn (각 부분 독립 검증).

### (이전 세션 결정 유지)
- PTY 옵션 C (`zsh -i -c 'claude "$@"; exec zsh -i'`) — argv 분리로 shell injection 차단
- claude 미설치 시 `isClaudeAvailable()` IPC + dashboard toast
- Discovery scan root는 hardcode (`~/dev`, `~/work`, `~/projects`)
- 디자인 토큰 LANE_COLORS hex 그대로 사용
- collapsed 카드 = head + foot만, expand 시 status/tags/body/.card-expand 노출
- argv 배열 인자 + path 3중 검증으로 command injection 차단

## Harness State
- Phase: complete — Sprint C (세션 유지 Hybrid) 완료
- Feature: -
- Branch: - (feature/session-persist-hybrid 머지 후 삭제)
- Sprint: 3/3, Iteration: 2 (Sprint 3는 iter 1 22→ iter 2 30 REFINE 성공)
- Score: Sprint 1 29/35, Sprint 2 32/35, Sprint 3 iter2 30/35 — all PASS
- Resume: `/harness` (다음 기능 요청 시)

## Blockers / Notes
- **사용자 시각 검증 필요** — 새 빌드(release/HyperTerm-0.1.0-arm64.dmg, 05-05 재빌드)로 Sprint A 동작 확인
- main과 origin/main 동기화 필요 (현재 ahead 5 commits 추정 — push 미수행)
- macOS arm64 전용 — Cursor 외 IDE 자동 감지 미지원
- workspaces.json: `~/Library/Application Support/HyperTerm/workspaces.json`
- sessions.json: 같은 디렉토리. Sprint A에서 `claudeCwd` 필드 추가 (backward-compat optional)
- dashboard.ts 1992+ lines 누적 — 모듈 분리 SHOULD FIX 누적 (Sprint B/C에서 부분 분리 가능성)
- Sprint A의 SHOULD FIX 3건은 non-blocking, 추후 묶어서 처리
