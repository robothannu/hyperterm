# Work Progress

## Current Task
- tmux 완전 제거 완료 (node-pty 직접 shell spawn으로 전환)

## Last Session (2026-04-12)
- **tmux 완전 제거 (3 스프린트)**:
  - **S1 - pty-manager.ts 재작성**: 478줄 → 243줄. tmux 함수 24개 제거, `$SHELL` 직접 spawn, `lsof` 기반 CWD, `ps` 기반 커맨드/프로세스 조회
  - **S2 - IPC/Preload 정리**: tmux IPC 핸들러 16개 제거, `preload.ts` tmux API 제거, `global.d.ts` 인터페이스 갱신
  - **S3 - Renderer 통합**: `renderer.ts` tmux 참조 전부 제거, scrollback 0 → 10000, 세션 복원 로직을 "레이아웃 복원 + 새 PTY spawn"으로 변경
- `grep -rn "tmux" src/` → 0 matches (전체 소스에서 tmux 완전 제거)
- `npm run build` 및 `npm run start` 성공 검증

## Next Steps
- [ ] **HIGH: 앱 실제 동작 검증** — shell prompt, 입력/출력, 탭/pane CRUD, split pane 동작
- [ ] **HIGH: 세션 복원 검증** — 앱 재시작 후 레이아웃 복원 확인
- [ ] **MEDIUM: pane 헤더 표시 확인** — sessionKey 또는 커맨드명 표시 점검
- [ ] **MEDIUM: silent catch 수정** — console.error 로깅 + critical 에러 사용자 표기
- [ ] **LOW: renderer.ts 파일 분리** — notes, sidebar, statusbar 모듈화

## Key Decisions
- **tmux 제거 동의**: 앱 종료 시 세션 소멸 허용. 레이아웃만 복원
- **scrollback**: tmux → xterm.js 네이티브 (10000줄)
- **세션 식별자**: `tmuxName` → `sessionKey` (내부 ID, UI에 노출 안 함)
- **pane navigation**: tmux select-pane 제거 → `getAllLeaves()` 인덱스 순환

## Blockers / Notes
- sessions.json의 기존 V1 포맷 (`tmuxName` 필드)은 무시됨 — 레이아웃 복원 시 leaf 식별자를 사용하지 않으므로 문제 없음
- **macOS arm64 전용 빌드**: Intel 미테스트
