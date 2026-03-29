# Work Progress

## Current Task
- HyperTerm 터미널 앱 — 앱 실행 오류 수정, 스크롤 기능 구현, 세션 이름 동기화 완료

## Last Session (2026-03-29)
- **앱 실행 불가 오류 수정 (2건)**:
  - `electron-builder.yml`: `afterSign` → `afterPack`으로 변경 — vendor 바이너리(tmux, dylib)를 앱 서명 전에 서명하여 sealed resource 깨짐 방지
  - `entitlements.mac.plist`: `com.apple.security.cs.disable-library-validation` 추가 — ad-hoc 서명 시 Electron Framework Team ID 불일치 해결
- **tmux scrollback 스크롤 구현** (renderer.ts, pty-manager.ts, preload.ts, main.ts, global.d.ts):
  - wheel 이벤트를 capture phase에서 가로채 tmux copy-mode로 전달
  - xterm.js 자체 scrollback 비활성화 (`scrollback: 0`)
  - 키 입력 시 자동으로 copy-mode 해제 (`exitCopyMode` IPC 추가)
- **커스텀 스크롤바 제거** (terminal-session.ts, styles.css): tmux copy-mode로 스크롤 처리하므로 불필요한 커스텀 스크롤바 JS/CSS 삭제
- **tmux 세션 이름 동기화** (pty-manager.ts, main.ts, preload.ts, global.d.ts, renderer.ts):
  - 탭 이름 변경 시 `tmux rename-session` 호출하여 tmux 세션 이름 동기화
  - `renameTmuxSession` IPC 추가, 특수문자(`.`, `:`) 자동 치환

## Next Steps
- [ ] 탭 이름 변경 → tmux 세션 이름 동기화 실제 테스트
- [ ] 세션 복원 시 변경된 tmux 이름으로 정상 연결되는지 확인
- [ ] 한글 출력 정상 동작 확인
- [ ] 노트 기능 테스트 (추가/삭제/앱 재시작 후 유지)
- [ ] 탭 X 버튼 동작 정책 재검토

## Key Decisions
- **탭 X = tmux 세션 종료**: 탭 닫으면 tmux kill, 앱 종료(Cmd+Q)는 detach만
- **메타데이터 즉시 저장**: 세션 생성/이름변경/삭제 시마다 sessions.json 저장
- **폰트**: SF Mono 12pt (macOS Terminal 기본)
- **테마**: macOS Terminal 스타일 (배경 #1c1c1c, 텍스트 #d0d0d0)
- **스크롤은 tmux copy-mode**: xterm.js scrollback 미사용, wheel 이벤트를 tmux로 프록시
- **vendor 서명은 afterPack**: afterSign이 아닌 afterPack 훅으로 앱 서명 전에 실행
- **disable-library-validation 필수**: ad-hoc 서명 Electron 앱에서 Team ID 불일치 방지

## Blockers / Notes
- macOS arm64 전용 빌드
- 코드 서명 ad-hoc — 배포 시 Apple Developer 인증서 필요
