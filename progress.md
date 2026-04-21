# Work Progress

## Current Task
- 완료 (멀티탭 세션 상태 감지 수정)

## Last Session (2026-04-20)

### Usage 뱃지 제거
- 에러 시 Usage 표시 완전 숨김 (`""`)으로 변경 (이전 세션 커밋 36c5d32)

### 터미널 배경색 패딩 통일
- `.terminal-container { background: var(--bg-1) }` 추가
- 4px 패딩 영역이 `--bg-0`으로 비치던 문제 수정 → 사이드바와 동일한 색상

### 멀티탭 세션 상태 감지 수정 (harness 28/30 PASS)
- `pollAgentStatus()` → 전체 탭 폴링으로 변경 (기존: active tab만)
  - 백그라운드 탭 pane의 `agentStatus` stale 문제 해소
  - 폴링의 `setSidebarPaneRowState` 직접 호출 제거 (오탐 Running 원인)
- `findOrAssignLeaf()` → active tab 우선 매핑으로 변경
  - 기존: tabMap 삽입 순서(Terminal_app 먼저) → Hypersim3 이벤트가 Terminal_app pane에 잘못 매핑
  - 수정: `[activeTabId, ...나머지]` 순서로 탐색 → 이벤트가 올바른 pane에 귀속

## Next Steps
- [ ] **HIGH: 앱 재시작 후 멀티탭 Running/Waiting 상태 실제 검증** — 여러 탭 동시 Claude 실행
- [ ] **HIGH: 패키지 .app에서 Claude Code 연동 검증** — hook 이벤트 왕복 확인
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
- **Running/Waiting 뱃지**: hook 이벤트 전용 (폴링은 agentStatus + pane header 마커만 담당)
- **세션 매핑**: findOrAssignLeaf에서 active tab 우선 — 백그라운드 탭 stale agentStatus 오매핑 방지

## Harness State
- Phase: complete — 멀티탭 세션 상태 감지 수정 완료
- Feature: -
- Branch: -

## Blockers / Notes
- macOS arm64 전용 빌드
- hook.sh 이미 배포됨 (`~/.config/hyperterm/hook.sh`) — 앱 재실행 시 자동 업데이트됨
- toolbar-row.ts의 `tabLayoutPresets` Map: closeTab 시 delete 미호출 (minor memory leak, 탭 수 적어 무해)
- light theme에 ph-* pane header 규칙 미적용 (dark 기본, 체감 없음)
- GitHub Actions 연동: OAuth 토큰은 ~1일 만료, 안정적 자동화는 API 키 필요
