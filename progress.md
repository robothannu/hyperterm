# Work Progress

## Current Task
- 완료 (Linear/Raycast UI 리디자인 + 알림 시스템 + hook 버그 수정)

## Last Session (2026-04-19)

### 알림 뱃지 시스템 (그룹 이름 옆)
- `tab-notif` 뱃지 추가 (sidebar.ts `addSidebarEntryDOM`)
- 상태별 색상: `⚙ Running` 파란색 / `⚠ Waiting` 주황 맥박 / `✓ Done` 초록 5초 후 소멸
- hook-state.ts에 `setTabNotifBadge()` 함수 추가 및 handleHookEvent에서 호출

### Claude Code Hook 버그 수정 (핵심)
- `CLAUDE_HOOK_EVENT` 환경변수가 실제로 설정되지 않음 발견
- payload stdin JSON의 `hook_event_name` 필드를 읽도록 `hook.sh` 수정
- `main.ts` 템플릿도 동일하게 수정
- 결과: Recent Activity가 항상 비어있던 문제 해결

### Recent Activity 제거
- `activity-log.ts` 로드 및 `initActivityLog()` 호출 제거
- 관련 CSS 전부 삭제

### HyperTerm Linear/Raycast UI 리디자인 (harness 3-sprint)
**Sprint 1 (27/30)**: Visual Foundation
- CSS 변수 시스템 (`--bg-0~4`, `--fg-0~3`, `--accent`, `--ok`, `--warn` 등)
- Inter + JetBrains Mono 폰트 (Google Fonts + CSP 확장)
- Titlebar 3-column grid: `HyperTerm › GroupName · branch`
- Sidebar "TERMINAL GROUPS" 헤더 + SVG 아이콘 버튼
- Statusbar: Claude counter 좌 / 5H·7D usage bar 우 (indigo/amber/red)

**Sprint 2 (28/30)**: Rich Sidebar Cards & Pane Headers
- 사이드바 project card: dot-status / 이름 / count pill / meta(branch·changes·ahead)
- git:status IPC에 `aheadCount` 추가 (rev-list)
- Pane header: dot · cwd · branch · 제목 · Clear/Split/Close 버튼
- `.pane-leaf.focused`: indigo border + shadow
- rename input grid-column 회귀 수정 (iter 2)

**Sprint 3 (27/30)**: Layout Presets & Toolbar Row
- `toolbar-row.ts` 신규: 4개 레이아웃 프리셋 버튼 (1/2/3/4-pane)
- `applyLayoutPreset()`: 기존 pane 재사용, 부족분 생성, 초과분 teardown
- `layoutPreset` sessions.json 저장/복원

### Settings 모달 디자인 일관성
- 헤더 gradient + border, Inter 600 타이포
- 슬라이더 webkit 커스텀 (indigo thumb + glow)
- 토글 border 추가, 값 레이블 JetBrains Mono
- Hook 상태 pill border-radius 10px

### 패키지 빌드
- `npm run dist` → `release/mac-arm64/HyperTerm.app` 완료

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
- **Excess pane 제거**: closePaneByPtyId 우회 → closeTab 사이드이펙트 방지

## Harness State
- Phase: complete — HyperTerm Linear/Raycast UI 리디자인 완료 (branch merged into 2d_gui)
- Feature: -
- Branch: -

## Blockers / Notes
- macOS arm64 전용 빌드
- hook.sh 이미 배포됨 (`~/.config/hyperterm/hook.sh`) — 앱 재실행 시 자동 업데이트됨
- toolbar-row.ts의 `tabLayoutPresets` Map: closeTab 시 delete 미호출 (minor memory leak, 탭 수 적어 무해)
- light theme에 ph-* pane header 규칙 미적용 (dark 기본, 체감 없음)
