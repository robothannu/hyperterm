# Work Progress

## Current Task
- **completed** — Workspace Dashboard 기능 (Sprint 1+2+3) main에 머지 완료. AC7 시각 검증만 사용자 몫.

## Last Session (2026-04-27)

### Sprint 3 빌드 마무리 + 평가 + 머지
이전 세션에서 working tree에 부분 구현된 Sprint 3 코드를 인계받아 검증·보완 후 PASS 머지.

**Builder (Sprint 3 마무리)**
- Files Modified: `src/main/{main,workspaces}.ts`, `src/preload/{preload,dashboard-preload}.ts`, `src/renderer/{dashboard.ts,dashboard.html,renderer.ts,global.d.ts}`, `test/workspaces.test.mjs`
- 핵심 추가:
  - `workspace:openInMain` IPC: dashboard 카드 Open → mainWindow focus + `group:openWithCwd` 송신 (`main.ts:749`)
  - `group:openWithCwd` 렌더러 핸들러: getCwd 기반 중복 group 감지 → `switchToTab` or `createNewTab(folderName, cwd)` (`renderer.ts:1052`)
  - `workspace:rename` IPC + `renameWorkspace()` (`workspaces.ts:120`) — inline 이름 편집 + 영속
  - empty state UI: `#empty-state` + `#btn-empty-add` (`dashboard.html:636`)
  - missing 폴더 UX: Open 비활성 + "Remove from list" 버튼 (`dashboard.ts:229,362`)
  - 카드별/전체 Refresh (`dashboard.ts:393,605`)
  - `escapeHtml`에 single-quote escape (Sprint 2 carryover 해소)
  - Sprint 2 잔존 `#empty-state` CSS 중복 규칙 제거
- 테스트: `workspaces.test.mjs` +9 (rename TDD 6 + cwd 정규화 3)

**코드 리뷰 (Orchestrator)**
- forceQuitTimer race 발견 → 패치 (`main.ts:766-771`): `mainWindow` 닫힌 후 Open 시 `forceQuitTimer` clear + `isQuitting=false` → 새 윈도우가 stale timer로 destroy되지 않음

**검증**
- `npm run build` 0
- `node test/workspaces.test.mjs` → **17/17 PASS** (기존 8 + Sprint 3 신규 9)
- `npm run dist` 0 → `release/mac-arm64/HyperTerm.app` (Apr 27 22:31), DMG/ZIP 함께 생성

**Evaluator 결과 (Sprint 3 Iter 1)**
- **PASS 32/35**: Func 5 / UX 4 / Visual 5 / Edge 4 / Perf 5 / Regression 5 / CodeQ 4
- MUST FIX 0 / Hard threshold 위반 0
- Findings (NICE TO HAVE):
  - F1: Open 버튼 in-flight 동안 disabled 처리 권장 (rapid double-click race)
  - F2: rename 시 maxLength 가드 부재
  - F3: dashboard.ts 650줄 monolith — 차후 `dashboard-card.ts` 등 모듈 분할 권장

**Git**
- Sprint 3 commit: `0c8da2c sprint 3: 카드 → 메인 윈도우 그룹 열기 + 폴리싱`
- Merge: `da6cce6 merge: Workspace Dashboard (Sprint 1+2+3)` (--no-ff)
- `feature/workspace-dashboard` 브랜치 삭제됨
- main 7 commits ahead of origin/main (push 미실행)

## Next Steps
- [ ] **HIGH: AC7 시각 검증** — `open release/mac-arm64/HyperTerm.app` 후 시나리오 직접 확인
  - AC1: 카드 Open → 메인 윈도우 focus + 새 group 생성
  - AC2: 동일 카드 두 번 → 기존 group 활성화 (toast: "Switched to existing workspace terminal.")
  - AC3: 폴더 mv → Refresh → Open 비활성화 + "Remove from list" 표시
  - AC4: workspaces.json 비우고 재시작 → 빈 상태 안내
  - AC5: 카드별/전체 Refresh 작동
  - AC6: 카드 이름 편집 → 재시작 후 유지
- [ ] **MEDIUM: origin/main push** — 시각 검증 후
- [ ] **LOW: NICE TO HAVE 후속 작업**
  - F1: Open 버튼 in-flight disable
  - F2: rename maxLength 가드 (예: 80자)
  - F3: `dashboard.ts` 650줄 → `dashboard-card.ts` 등 분할

## Key Decisions
- **getCwd 기반 중복 감지**: pty-manager의 lsof 기반 실제 cwd 조회. 사용자가 `cd`로 이동하면 미감지(best-effort) — sprint contract에 명시.
- **mainWindow 부재 시 createWindow + did-finish-load 대기**: 카드 Open이 mainWindow 닫힌 상태에서도 동작.
- **forceQuitTimer race 방지**: 새 mainWindow 생성 시 stale timer clear (3초 destroy 방지).
- **renameWorkspace null 반환 패턴**: 빈 이름/미존재 id → null. IPC가 `{success:false}` 응답.
- **vendor/ 오프라인 번들 유지**: marked v9 + DOMPurify, renderer가 node_modules 직접 import 못 하는 환경 우회.

## Harness State
- Phase: complete — Workspace Dashboard 완료 (branch merged)
- Feature: -
- Branch: -
- Sprint: 3/3, Iteration: 1
- Total score: 95/105 (S1 31, S2 32, S3 32)
- Resume: `/harness` (필요 시 modification/extension/new feature 모드)

## Blockers / Notes
- **AC7 packaged 시각 검증 미완** — 빌드는 성공, 실제 .app 실행 시나리오는 사용자 확인 필요
- macOS arm64 전용
- workspaces.json 위치: `~/Library/Application Support/HyperTerm/workspaces.json`
- 패키징 산출물: `release/mac-arm64/HyperTerm.app`, `release/HyperTerm-0.1.0-arm64.dmg`
