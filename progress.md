# Work Progress

## Current Task
- **completed** — Sprint A: Claude 버튼 폴리시 (클리핑 + dedup + Running stuck fix), main 머지 완료, 패키지 재빌드

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

## Next Steps
- [ ] **HIGH: 새 빌드로 Sprint A 시각 검증**
  - Ask Claude 인라인 버튼: 긴 텍스트(한국어/이모지/영문)에서 버튼 라벨 안 잘리는지, "+N more" 펼친 항목도 동일
  - Run with Claude dedup: 같은 워크스페이스 카드의 "Claude" 두 번 클릭 → 두 번째는 새 탭 안 생기고 기존 탭으로 switch + 토스트
  - Ask Claude는 dedup 적용 안 됨 — nextStep 두 번 클릭 시 새 탭 두 개 생김 확인
  - Sidebar Running: claude 띄운 탭에서 다른 탭으로 전환 → claude 종료 → ≤5초 이내 sidebar Running 표시 사라짐
- [ ] **HIGH: Sprint B — New Project wizard** (이전 세션 분석에서 합의)
  - Dashboard "+ New Project" 버튼 → 이름/부모 디렉토리/git init/CLAUDE.md 템플릿/progress.md 템플릿/.gitignore 옵션 → 자동 등록 + Run with Claude 다이얼로그
- [ ] **HIGH: Sprint C — 세션 유지 Hybrid (방식 C)** — 사용자가 명시적으로 합의한 메인 작업
  - **A 기본**: 모든 그룹의 cwd, 환경, scrollback(최근 N줄), 마지막 명령 N개를 sessions.json에 저장. 재시작 시 같은 cwd로 새 PTY + 화면 복원.
  - **B pinned**: 사용자가 그룹별 📌 토글 → background daemon 프로세스에 PTY 위탁. 앱 닫혀도 daemon이 PTY 유지. 재오픈 시 reattach → claude REPL/dev server 그대로 살아있음.
  - daemon 이름 자유, unix socket IPC, orphan 정리/crash 복구/생명주기 관리 포함
  - "no tmux" 원칙 유지 (daemon은 직접 구현)
  - macOS arm64 전용, node-pty 그대로
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
- Phase: complete — Sprint A (Claude 버튼 폴리시) 완료
- Feature: -
- Branch: -
- Sprint: 1/1 (sub-tasks 2개), Iteration: 1
- Resume: `/harness` (Sprint B/C 진입 시 새 기능 요청으로)

## Blockers / Notes
- **사용자 시각 검증 필요** — 새 빌드(release/HyperTerm-0.1.0-arm64.dmg, 05-05 재빌드)로 Sprint A 동작 확인
- main과 origin/main 동기화 필요 (현재 ahead 5 commits 추정 — push 미수행)
- macOS arm64 전용 — Cursor 외 IDE 자동 감지 미지원
- workspaces.json: `~/Library/Application Support/HyperTerm/workspaces.json`
- sessions.json: 같은 디렉토리. Sprint A에서 `claudeCwd` 필드 추가 (backward-compat optional)
- dashboard.ts 1992+ lines 누적 — 모듈 분리 SHOULD FIX 누적 (Sprint B/C에서 부분 분리 가능성)
- Sprint A의 SHOULD FIX 3건은 non-blocking, 추후 묶어서 처리
