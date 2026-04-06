# Work Progress

## Current Task
- 앱 실행 중 (dev mode) — 테스트 진행 중

## Last Session (2026-04-06)
- **빌드 검증 완료**: `npm run dist` 성공, `HyperTerm.app` 패키징됨
- **any 타입 완전 제거**: `terminal-session.ts`, `preload.ts`, `main.ts`, `renderer.ts` 전체 any 타입 교체
  - xterm.js addon들을 proper types로 교체 (`Terminal`, `FitAddon`, `SerializeAddon`, `WebglAddon`)
  - ES module import 방식으로 `/// <reference>` 대체
  - `Note[]`, `UsageResult` 타입 정의 및 적용
  - `V1Session` 타입 추가
  - `err: unknown`로 변경
- **execSync → async 전환** (부분): `getProcessInfo`만 async로 전환
- **XSS 보안 수정**:
  - Notes panel timestamp (`createdAt`)에 `escapeHtml()` 적용
  - Sidebar tab label에 `escapeHtml()` 적용
- **Shell injection 방지**: `tmuxExec` double-quote → single-quote 변경, `sendTmuxKey`/`sendTextToTmux` 따옴표 수정
- **Memory leak 수정**: `onPaneClick` 리스너 누적 문제 해결 + 0나누기 방지
- **코드 리뷰 완료**: 17개 이슈 발견, 4개 즉시 수정 적용
- **앱 실행 테스트 중**: `npm run start`으로 dev mode 실행

## Next Steps
- [ ] **HIGH: tmux 操作全silent catch 수정** — console.error 로깅 + critical한 건 사용자에게 표기
- [ ] **MEDIUM: session:save 실패 시 경고** — 저장 실패 사용자에게 알림
- [ ] **LOW: renderer.ts 파일 분리** — notes, sidebar, statusbar 모듈화
- [ ] **LOW: pty.spawn timeout 추가** — PTY attach 타임아웃 없음

## Key Decisions
- **tmuxExec async 전환 보류**: 20개 이상 함수에서 동기 호출 중. 현재 동작 문제 없음
- **pty-manager 경로 중복 불필요**: `getVendorPath`로 이미 중앙화됨
- **renderer.ts 모듈화 보류**: 1500줄 규모지만 현재 기능 안정적

## Blockers / Notes
- **미적용 보안 수정 3개**: silent catch (HIGH), session:save 실패 알림 (MEDIUM), paneId validation (MEDIUM)
- **macOS arm64 전용 빌드**: Intel 미테스트
- **테스트 중**: 앱 실행해서 검증 중 — 아직 commit 안함
