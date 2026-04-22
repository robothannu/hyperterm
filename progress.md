# Work Progress

## Current Task
- Running 뱃지 오매핑 수정 완료 (빌드 OK, 앱 재시작 대기 중)

## Last Session (2026-04-21)

### Running 뱃지 오매핑 근본 원인 수정
- **근본 원인**: hook payload에 `session_id`만 있고 어느 PTY에서 왔는지 식별자가 없음
  - `findOrAssignLeaf()`가 "Claude 실행 중 + 미매핑 pane"을 휴리스틱으로 찾아 붙이는 방식이 오매핑의 근원
  - 이전 "active tab 우선 탐색" 수정이 역효과를 냄 (사용자가 Tab B로 이동 시 Tab A의 hook이 Tab B로 귀속)
- **해결책**: PTY 생성 시 고유 env var 주입 → Claude 상속 → hook payload에 포함 → 결정적 매핑
- `src/main/pty-manager.ts:84` — spawn env에 `HYPERTERM_PTY_ID: String(id)` 추가
- `src/main/main.ts` — hook.sh 템플릿이 `$HYPERTERM_PTY_ID` 읽어 `hypert_pty_id` 필드로 payload에 포함
- `src/preload/preload.ts:25` + `src/renderer/global.d.ts:28` — `HookEvent.hypert_pty_id?: string` 추가
- `src/renderer/hook-state.ts` — `findOrAssignLeaf(sessionId, hypertPtyId?)` 수정
  - `hypertPtyId` 있으면 `findLeafByPtyId`로 직결 (결정적 매핑)
  - 없으면 기존 휴리스틱 fallback (레거시 PTY 또는 payload 누락 대비)
- `npm run build` 통과

## Next Steps
- [ ] **HIGH: 앱 재시작 후 Running 뱃지 오매핑 검증** — 여러 탭 동시 Claude 실행, 각 탭에 올바른 뱃지 뜨는지 확인
  - 재시작 후 hook.sh 자동 갱신됨, 새 PTY는 HYPERTERM_PTY_ID env 포함
- [ ] **HIGH: 패키지 .app에서 Claude Code 연동 검증** — hook 이벤트 왕복 확인
- [ ] **MEDIUM: /Applications 배포** — `cp -r release/mac-arm64/HyperTerm.app /Applications/HyperTerm.app`
- [ ] **LOW: DevTools Memory 프로파일링** — event listener bounded, detached node 없음
- [ ] **LOW: 레이아웃 프리셋 UX** — 전환 시 toast 피드백, tabLayoutPresets closeTab 정리
- [ ] **LOW: rename-input max-width** — 넓은 사이드바에서 140px 캡 여유 있게

## Key Decisions
- **Hook 이벤트**: `CLAUDE_HOOK_EVENT` env var 대신 stdin payload `hook_event_name` 파싱
- **Activity Log 제거**: 그룹 이름 옆 뱃지로 대체 — 더 직관적
- **알림 색상**: Running=파란(정보), Waiting=주황 맥박(행동요구), Done=초록 5초(확인)
- **Card dot-status**: idle=gray / running=green glow / waiting=amber / done=green flash
- **Layout preset 저장**: toolbar highlight는 metadata, 실제 tree는 SavedPaneNode에서 복원
- **터미널 배경**: xterm dark theme을 `--bg-1`(#0e1014)로 통일 — 사이드바와 시각적 일체감
- **Running/Waiting 뱃지**: hook 이벤트 전용 (폴링은 agentStatus + pane header 마커만 담당)
- **세션 매핑 v2**: HYPERTERM_PTY_ID env var 주입 → 결정적 매핑. 레거시 fallback 유지.

## Harness State
- Phase: idle
- Feature: -
- Branch: -

## Blockers / Notes
- 앱 재시작 필요 — 현재 실행 중인 앱은 구버전 코드. 재시작 시 hook.sh 자동 갱신됨.
- 재시작 후 Claude를 새로 실행해야 새 env 상속 (기존 Claude 프로세스는 옛 env 그대로)
- macOS arm64 전용 빌드
- toolbar-row.ts의 `tabLayoutPresets` Map: closeTab 시 delete 미호출 (minor memory leak, 탭 수 적어 무해)
- light theme에 ph-* pane header 규칙 미적용 (dark 기본, 체감 없음)
