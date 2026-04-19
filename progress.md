# Work Progress

## Current Task
- 완료 (터미널 배경색 사이드바 색상 통일)

## Last Session (2026-04-20)

### 터미널 배경색 통일
- `XTERM_THEME_DARK.background` + `cursorAccent`: `#1c1c1c` → `#0e1014` (사이드바 `--bg-1`과 동일)
- `dead-pane-overlay` background: `#1c1c1c` → `var(--bg-1)`, hover: `#252525` → `var(--bg-2)`
- 빌드 + 앱 실행 확인 (`npx electron .`)

## Next Steps
- [ ] **HIGH: 패키지 .app에서 Claude Code 연동 검증** — hook 이벤트 왕복 확인 (뱃지 표시 확인)
- [ ] **HIGH: DevTools Memory 프로파일링** — event listener bounded, detached node 없음
- [ ] **MEDIUM: /Applications 배포** — `cp -r release/mac-arm64/HyperTerm.app /Applications/HyperTerm.app`
- [ ] **LOW: 레이아웃 프리셋 UX** — 전환 시 toast 피드백, tabLayoutPresets closeTab 정리
- [ ] **LOW: rename-input max-width** — 넓은 사이드바에서 140px 캡 여유 있게

## Key Decisions
- **Hook 이벤트**: `CLAUDE_HOOK_EVENT` env var 대신 stdin payload `hook_event_name` 파싱
- **Activity Log 제거**: 그룹 이름 옆 뱃지로 대체 — 더 직관적
- **알림 색상**: Running=파란(정보), Waiting=주황 맥박(행동요구), Done=초록 5초(확인)
- **Card dot-status**: idle=gray / running=green glow / waiting=amber / done=green flash
- **Layout preset 저장**: toolbar highlight는 metadata, 실제 tree는 SavedPaneNode에서 복원
- **터미널 배경**: xterm dark theme을 `--bg-1`(#0e1014)로 통일 — 사이드바와 시각적 일체감

## Harness State
- Phase: complete — 사이드바 per-pane 상태 구분 완료 (branch merged)
- Feature: -
- Branch: -

## Blockers / Notes
- macOS arm64 전용 빌드
- hook.sh 이미 배포됨 (`~/.config/hyperterm/hook.sh`) — 앱 재실행 시 자동 업데이트됨
- toolbar-row.ts의 `tabLayoutPresets` Map: closeTab 시 delete 미호출 (minor memory leak, 탭 수 적어 무해)
- light theme에 ph-* pane header 규칙 미적용 (dark 기본, 체감 없음)
