# Work Progress

## Current Task
- HyperTerm 터미널 앱 — 버그 수정 및 디자인 개선 완료, 추가 기능 대기

## Last Session (2026-03-28)
- **붙여넣기 두 번 되는 버그 수정** (terminal-session.ts): `e.preventDefault()` 추가
- **폰트를 SF Mono 12pt로 변경** (terminal-session.ts): macOS Terminal 기본 폰트
- **UI 테마를 macOS Terminal 스타일로 전면 변경** (styles.css, terminal-session.ts): 배경 #1c1c1c, 텍스트 #d0d0d0, 중립 그레이 톤, ANSI 컬러 macOS 기본 팔레트
- **마우스 휠 스크롤 수정** (pty-manager.ts): tmux mouse off 설정
- **스크롤바 항상 표시** (styles.css): overflow-y: scroll, 10px 너비 스크롤바
- **빌드 시 vendor 바이너리 자동 서명** (scripts/sign-vendor.js, electron-builder.yml): afterSign 훅
- **뱃지 기능 시도 후 제거** (renderer.ts, styles.css): 백그라운드 탭 활동 알림 구현했으나, tmux 제어 시퀀스로 인한 허위 알림 문제로 제거

## Next Steps
- [ ] 실제 사용 테스트: 세션 생성/복원/이름 유지
- [ ] 한글 출력 정상 동작 확인
- [ ] 노트 기능 테스트 (추가/삭제/앱 재시작 후 유지)
- [ ] 탭 X 버튼 동작 정책 재검토 (현재: tmux 세션까지 종료. 유지 옵션 고려?)
- [ ] afterSign 훅이 dylib까지 서명하는지 검증 (현재 수동 서명 필요)

## Key Decisions
- **탭 X = tmux 세션 종료**: 탭 닫으면 tmux kill, 앱 종료(Cmd+Q)는 detach만
- **메타데이터 즉시 저장**: 세션 생성/이름변경/삭제 시마다 sessions.json 저장
- **폰트**: SF Mono 12pt (macOS Terminal 기본)
- **테마**: macOS Terminal 스타일 (배경 #1c1c1c, 텍스트 #d0d0d0)
- **tmux mouse off**: 마우스 이벤트는 xterm.js/DOM에서 처리
- **뱃지 기능 불채택**: tmux 제어 시퀀스가 허위 알림을 유발하여 실용적이지 않음

## Blockers / Notes
- 프로젝트가 git 저장소가 아님
- macOS arm64 전용 빌드
- 코드 서명 ad-hoc — 배포 시 Apple Developer 인증서 필요
- afterSign 훅이 tmux만 서명하고 dylib는 미서명 — 수동 codesign 여전히 필요
