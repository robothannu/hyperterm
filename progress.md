# Work Progress

## Current Task
- **completed** — Run with Claude / Ask Claude (Harness 2 sprints, all PASS, main에 머지됨)

## Last Session (2026-05-04)

### 세션 흐름
1. **이전 작업 시각 검증 + 폴리시** — Sprint 2 Git Flow SVG 시각화 개선:
   - 모달 zoom (Cmd+Wheel, +/-/Fit/100% 버튼, Esc) — 카드는 컴팩트 트리거 버튼만
   - lane 라벨 동적 padL 계산으로 긴 브랜치명 클리핑 방지
   - `align-items: start`로 grid 카드 stretching 제거
   - 색 토큰 밝기 ↑ + RefreshAll 시 gitflow cache 비우기
2. **머지 + push + 패키징** — main 29 commits → origin/main push, `release/HyperTerm-0.1.0-arm64.dmg` (100MB) 재빌드
3. **엔지니어 리뷰** — Warp/Wave/Ghostty/Zellij 비교 + 개선 우선순위 제안
4. **사용자 시나리오 분석** — Dashboard vs Terminal에서 프로젝트 생성 검토
5. **Run with Claude / Ask Claude 구현** — Harness 2 sprints

### Harness 결과 (브랜치: feature/run-with-claude → main 머지 완료)

| Sprint | 점수 | 커밋 | 변경 |
|---|---|---|---|
| 1 (Run with Claude footer) | 33/35 | 49a9b42 | Footer "Claude" 버튼 + 4 IPC + PTY 옵션 C (`zsh -i -c 'claude; exec zsh -i'`) |
| 2 (Ask Claude nextSteps inline) | 33/35 | b16c795 | nextSteps inline "Ask Claude" + argv 분리(`"$@"`) shell injection 차단 |
| merge | — | ffe985a | merge: Sprint 1+2 |

### 폴리시 + 인프라 (이번 세션 추가)

| 작업 | 커밋 |
|---|---|
| Git Flow modal zoom + card trigger compact | 5760c9c |
| 색 토큰 밝기 ↑ + cache invalidation | b80322a |
| origin/main push (29 commits) | `499c61f..b80322a` |
| Packaged .app 재빌드 | `release/HyperTerm-0.1.0-arm64.dmg` |

### Files Modified (이번 세션 누적)
- `src/main/main.ts`: 신규 IPC 4개 (`openInMainWithClaude`, `pty:createWithClaude`, `claude:checkInstalled`, `group:openWithCwdWithClaude`) + Sprint 2의 `taskText` 옵셔널 확장
- `src/main/pty-manager.ts`: `createSessionWithClaude(cols, rows, cwd?, taskText?)` — argv 하드코드 리터럴 + `"$@"` positional 분리
- `src/preload/preload.ts` + `dashboard-preload.ts`: 4-way 동기화
- `src/renderer/global.d.ts`: 타입 확장
- `src/renderer/dashboard.ts`: 카드 footer "Claude" 버튼 + nextSteps inline "Ask Claude" 버튼 + handleOpenWithClaude 핸들러
- `src/renderer/dashboard.html`: gitflow modal CSS 추가, 토큰 밝기, ghost 버튼 스타일
- `src/renderer/renderer.ts`: 메인 윈도우 측 group:openWithCwdWithClaude 처리

### 검증
- TypeScript build 0 errors (각 sprint)
- argv 분리 패턴 (`'-c', 'claude "$@"; exec zsh -i', '_', taskText`) — Evaluator가 9종 메타문자 spawn 시뮬레이션으로 RCE 차단 확인 (`/tmp/eval-pwned-*` 0개)
- 한국어/이모지/멀티라인/10K 길이 stress edge OK
- 정적 분석으로 acceptance criteria PASS — 코드 grep + 변경 파일 직접 read 기반
- **시각 GUI 검증은 사용자 수동 필요**

## Next Steps
- [ ] **HIGH: 새 빌드로 Run with Claude / Ask Claude 시각 검증**
  - 카드 footer "Claude" 클릭 → 메인 윈도우 새 그룹에 claude REPL 확인
  - nextSteps 항목 "Ask Claude" 클릭 → 그룹 + claude가 그 텍스트를 prompt로 받은 화면
  - "+N more" 펼친 항목도 동일 동작
  - claude CLI 미설치 환경에서 toast 안내 확인
