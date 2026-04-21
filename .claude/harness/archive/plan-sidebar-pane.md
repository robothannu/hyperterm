# Plan: 사이드바 Per-Pane 상태 구분 + Per-Pane Git Branch

## Iteration: 1
## Project Type: web
## Strategy: NEW

## Goal
한 그룹(tab)에 여러 pane이 있을 때, 사이드바 카드가 pane별 서브행을 펼쳐 각 pane의 cwd 기반 git branch와 실행/대기(Running/Waiting) 상태를 개별적으로 보여 준다. pane header의 branch 표시도 자기 pane의 cwd에 해당하는 branch로 정확히 바뀐다.

---

## Sprints

### Sprint 1: Per-Pane Git Branch 추적
**Deliverable**: 각 pane이 자기 cwd에 해당하는 git branch/dirty/ahead 정보를 독립적으로 들고 있으며, pane header의 branch 표시가 해당 pane의 실제 cwd 기준으로 정확히 렌더된다.

**Acceptance Criteria** (sprint contract):
1. [ ] 같은 그룹에서 pane A(예: `~/project-a`, branch `main`)와 pane B(예: `~/project-b`, branch `feat/login`)를 수평 split으로 띄웠을 때, pane A의 header에는 `main`, pane B의 header에는 `feat/login`이 각각 표시된다.
2. [ ] pane B의 터미널에서 `cd ~/project-c` (다른 branch의 git repo)로 이동하면, polling 주기 내(10초 이내)에 pane B의 header branch 표시가 `~/project-c`의 branch로 갱신된다. 이때 pane A의 branch 표시는 영향을 받지 않는다.
3. [ ] git repo가 아닌 디렉터리에 있는 pane은 header에서 branch 표시가 숨겨지며, 같은 그룹의 다른 pane(git repo 안)에서의 branch 표시는 영향받지 않는다.
4. [ ] 단일 pane만 있는 그룹에서도 기존과 동일하게 해당 pane의 cwd 기준 branch 정보가 sidebar card meta 영역(branch + dirty + ahead)과 pane header에 표시된다 (regression 없음).
5. [ ] pane이 닫히면 해당 pane에 대한 branch polling/캐시가 정리되어, 이후 로그/콘솔에서 닫힌 pane의 cwd를 poll하려는 시도가 발생하지 않는다.

---

### Sprint 2: 사이드바 카드 Per-Pane 서브행 렌더링
**Deliverable**: 그룹에 2개 이상의 pane이 있을 때 사이드바 카드가 확장되어 pane별 서브행(pane 라벨/cwd + branch + 상태 인디케이터)을 보여 준다. 1개일 때는 기존 레이아웃을 유지한다.

**Acceptance Criteria** (sprint contract):
1. [ ] pane이 1개인 그룹의 사이드바 카드는 기존 2-row 레이아웃(이름/카운트 행 + meta 행)과 시각적으로 동일하며, 서브행 영역이 표시되지 않는다.
2. [ ] pane이 2개 이상인 그룹은 카드 하단에 pane 수만큼의 서브행이 보이며, 각 서브행은 (a) 해당 pane을 식별할 수 있는 라벨 또는 짧은 cwd, (b) 해당 pane의 branch(없으면 비표시 또는 대체 문자열), (c) 해당 pane의 상태(Running/Waiting/Idle/Done)를 구분할 수 있는 시각적 표식(텍스트 또는 dot+색상)을 포함한다.
3. [ ] pane을 추가 split 하면 새 서브행이 즉시 카드에 추가되고, pane을 닫으면 해당 서브행이 즉시 제거된다(앱 재시작 없이).
4. [ ] pane의 cwd를 바꿔 branch가 달라지면, Sprint 1과 동일한 polling 주기 내에 해당 서브행의 branch 표시가 갱신된다.
5. [ ] 한 pane의 branch 길이가 매우 긴 경우에도 카드 레이아웃이 깨지지 않고(사이드바 폭을 벗어나지 않음) 축약되어 표시된다.
6. [ ] 서브행 영역은 사이드바 카드 클릭 시 기존 탭 전환 동작을 방해하지 않는다(기존 카드 클릭 동작 regression 없음).

---

### Sprint 3: Per-Pane 상태(Running/Waiting) 서브행 반영
**Deliverable**: 각 pane의 Claude 실행 상태와 hook 기반 상태(working/waiting_approval/idle/done)가 사이드바 서브행에 개별적으로 반영되어, 같은 그룹 안에서 pane마다 상태가 다를 때 시각적으로 구분된다. 기존 집계 뱃지(`⚙ Running`/`⚠ Waiting`)도 pane 상태의 합집합을 정확히 반영하도록 유지된다.

