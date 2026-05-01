# Work Progress

## Current Task
- **completed** — Workspace Dashboard 카드 objective 정합성 개선 (Harness 3 sprints, all PASS, main에 머지됨)

## Last Session (2026-04-30 ~ 2026-05-01)

### 사용자 리뷰 → Harness 3-sprint 실행

**리뷰 결론**: dashboard 카드가 정보 풍부하지만 멀티세션 허브가 아닌 "프로젝트 백과사전"에 가까움. CLAUDE.md objective(Claude Code 멀티세션 워크플로우 — 여러 프로젝트를 빠르게 오가며 작업)와 미정합.

**Harness 결과** (브랜치: feature/dashboard-objective-alignment, main 머지 완료):

| Sprint | 점수 | 커밋 | 변경 |
|---|---|---|---|
| 1 (HIGH) | 31/35 | cb74a84 | OPEN/HARNESS 세션 뱃지 + Overview 중복 제거(callout, 활동도 row) + dead CSS 정리 |
| 2 (MED) | 32/35 | 85cc660 | 카드 클릭=Open + grid 280px(3→4열) + 컴팩트/확장 토글(default 컴팩트, localStorage persist) |
| 3 (LOW) | 32/35 | 554c880 | Files 섹션 default off + toolbar #btn-toggle-files 글로벌 토글 |
| merge | — | 6818d69 | merge: Dashboard objective 정합성 개선 (Sprint 1+2+3) |

**Files Modified (총 +354 / -61)**
- `src/main/main.ts`: workspace:sessionState IPC + getOpenCwds/getHarnessPhase helpers
- `src/preload/dashboard-preload.ts`: sessionState() 노출
- `src/renderer/global.d.ts`: 타입 추가
- `src/renderer/dashboard.ts`: 뱃지 / 카드 클릭 / 컴팩트 토글 / Files 토글 / 헬퍼 (1260+ lines)
- `src/renderer/dashboard.html`: ws-badge / btn-card-expand / btn-toggle-files CSS + toolbar 마크업

**검증**
- TypeScript build 0 errors (각 sprint)
- `release/mac-arm64/HyperTerm.app` 패키지 산출, asar MD5 = dist MD5 확인 (Sprint 3)
- AC 검증은 코드 + dist + app.asar 정적 분석 + adversarial 시나리오로 진행
- **시각 GUI 검증은 사용자 수동 필요**

## Next Steps
- [ ] **HIGH: 새 빌드로 시각 검증** — `release/mac-arm64/HyperTerm.app` 실행 → OPEN/HARNESS 뱃지, 카드 클릭, 컴팩트 토글, Show Files 토글 동작 확인
- [ ] **HIGH: 이전 세션 미해결 — Add Workspace 동작 확인** (이전 핫픽스 후 시각 검증 미완)
- [ ] **MEDIUM: origin/main push** — main이 origin 대비 17 commits ahead. 시각 검증 통과 후
- [ ] **MEDIUM: dashboard.ts 모듈 분리** (1260+ lines) — Sprint 2/3 evaluator NICE TO HAVE 누적. dashboard-card.ts, dashboard-persist.ts 등 분할 후보
- [ ] **LOW: CommonJS shim 근본 해결 검토** — 별도 tsconfig / 번들러 / ESM 중 택1 (이전 세션 이월)
- [ ] **LOW: localStorage quota 시 in-memory fallback** — 실질 영향 미미

## Key Decisions
- **세션 뱃지 정의**: OPEN = 메인 윈도우 sessions.json 그룹의 leaf cwd와 워크스페이스 path 일치 (path.resolve normalize). HARNESS = 워크스페이스의 `.claude/harness/state.json` `current_phase` ∉ {idle, complete, missing}.
- **Q1 결정**: Overview "목표" row 유지, objective callout 제거 (다른 row와 통일성 + 컴팩트 방향).
- **persist 레이어**: localStorage 채택 (sessions.json/workspaces.json 스키마 보존, IPC 추가 불필요). 키 namespace: `dashboard.cardExpanded.<id>`, `dashboard.showFiles`.
- **컴팩트 default**: 첫 로드 시 Overview만 표시 (Status 이하 hide). sibling selector `.card-section--always-open ~ .card-section--always-open`로 두 번째 always-open(Status)부터 hide.
- **카드 클릭 정책**: missing 카드는 toast 경고, 그 외 카드 본문 영역 클릭 시 Open. 자식 인터랙티브 요소 10곳 모두 stopPropagation.
- **(이전 세션 결정 유지)** CommonJS shim, getCwd 중복 감지, forceQuitTimer race 방지, vendor/ 오프라인 번들.

## Harness State
- Phase: complete — Workspace Dashboard 카드 objective 정합성 개선 (branch merged)
- Feature: -
- Branch: -
- Sprint: 3/3, Iteration: 1
- Resume: `/harness` (필요 시 새 기능 요청으로 진입)

## Blockers / Notes
- **사용자 시각 검증 필요** — 자동화 불가. 새 .app으로 직접 클릭/토글 확인
- main 17 commits ahead of origin/main (이전 세션부터 누적, push 미실행)
- macOS arm64 전용
- 패키징 산출물: `release/mac-arm64/HyperTerm.app`, `release/HyperTerm-0.1.0-arm64.dmg`
- workspaces.json: `~/Library/Application Support/HyperTerm/workspaces.json`
- dashboard.ts 1260+ lines — 모듈 분리 누적 권고 (Sprint 2/3 evaluator)
