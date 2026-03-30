# Work Progress

## Current Task
- HyperTerm 리팩토링 완료 + Claude 사용량 상태바 구현

## Last Session (2026-03-30)
- **Claude 사용량 상태바 구현**: 5h/7d 사용량을 바(bar) UI로 표시, 리셋 시간 텍스트로 표시
  - Keychain OAuth 토큰 → Anthropic API → IPC → renderer DOM 업데이트 파이프라인
  - 색상 코딩: 정상(파랑 #4a9eff), 80%+(노랑 #f0b000), 95%+(빨강 #ef5555)
  - 자동 갱신 5분, 클릭 수동 갱신
  - 폰트 흰색 볼드, 오른쪽 정렬, 바 80x12px 흰색 테두리
- **리팩토링**: dead code 전면 정리
  - SSH Profiles IPC/bridge/타입/HTML 전체 제거 (main, preload, global.d.ts)
  - Command Palette `commands` 배열 + `Command` 인터페이스 제거
  - Modal DOM 요소 (HTML + JS) 제거
  - `sendTextToTmux`/`startTmuxSearch` orphaned IPC 제거
  - `showNameDialog()` → `nextTerminalName()` 동기 함수로 단순화
  - `execSync` → `execFile` 비동기 (main process blocking 방지)
  - `querySelectorAll(".usage-sep")` 캐싱
- **브랜치 머지**: `feat/ssh-profiles-command-palette` → `main` (fast-forward)

## Next Steps
- [ ] 기존 앱과 새 앱 동시 실행 테스트
- [ ] tmux 세션 복원 정상 동작 확인
- [ ] pane 분할/닫기 정상 동작 확인
- [ ] 패키징 빌드 테스트 (`npm run package`)

## Key Decisions
- **불필요한 기능 제거**: Command Palette, SSH Profiles, Search, Broadcast 모두 제거 — UI를 단순하게 유지
- **터미널 이름 자동 생성**: "Terminal N" 형태의 기본 이름 사용
- **사용량 바 UI**: 텍스트가 아닌 프로그레스 바 형태, 리셋 시간은 바 옆에 텍스트로 직접 표시 (tooltip이 아님)
- **main process non-blocking**: Keychain 접근을 execFile 비동기로 변경

## Blockers / Notes
- 두 개의 HyperTerm 앱 인스턴스를 동시에 실행하면 tmux 세션 충돌 가능
- macOS arm64 전용 빌드
- `main` 브랜치가 origin보다 3 commits 앞서 있음 (push 필요)
