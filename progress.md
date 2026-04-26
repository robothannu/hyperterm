# Work Progress

## Current Task
- 두 작업 완료 (코드 머지). 검증·배포 단계 대기.
  1. Hook 라우팅 버그 영구 수정 (d71eff4)
  2. 훅 기반 subagent 상태 트래킹 신규 기능 (Sprint 1+2+3 → 546bb95 merge)

## Last Session (2026-04-26)

### ① Hook 버그 영구 수정 (d71eff4)
- 원인: `~/.config/hyperterm/hook.sh`가 Apr 20 구버전. `isHookInstalled()`가 settings.json 등록만 보고 hook.sh 내용은 검증 안 함 → `installClaudeHooks()`가 부팅 시 호출되지 않아 hook.sh 갱신 안 됨.
- 부수 증상: 구버전 hook.sh가 brew python3을 4회 호출 → macOS launcher crash 다이얼로그 반복.
- 수정:
  - `src/main/main.ts:144` `ensureHookScript()` 매 부팅마다 `writeFileSync` 덮어쓰기 (구버전 자동 치유)
  - `src/main/main.ts:739` `installClaudeHooks()` 무조건 호출 (`isHookInstalled()` 가드 제거)
  - hook.sh 본문: single-shot `/usr/bin/python3` (Apple-signed) — crash 회피 + spawn 4→1
  - `~/.config/hyperterm/hook.sh` 즉시 수동 갱신 → 런타임에서도 적용

### ② 훅 기반 subagent 상태 트래킹 (Harness 3-sprint)
브랜치 `feature/hook-subagent-status` 에서 작업 후 `546bb95 merge: ...`로 main 머지.

**Sprint 1** (0be4b2f, 33/35) — 신규 hook 파이프라인:
- `src/main/subagent-hook-installer.ts` — `~/.config/hyperterm/subagent-hook.sh` (token 0)
- `~/.claude/settings.json`에 `PreToolUse(matcher=Task)` + `SubagentStop` 등록
- jsonl: `~/.claude/state/hyperterm/<HYPERTERM_PTY_ID>.jsonl`, schema `{ts, event: start|stop, agent_type?, task_description?, claude_session_id?}`
- 기존 5종 hook + socket 파이프라인 완전 격리

**Sprint 2** (e2fe75a, 33/35) — Watcher + IPC:
- `src/main/subagent-watcher.ts` — `fs.watch` 디렉토리+파일 2단계, per-file byte offset, 단순 counter 정책 (start +1 / stop -1, floor 0)
- 부팅 시 `fullReadFile()` 전체 스캔 → 미완료 subagent 복원
- IPC: `subagent:status` (broadcast), `subagent:snapshot` (ipcMain.handle)
- preload: `onSubagentStatus()`, `getSubagentSnapshot()`

**Sprint 3** (0add6e8, iter1 28→iter2 33) — 사이드바 UI:
- `src/renderer/subagent-indicator.ts` — group 단위 합산 (`getAllLeaves` × ptyState), count=0 hidden / =1 dot / ≥2 dot+숫자
- 보라(#8b5cf6) 색상, 기존 Running(녹색)/Waiting(주황)과 시각 구분
- hover popover: agent_type · task_description · 경과 시간(s)
- iter1 MUST FIX 2건 → iter2에서 fix:
  - elapsed time `*1000` 중복 곱셈 버그 (subagent-indicator.ts:29)
  - `cleanupSubagentForPty()` 호출 누락 → renderer.ts closePaneByPtyId(:663) + closeTab loop(:723)에 hookup

### Harness 운영 메모
- `.claude/harness/` gitignore 추가
- planner는 별도 호출 없이 기존 plan.md 재사용 (paused 상태에서 resume)
- 자기평가 편향 방지: 모든 sprint에서 builder/evaluator 분리 spawn

## Next Steps
- [ ] **HIGH: 패키징 + 앱 재시작 + 라이브 검증**
  - `npm run dist` → 새 `release/mac-arm64/HyperTerm.app` 생성
  - `open release/mac-arm64/HyperTerm.app` 으로 재시작
  - 검증 1 (hook 버그 수정): 여러 탭에서 Claude 병렬 → DevTools 콘솔로 `hookSessionMap` 확인, 각 탭에 올바른 Running/Waiting 뱃지 라우팅
  - 검증 2 (subagent 인디케이터): 한 탭에서 `claude` 실행 → "Task tool로 ls /tmp 하고 결과만 알려줘" → 사이드바 group에 보라 dot 등장 확인
  - 검증 3 (multi-pane 합산): 한 group의 두 페인에서 동시 Task → group에 dot+2
  - 검증 4 (hover popover): popover에 agent_type / 경과 시간 정확히 표시
  - 검증 5 (정리): 탭 닫을 때 인디케이터 깔끔히 사라짐
- [ ] **MEDIUM: 잔여 안전장치** (필요하면)
  - 폴링↔hook 화해 (stuck idle 강제 전이)
  - `cleanupPaneHookMarker`에 tab-notif 재계산
  - fallback 휴리스틱 drop + 로그
- [ ] **MEDIUM: README 업데이트** — subagent 인디케이터 섹션 추가
- [ ] **MEDIUM: /Applications 배포**
- [ ] **LOW: 비-blocking carryover** (evaluator 보고)
  - styles.css `.subagent-indicator-slot` grid-column 중복(2123, 2411)
  - popover reposition rAF 1회 한정

## Key Decisions
- **Hook 자동 치유**: settings.json 등록 + hook.sh 내용을 분리 검사. hook.sh는 매 부팅마다 무조건 덮어써서 구버전 잔존 차단.
- **macOS python**: `/usr/bin/python3` (Apple-signed) 사용 + single-shot. brew python crash 회피 + spawn 비용 ↓.
- **Subagent 파이프라인 격리**: 기존 unix socket `hook:event`와 완전히 분리된 파일 기반 채널. 손실 면역 + 재시작 후 in-flight 복원.
- **PTY 식별**: jsonl 파일명 = `<HYPERTERM_PTY_ID>.jsonl` (payload body에 pty_id 없음 — 파일명에서만 추출)
- **Counter 정책**: start/stop 단순 +1/-1 (FIFO). SubagentStop hook payload에 task 식별자가 없어 매칭 불가능 → 단순 카운터가 제일 robust.
- **UI 색상**: 보라(#8b5cf6) — 기존 녹색(Running)/주황(Waiting)과 다른 spectrum

## Harness State
- Phase: complete — 훅 기반 subagent 상태 트래킹 완료 (branch merged)
- Feature: -
- Branch: -
- Sprint: 3/3, Iteration: 2
- Resume: `/harness` (필요 시 modification/extension/new feature 모드)

## Blockers / Notes
- **packaged 검증 미완** — dev/단위시뮬레이션은 PASS, `.app` 실행 후 시각 검증은 사용자 몫 (AC1.7, AC2.8, AC3.8)
- 새 hook (subagent)이 동작하려면 앱 재시작 후 첫 Claude 세션부터. 기존 PTY는 구 환경 그대로 유지됨
- `~/.config/hyperterm/subagent-hook.sh`는 빌드 후 첫 부팅에서 자동 생성됨 (`installSubagentHooks()`)
- jsonl 파일은 무한 누적될 수 있음 (회전 정책 미구현) — 향후 sprint 후보
- macOS arm64 전용
