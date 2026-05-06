# Work Progress

## Current Task
- **completed** — Codex 지원 (3 sprints, all PASS), main 머지 + dist 빌드 (HyperTerm-0.1.0-arm64.dmg 22:11). divider 누적 carryover fix 1건 처리.
- (이전) Dashboard-first launch + 60s auto-refresh — main 머지
- (이전) Sprint C 일부: Sprint 1 (snapshot 복원)만 유지. Sprint 2/3 revert
- (이전) Sprint B: New Project wizard — main 머지
- (이전) Sprint A: Claude 버튼 폴리시 — main 머지 + 패키지 빌드

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

## Codex 지원 결과 (2026-05-06, 머지 54fd3c7)

| Sprint | Verdict | 점수 | 커밋 |
|---|---|---|---|
| 1 (진입점 — PTY + footer + wizard) | PASS iter 2 | 31/35 | bb46d34 |
| 2 (sidebar marker — codex polling) | PASS iter 2 | 32/35 | 275a395 |
| 3 (usage placeholder + Settings + Ask) | PASS | 30/35 | 7a08035 |
| merge | — | — | 54fd3c7 |

누적: 18 files changed, +1080/-40 (신규 `pty-manager-codex.ts` 314줄, `agent-status-codex.ts` 166줄).

### 핵심 결정
- **Codex CLI**: OpenAI Codex CLI (`codex` 명령), `/opt/homebrew/bin/codex` 설치 확인. Interactive REPL 패턴.
- **Usage**: `codex --help` 직접 확인 → usage 서브커맨드 없음 → "codex usage unavailable" placeholder. AC 1/2 충족.
- **UX**: 별도 버튼 2개 나란히 (드롭다운 X). 카드 footer `[Claude] [Codex]`, 인라인 `[Ask Claude] [Ask Codex]`, wizard 라디오, statusbar 두 영역.
- **Sidebar marker**: 30s polling. blue (#60a5fa) vs Claude green. CSS specificity 0,3,0으로 active 탭에서도 codex 색 유지.
- **PTY ID range**: codex 50000+ (Claude 1+와 분리). main.ts 4개 IPC 핸들러에 hasSession 분기.
- **Subagent hook**: codex 미지원 → polling만. Claude polling이 codex-running 덮어쓰지 않게 가드.
- **Ask Codex**: argv 배열로 taskText 전달 (shell injection 0).

### Sprint 1 carryover SHOULD FIX 처리 (2/2)
- divider 누적 방지: captureSnapshot에서 이전 divider 정규식 strip
- ANSI mid-cap reset: buildDivider 앞에 `\x1b[0m` prepend

### Codex carryover SHOULD FIX (남음, non-blocking)
- codexNotifications 실제 gating (현재는 토글 UI/persist만, codex 알림 이벤트 없음)
- hook-state.ts:159 done 8s clear가 codex-running 강제 idle 가능
- Claude usage 오류 시 codex-usage-sep orphan UX

---

## Sprint C 결과 (2026-05-05, 머지 a11ccee)

| Sprint | Verdict | 점수 | 커밋 | 상태 |
|---|---|---|---|---|
| 1 (Snapshot 복원, daemon 없음) | PASS | 29/35 | c59e7d5 | 유지 |
| 2 (htptyd daemon 인프라) | PASS | 32/35 | 85ecb02 | **revert (3d20e22)** |
| 3 iter 2 (pinned UX + reattach) | PASS | 30/35 | 258410e | **revert (3d20e22)** |

Sprint 2/3 revert 사유: dev 모드 시각 검증 중 사용자가 "pinned 기능 불필요" 결정. daemon은 pinned 없이 무용지물이라 같이 제거. Sprint 1은 daemon 없이 자기충족적이라 유지.

남은 동작 (Sprint 1만):
- 모든 그룹의 cwd + xterm scrollback (~2000줄) 자동 저장 (30s 주기)
- 앱 종료/재실행 시 같은 cwd로 새 PTY + 이전 화면 buffer write + dim divider `—— restored from previous session (시각) ——`
- sessions.json에 SavedPaneLeaf.scrollback?, snapshotSavedAt? 필드 (optional, Sprint A claudeCwd와 호환)

### Sprint 1 (유지) 핵심 결정
- SerializeAddon으로 xterm buffer 직렬화 + 200KB tail cap (그룹 20개 ~3.91MB ≤ 5MB) + dim ANSI divider
- 30s 주기 자동 저장 + 종료 시점 동기 캡처
- SavedPaneLeaf optional 필드 (`scrollback?`, `snapshotSavedAt?`) → Sprint A의 claudeCwd 보존

### Sprint 1 carryover SHOULD FIX (non-blocking)
- ANSI escape mid-cap 시 divider 직전 `\x1b[0m` reset (orphan 문자 방지)
- before-quit 시 worst-case `tabs × 3s lsof timeout` — tab 병렬화 또는 cwd 캡처 생략

### Sprint C 일부 revert 결정 사유 (학습)
- 평가는 PASS였으나 사용자 시각 검증에서 "필요 없음" 판단 → harness PASS ≠ 사용자 가치
- 다음부터 large 규모 sprint는 시각 검증 결과를 기다린 후 다음 sprint 진입 권장

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
- [ ] **HIGH: Sprint 1 (snapshot 복원) 시각 검증** (사용자 수동)
  - 그룹에서 긴 출력 후 앱 종료 → 재오픈 시 출력 + dim divider `—— restored from previous session (시각) ——` + 같은 cwd
  - sessions.json에 stale `pinned: true` 1건 자동 무시 확인 (Sprint 2/3 revert 후 첫 실행에서 fallback toast 안 뜨는지)
- [ ] **MEDIUM: Sprint 1 SHOULD FIX 정리**
  - ANSI mid-cap reset, before-quit lsof timeout
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
- Phase: complete — Codex 지원 완료 (3 sprints all PASS, main 머지)
- Feature: -
- Branch: - (feature/codex-support 머지 후 삭제)
- Sprint: 3/3, all PASS (Sprint 1 iter2 31, Sprint 2 iter2 32, Sprint 3 30)
- Resume: `/harness` (다음 기능 요청 시)

## Blockers / Notes
- **사용자 시각 검증 필요** — 새 빌드(release/HyperTerm-0.1.0-arm64.dmg, 05-05 재빌드)로 Sprint A 동작 확인
- main과 origin/main 동기화 필요 (현재 ahead 5 commits 추정 — push 미수행)
- macOS arm64 전용 — Cursor 외 IDE 자동 감지 미지원
- workspaces.json: `~/Library/Application Support/HyperTerm/workspaces.json`
- sessions.json: 같은 디렉토리. Sprint A에서 `claudeCwd` 필드 추가 (backward-compat optional)
- dashboard.ts 1992+ lines 누적 — 모듈 분리 SHOULD FIX 누적 (Sprint B/C에서 부분 분리 가능성)
- Sprint A의 SHOULD FIX 3건은 non-blocking, 추후 묶어서 처리
