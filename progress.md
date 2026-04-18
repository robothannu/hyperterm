# Work Progress

## Current Task
- HyperTerm Claude Code Companion 구현 중 — S5/7 완료, S6 남음

## Last Session (2026-04-18)
- **Claude Code Companion 6-sprint 구현 (S0~S5 완료)**:
  - **S0 - Renderer 모듈 분해** (27/30): renderer.ts 1406줄 → 8개 모듈 분리 (pane-tree, sidebar, notes-panel, keybindings, statusbar, agent-status, init + renderer)
  - **S1 - Claude 세션 인식** (27/30): `ps` 기반 process tree 탐색으로 claude binary 감지. pane header "● Claude" 마커 + 사이드바 dot. false positive 버그(args.includes) 수정 완료.
  - **S2 - Project root + Git 상태** (28/30): cwd 상위 탐색으로 `.git` 발견 → project root. `git:status` IPC. 사이드바 `⎇ main ●` 배지. cwd 기반 캐시(재탐색 버그 수정).
  - **S3 - Changed Files 패널** (27/30): Cmd+Shift+E 토글 패널. `git status --porcelain` 파일 목록. 탭 전환 즉시 갱신 + 5초 폴링.
  - **S4 - Diff 뷰어** (27/30): diff2html side-by-side 읽기 전용 diff 모달. staged/modified/untracked 3케이스 처리. 5000줄 초과 제한.
  - **S5 - Claude Code Hook 통합** (26/30): Unix socket `~/Library/Application Support/HyperTerm/agent.sock`. hook.sh(socat) + `~/.claude/settings.json` 자동 설치. 상태 머신(idle→working→waiting_approval→idle). Notification→waiting_approval 버그 수정.
- `npm run build` 전체 통과. `npx electron .` 정상 기동 확인.

## Next Steps
- [ ] **HIGH: S6 구현** — 설정 UI 모달(폰트/테마/알림 토글/hook 상태) + 사이드바 최근 프로젝트(MRU 10개)
- [ ] **HIGH: 실제 Claude Code 연동 검증** — `claude` 실행 후 hook 이벤트 왕복, pane 상태 표시 확인
- [ ] **MEDIUM: socat 의존 알림** — hook 설치 배너에 `brew install socat` 안내 추가
- [ ] **MEDIUM: 이중 폴링 통합** — git-status.ts + changed-files-panel.ts 폴링 캐시 공유
- [ ] **LOW: packaged .app 검증** — `npm run dist` 후 실제 .app 실행 확인 (dev 통과 ≠ 완료)

## Key Decisions
- **Companion 방향**: 풀 IDE 아님. 터미널 중심 유지, Claude Code 세션 시각화에 집중.
- **Process 기반 감지**: data-stream 파싱 금지 (tmux 노이즈 이력). `ps` + binary name 매칭.
- **Hook 통합**: Claude Code settings.json hooks → Unix socket → 상태 머신. socat 의존.
- **세션 매핑**: agentStatus=true pane 중 미매핑에 session_id 순차 할당.
- **diff2html**: vendor/ 복사 방식 (번들러 없음). Monaco/CodeMirror 도입 안 함.
- **알림 기본 OFF**: `claudeNotifications: false` — false positive 방지.

## Harness State
- Phase: building
- Feature: HyperTerm Claude Code Companion
- Branch: 2d_gui
- Sprint: 5/7 완료 (S6 진행 예정), Iteration: 1
- Resume: `/harness` (state.json에서 자동 재개됨)

## Blockers / Notes
- `socat` 미설치 시 hook.sh silent fail — 사용자가 직접 `brew install socat` 필요
- macOS arm64 전용 빌드 (Intel 미테스트)
- S6 완료 후 반드시 `npm run dist`로 패키징된 .app 검증 필요