**Acceptance Criteria** (sprint contract):
1. [ ] 같은 그룹에서 pane A는 Claude 실행 중(Running), pane B는 승인 대기(Waiting)일 때, 사이드바 카드의 서브행 A는 Running을 나타내는 표식, 서브행 B는 Waiting을 나타내는 표식이 동시에 보인다.
2. [ ] pane A의 Claude가 종료되면 서브행 A의 표식이 Idle(또는 일시적 Done) 상태로 바뀌며, 서브행 B의 Waiting 표식은 그대로 유지된다.
3. [ ] 모든 pane이 idle이면 서브행들의 상태 표식은 Idle로 보이고, 집계용 `.tab-notif` 배지(`⚙ Running`/`⚠ Waiting`)는 숨겨진다.
4. [ ] 하나의 pane이라도 Waiting이면 집계 배지는 `⚠ Waiting`을 보이고 카드 dot-status는 waiting 색을 유지한다(기존 regression 없음).
5. [ ] pane이 Done 상태로 전이될 때 해당 서브행의 표식이 Done으로 일시 표시(기존 8초 done glow와 동일 성격)되고, 이후 자동으로 Idle로 돌아간다.
6. [ ] pane의 상태 변화가 발생할 때, 사이드바 서브행 업데이트는 기존 pane header `.hook-state-marker` 및 `● Claude` 표식과 동일한 시점에 반영된다(둘 사이에 눈에 띄는 시간차가 없음).
7. [ ] pane 1개인 그룹에서는 기존처럼 서브행 없이도 카드 상단의 집계 배지/dot만으로 상태가 올바르게 표시된다(regression 없음).

---

## Architecture Blueprint (advisory)

> 이 섹션은 참고용이며 강제가 아니다. Builder가 더 나은 접근을 찾으면 자유롭게 변경하고 status에 이유를 남겨라.

### Affected Files
- `src/renderer/git-status.ts` — tab 단위 캐시/polling을 pane 단위로 확장. pane별 cwd → projectRoot/branch/dirty/ahead 정보 유지.
- `src/renderer/sidebar.ts` — 사이드바 카드 DOM에 서브행 컨테이너 추가 및 pane 추가/제거 시 서브행 동기화.
- `src/renderer/renderer.ts` — pane 생성/삭제/cwd 변화 시점에 per-pane git cache와 sidebar 서브행 갱신 트리거. `updatePaneHeadersFromGitCache`가 pane별 cache를 참조하도록 확장.
- `src/renderer/hook-state.ts` — pane state 전이 시 사이드바 per-pane 서브행 표식을 함께 갱신(기존 집계 뱃지/하이라이트 경로와 병존).
- `src/renderer/agent-status.ts` — pane별 Claude 실행 상태가 서브행에 반영되도록 훅 포인트 추가.
- `src/renderer/styles.css` — 사이드바 서브행 레이아웃/색상/상태별 표식 스타일.
- `src/renderer/pane-types.d.ts` — 필요 시 PaneLeaf에 per-pane git 캐시/서브행 참조를 노출하기 위한 타입 보강(선택).

### Component Relationships
- Pane cwd polling → per-pane git info: 각 pane의 cwd 변화가 감지되면 해당 pane 단위로 git 정보가 재계산된다.
- Per-pane git info → (a) pane header branch, (b) 사이드바 서브행 branch.
- Per-pane agent/hook state → (a) pane header marker, (b) 사이드바 서브행 상태 표식.
- 사이드바 집계 뱃지(`.tab-notif`, `.card-dot-status`)는 pane 상태의 합집합을 계산해 기존 UX를 유지한다.
- 사이드바 카드 meta 행(branch/changes/ahead): pane이 1개면 기존 동작 유지, 2개 이상이면 서브행으로 대체(Builder 결정).

## Constraints
- 새로운 IPC를 추가하지 말고 기존 `getCwd`/`gitFindRoot`/`gitStatus`/`gitFiles` 경로를 재사용한다. (성능/권한 영향 최소화)
- per-pane polling 확장으로 인한 평균 IPC 부하는 현재 수준 대비 과도하게 증가하지 않아야 한다(예: active tab에 한해 pane 수만큼만 poll, 비활성 tab은 기존 주기 유지).
- pane 상태(`agentState`, `agentStatus`)는 기존 `hook-state.ts`/`agent-status.ts`가 단일 진실 공급원이다. 새로운 상태 저장소를 만들지 말 것.
- 사이드바 서브행 추가가 기존 drag/drop, rename, close 버튼, 탭 전환 동작을 회귀시키지 않아야 한다.
- `sessions.json` 저장 포맷(SavedStateV2)은 변경하지 않는다. 서브행은 순수 파생 UI 상태다.
