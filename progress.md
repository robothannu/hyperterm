# Work Progress

## Current Task
- renderer ES module 에러 수정 완료, 빌드 검증 완료

## Last Session (2026-04-06)
- **`exports is not defined` 에러 수정**: 이전 세션 타입 리팩토링에서 renderer 파일에 ES module `import`/`export` 도입 → tsconfig가 CommonJS로 컴파일 → 브라우저에서 `exports` 미정의 에러 발생
  - `terminal-session.ts`: `import { Terminal }` 등 ES module import 제거 → `declare` 전역 타입 선언으로 변경
  - `terminal-session.ts`: `export class` → `class` (export 키워드 제거)
  - `renderer.ts`: `import { TerminalSession }` → `/// <reference path>` 변경
- **UMD 네임스페이스 접근 수정**: xterm addon들이 `FitAddon.FitAddon` 형태로 노출됨 → `new FitAddon()` → `new FitAddon.FitAddon()` 등으로 변경
- **빌드 검증 완료**: `npm run dist` 성공, `HyperTerm.app` 패키징됨

## Next Steps
- [ ] **HIGH: tmux silent catch 수정** — console.error 로깅 + critical한 건 사용자에게 표기
- [ ] **MEDIUM: session:save 실패 시 경고** — 저장 실패 사용자에게 알림
- [ ] **LOW: renderer.ts 파일 분리** — notes, sidebar, statusbar 모듈화
- [ ] **LOW: pty.spawn timeout 추가** — PTY attach 타임아웃 없음

## Key Decisions
- **그룹 이름 vs 세션 이름 분리 확인**: `tabLabels`(그룹)과 `sessionTmuxNames`(세션)은 독립 관리. 사이드바 rename은 tabLabels만 변경, pane rename은 tmux 세션명만 변경
- **bundler 미도입**: renderer 파일에 bundler 없이 UMD `<script>` + declare 방식 유지. 현재 규모에서 충분

## Blockers / Notes
- **미적용 보안 수정 3개**: silent catch (HIGH), session:save 실패 알림 (MEDIUM), paneId validation (MEDIUM)
- **macOS arm64 전용 빌드**: Intel 미테스트
