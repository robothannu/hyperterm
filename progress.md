# Work Progress

## Current Task
- HyperTerm 리팩토링 — 불필요한 기능 제거 및 정리

## Last Session (2026-03-30)
- **이름 입력 대화상자 제거**: 앱 시작 시 이름 입력창 대신 "Terminal 1" 기본 이름 사용
- **Command Palette 제거**: Cmd+Shift+P 기능 전체 삭제 (HTML/CSS/JS)
- **SSH Profiles 패널 제거**: Cmd+Shift+S 기능 전체 삭제
- **Search 기능 제거**: Cmd+F 검색창 삭제
- **Broadcast 기능 제거**: 다중 pane 입력 기능 삭제
- **Ralph Loop 중단**: 사용자가 더 이상 iterations을 원하지 않음

## Next Steps
- [ ] 기존 앱과 새 앱 동시 실행 테스트
- [ ] tmux 세션 복원 정상 동작 확인
- [ ] pane 분할/닫기 정상 동작 확인

## Key Decisions
- **불필요한 기능 제거**: Command Palette, SSH Profiles, Search, Broadcast 모두 제거 — UI를 단순하게 유지
- **터미널 이름 자동 생성**: 사용자가 매번 이름을 입력하는 대신 "Terminal N" 형태의 기본 이름 사용
- **Broadcast 미사용**: 여러 pane에 동시에 명령 보내는 기능은 실제로 사용되지 않아 제거

## Blockers / Notes
- 두 개의 HyperTerm 앱 인스턴스를 동시에 실행하면 tmux 세션 충돌 가능
- macOS arm64 전용 빌드
