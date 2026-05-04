# Work Progress

## Current Task
- **completed** — Workspace Dashboard 디자인 누락분 구현 (Harness 3 sprints, all PASS, main에 머지됨)

## Last Session (2026-05-03)

### 디자인 핸드오프 → Harness 3-sprint 실행

**입력**: Claude Design 핸드오프 번들 `terminal/project/Workspace Dashboard.html` (1309 lines)
- 디자인 vs 현재 구현 갭 분석 → Sprint 1(C안 UX 폴리시) → Sprint 2(B안 Git Flow SVG) → Sprint 3(Discovery banner) 순서로 실행

**Harness 결과** (브랜치: feature/dashboard-design-v2 → main 머지 완료):

| Sprint | 점수 | 커밋 | 변경 |
|---|---|---|---|
| 1 (UX Polish C안) | 32/35 | e93d465 | path `~/...` 줄임 + Sort dropdown(3옵션 persist) + Quick actions [Terminal/IDE/Finder] + 카드 클릭=expand 토글 + Archive/Remove `⋯` 메뉴 |
| 2 (Git Flow SVG B안) | 33/35 | df9e42b | expand 시 카드 하단 SVG 다이어그램 (lane/commit/edge/HEAD/tag) + `workspace:gitFlow` IPC + cache + G1 fix(reload 시 expand 카드 auto-fetch) |
| 3 (Discovery Banner) | 33/35 | 04be1f3 | `~/dev`/`~/work`/`~/projects` 1단계 스캔 + 미등록 git repo 후보 배너 + Review 모달 batch add + Dismiss(세션) |
| merge | — | de497a3 | merge: Workspace Dashboard 디자인 누락분 구현 (Sprint 1+2+3) |

**Files Modified (총 +1714 / -3)**
- `src/main/main.ts`: 6 IPC handler 추가 (`workspace:homedir`, `:openInTerminal`, `:openInIDE`, `:revealInFinder`, `:gitFlow`, `:discoverCandidates`, `:addBatch`)
- `src/preload/dashboard-preload.ts`: 7 method 노출
- `src/renderer/global.d.ts`: `DashboardAPI` 타입 7개 추가, `DashboardGitFlowData`, `DashboardDiscoveryCandidate`, `DashboardBatchAddResult` 인터페이스 추가
- `src/renderer/dashboard.ts`: 1850+ lines (sort/expand/menu/gitflow/discovery 모두 포함). 모듈 분리 누적 권고
- `src/renderer/dashboard.html`: gitflow CSS + discovery banner CSS + Review modal CSS 추가

**검증**
- TypeScript build 0 errors (3 sprint 모두)
- `npm run build` clean (rm -rf dist + tsc + copy-static)
- 정적 분석으로 acceptance criteria PASS — 코드 grep + 변경 파일 직접 read 기반
- 보안: command injection 차단 (execFileAsync 배열 인자 + 3중 path 검증), SVG XSS 차단 (dashEsc 적용)
- Regression: Sprint 1/2 함수 시그니처 미변경, 기존 PREF_* 키 보존
- **시각 GUI 검증은 사용자 수동 필요**

## Next Steps
- [ ] **HIGH: 새 빌드로 시각 검증** — `npm run package:mac` 또는 `release/mac-arm64/HyperTerm.app` 실행
  - Sprint 1: path tilde, Sort dropdown 3옵션, quick action 3개(Terminal/IDE/Finder), 카드 클릭=expand, ⋯ 메뉴
  - Sprint 2: expand한 git repo 카드 하단 SVG (lane 색, HEAD, tag 깃발). 비-git 폴더는 미렌더 확인. 페이지 reload 후에도 SVG 자동 노출.
  - Sprint 3: dashboard 첫 로드 시 ~/dev 등에 미등록 git repo 있으면 dashed 배너. Review → 모달에서 batch add 동작 확인.
- [ ] **HIGH: 이전 세션 미해결 — Add Workspace 동작 확인** (이전 핫픽스 후 시각 검증 미완)
- [ ] **MEDIUM: origin/main push** — main이 origin 대비 22+ commits ahead (이전 누적 + 이번 4개 커밋). 시각 검증 통과 후
- [ ] **MEDIUM: dashboard.ts 모듈 분리** (1850+ lines) — Sprint 1/2/3 evaluator 누적 SHOULD FIX. 후보: `dashboard-card.ts`, `dashboard-gitflow.ts`, `dashboard-discovery.ts`, `dashboard-persist.ts`
- [ ] **MEDIUM: gitflow cache invalidation** — 같은 세션 내 git 상태 갱신 불가. card-level refresh 또는 fs/HEAD watch
- [ ] **LOW: gitflow lane overflow** — 브랜치 많은 repo 카드 높이 폭주. lane cap 또는 scroll wrapper
- [ ] **LOW: CommonJS shim 근본 해결 검토** (이전 세션 이월)

## Key Decisions
- **Quick actions 정책**: 카드 head 우상단 quick action = [Terminal / IDE / Finder] 3개. Archive/Remove는 `⋯` 더보기 메뉴 1동작 이내. 우클릭 컨텍스트 메뉴 대신 명시적 버튼.
- **Open in terminal vs Footer Open 분리**: quick action `Open in terminal` = 외부 Terminal.app, footer `Open` = HyperTerm 메인 윈도우. 별도 IPC `workspace:openInTerminal` 추가.
- **카드 클릭 = expand 토글**: 카드 본체 클릭 시 status-strip + tags + body + `.card-expand` collapse/expand. expand 상태 localStorage `dashboard.v2.expandedIds` (JSON 배열) persist. footer Open 버튼만 메인 윈도우 오픈.
- **Git Flow lane 분류**: main/master → main, develop/dev → develop, release/* → release, hotfix/* → hotfix, else → feature. Tag는 `git log %D` decoration 파싱(별도 `git tag --points-at` 호출 불필요).
- **Git Flow security**: `execFileAsync` 배열 인자 + path 3중 검증 (`typeof === "string"` + `startsWith("/")` + `fs.existsSync`). shell metacharacter 차단.
- **G1 fix**: `render()` grid 분기 끝부분에 expand 상태 카드 auto-fetch 루프 추가 — reload 후 빈 SVG 이슈 해결.
- **Discovery dedup**: 신규 IPC `workspace:addBatch`가 기존 `addWorkspace()` 헬퍼에 위임 → 단일 dedup 정책.
- **Discovery dismiss**: renderer-only state (localStorage 미사용) → 윈도우 재오픈 시 자동 리셋. C7 spec 충족.
- **(이전 세션 결정 유지)** PREF_* localStorage keys, 디자인 v2 시각 골격, objective 정합성 개선.

## Harness State
- Phase: complete — Workspace Dashboard 디자인 누락분 구현 (branch merged)
- Feature: -
- Branch: -
- Sprint: 3/3, Iteration: 1
- Resume: `/harness` (필요 시 새 기능 요청으로 진입)

## Blockers / Notes
- **사용자 시각 검증 필요** — 자동화 불가. 새 .app으로 직접 클릭/토글 확인
- main 22+ commits ahead of origin/main (이전 + 이번 누적, push 미실행)
- macOS arm64 전용 — Cursor 외 IDE 자동 감지 미지원
- Discovery scan root는 hardcode (`~/dev`, `~/work`, `~/projects`). 다른 위치 추가 시 main.ts `DISCOVERY_ROOT_NAMES` 수정 필요
- workspaces.json: `~/Library/Application Support/HyperTerm/workspaces.json`
- dashboard.ts 1850+ lines — 모듈 분리 누적 SHOULD FIX (Sprint 1/2/3 모두에서 권고)
