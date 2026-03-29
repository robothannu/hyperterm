# Work Progress

## Current Task
- HyperTerm Ralph Loop Iteration 11 완료 — SSH 연결 관리자

## Last Session (2026-03-29)
- **Iteration 7**: Command Palette 구현 (Cmd+Shift+P)
- **Iteration 8**: tmux copy-mode 검색 (Cmd+F)
- **Iteration 9**: 탭 Drag & Drop 순서 변경
- **Iteration 10**: 폰트 크기 조절 (Cmd+Plus/Minus/0), Cluster/Project 그룹핑 (Cmd+Shift+G), Activity Monitor (프로세스 CPU/Memory 실시간 표시)
- **Iteration 11**: SSH 연결 관리자 (Cmd+Shift+S)
  - `ssh:listProfiles`, `ssh:saveProfile`, `ssh:deleteProfile`, `ssh:getSshCommand` IPC 핸들러 추가
  - SSH 프로필 패널 UI + 추가/편집 모달
  - 프로필 클릭 시 새 탭에서 SSH 연결
  - Command Palette에 "Open SSH Profiles" 명령 추가
  - `global.d.ts`에 SSH API 타입 추가
  - `createNewTab()` 반환값을 `number | null`로 변경 (SSH 연결 시 탭 ID 필요)
  - 빌드 & 패키징 완료 (`release/mac-arm64/HyperTerm.app`)

## Next Steps
- [ ] Iteration 12: 테마 지원 (라이트/다크 커스텀 테마)
- [ ] Iteration 13: Quick Commands (F1-F12 커스텀 단축키)
- [ ] SSH 프로필 연결 후 노트/브로드캐스트 정상 동작 확인
- [ ] Cluster 그룹핑 상태에서 세션 복원 정상 동작 확인

## Key Decisions
- **탭 X = tmux 세션 종료**: 탭 닫으면 tmux kill, 앱 종료(Cmd+Q)는 detach만
- **메타데이터 즉시 저장**: 세션 생성/이름변경/삭제 시마다 sessions.json 저장
- **폰트**: SF Mono 12pt (macOS Terminal 기본)
- **테마**: macOS Terminal 스타일 (배경 #1c1c1c, 텍스트 #d0d0d0)
- **스크롤은 tmux copy-mode**: xterm.js scrollback 미사용, wheel 이벤트를 tmux로 프록시
- **sidebar label vs pane header**: sidebar label은 사용자 정의 이름(tmux 무관), pane header는 tmux 세션 이름
- **SSH 프로필**: ssh-profiles.json에 저장, 프로필 클릭 시 `ssh <user>@<host> -p <port>` 명령 실행
- **Command Palette**: VS Code 스타일, 검색 필터링, 키보드 네비게이션

## Blockers / Notes
- macOS arm64 전용 빌드
- 코드 서명 ad-hoc — 배포 시 Apple Developer 인증서 필요
- Ralph Loop: max 20 iterations, Iteration 11 완료 (남은 iterations: 9개)