- [ ] **HIGH: Git Flow 모달 시각 검증 + 다른 폴리시 사항** — 카드 클릭 expand → "Git Flow" 트리거 → 모달 zoom + scroll
- [ ] **HIGH: 이전 세션 미해결 — Add Workspace 동작 확인** (이전 핫픽스 후 시각 검증 미완)
- [ ] **MEDIUM: New Project wizard** — 사용자 시나리오 분석에서 추천. Dashboard "+ New Project" 버튼 → 이름/부모 디렉토리/git init/CLAUDE.md 템플릿/progress.md 템플릿/.gitignore 옵션 → 자동 등록 + Run with Claude 다이얼로그
- [ ] **MEDIUM: Resume Session** — 마지막 N개 명령 + cwd 기록을 sessions.json에 추가, 재시작 시 카드 expand 영역에 "마지막 명령" 표시
- [ ] **MEDIUM: dashboard.ts 모듈 분리** (1992 lines 누적) — 별도 sprint 권고: dashboard-{state,render,gitflow,discovery,modal}.ts 5분할
- [ ] **HIGH (큰 가치): Block-style 출력 (OSC 133)** — Warp 시그니처. xterm.js OSC handler 등록 + 명령어/출력 segmentation. 별도 다중 sprint 규모
- [ ] **LOW: gitflow cache invalidation 자동화** — fs/HEAD watch (현재 RefreshAll 버튼 시만)
- [ ] **LOW: gitflow lane overflow** — 브랜치 많은 repo는 모달 스크롤로 충분, 추가 작업 불필요할 수도
- [ ] **LOW: CommonJS shim 근본 해결** (이전 세션 이월)

## Key Decisions

### 이번 세션 결정
- **PTY 옵션 C 채택**: `pty.spawn('/bin/zsh', ['-i', '-c', 'claude "$@"; exec zsh -i', '_', taskText])`
  - argv 하드코드 리터럴이라 user-controlled string 없음 (Sprint 1)
  - Sprint 2의 `"$@"` positional은 zsh 내부 parameter table에서 child argv로 직접 push — shell parser 두 번 우회 → 메타문자 명령 실행 불가
  - `exec zsh -i` fallback으로 claude 종료 후 빈 shell 유지
- **재오픈 정책: (b) 별도 새 그룹** — 매 클릭마다 새 tab. dedup 없음. 사용자 멘탈 모델 가장 단순.
- **claude 미설치 처리**: `isClaudeAvailable()` 사전 체크 IPC → false면 메인 윈도우 미생성 + dashboard toast(err) "Claude Code CLI not found in PATH"
- **IPC 확장 vs 신규 채널**: Sprint 2는 Sprint 1의 3개 IPC를 optional `taskText`로 확장 (backward-compat). 신규 채널 미생성. 시그니처 가독성 약간 저하했지만 일관성 ↑.
- **Git Flow 카드 vs 모달 분리**: 카드에는 컴팩트 트리거 버튼만, 본 다이어그램은 모달에서 zoom/scroll
- **Discovery dismiss**: renderer-only state (localStorage 미사용) → 윈도우 재오픈 시 자동 리셋

### (이전 세션 결정 유지)
- 디자인 토큰 LANE_COLORS hex 그대로 사용
- collapsed 카드 = head + foot만, expand 시 status/tags/body/.card-expand 노출
- argv 배열 인자 + path 3중 검증으로 command injection 차단
- Discovery scan root는 hardcode (`~/dev`, `~/work`, `~/projects`)

## Harness State
- Phase: complete — Run with Claude / Ask Claude (branch merged)
- Feature: -
- Branch: -
- Sprint: 2/2, Iteration: 1
- Resume: `/harness` (필요 시 새 기능 요청으로 진입)

## Blockers / Notes
- **사용자 시각 검증 필요** — 자동화 불가. 새 .app 또는 dev 모드로 직접 클릭/토글 확인
- main과 origin/main 동기화됨 (이번 세션에서 push 완료)
- macOS arm64 전용 — Cursor 외 IDE 자동 감지 미지원
- Discovery scan root는 hardcode (`~/dev`, `~/work`, `~/projects`)
- workspaces.json: `~/Library/Application Support/HyperTerm/workspaces.json`
- dashboard.ts 1992+ lines 누적 (Sprint 1/2/3 + Run with Claude S1/S2 폴리시 추가) — 모듈 분리 SHOULD FIX 누적
- claude:checkInstalled IPC가 Sprint 1에서는 unused (Sprint 2 등 향후 활용)
- `claude` CLI는 user PATH에 있다고 가정. zshrc의 `claude` 함수 정의 (ANTHROPIC_* unset wrapper 등)도 interactive zsh 통해 인식됨
