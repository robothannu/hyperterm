# Plan: HyperTerm 2D GUI Redesign — Linear/Raycast Style

## Iteration: 1
## Project Type: web
## Strategy: NEW

## Goal
기존 TypeScript 로직(IPC, PTY, hooks, sessions, git polling)을 보존한 채, HyperTerm.html 목업과 동일한 Linear/Raycast 스타일 다크 UI로 renderer 계층을 리디자인한다. 사용자 체감 변화는 (1) 풍부한 사이드바 카드, (2) 원클릭 레이아웃 프리셋, (3) pane header의 cwd+branch 표시, (4) Claude usage가 중심이 된 status bar 세 축에서 발생한다.

## Sprints

### Sprint 1: Visual Foundation & Chrome
**Deliverable**: 앱 전체 색상/타이포/여백이 Linear/Raycast 톤으로 바뀌고, titlebar·sidebar 섹션 헤더·statusbar 프레임이 새 스타일로 렌더된다. Claude usage bar가 목업 형태로 재배치된다.

**Acceptance Criteria**:
1. [ ] 앱 실행 시 전체 배경이 다크 네이비 톤(#0a0b0f 계열)이며, UI 텍스트는 Inter 계열, 터미널·코드·branch 텍스트는 JetBrains Mono 계열로 표시된다.
2. [ ] Titlebar 중앙에 현재 활성 그룹명과 해당 그룹의 git branch가 한 줄에 표시되며, 그룹 전환/branch 변경 시 업데이트된다.
3. [ ] Sidebar 상단에 "Terminal Groups" 섹션 헤더(uppercase letter-spaced)와 설정·신규 그룹 아이콘 버튼이 목업과 동일한 배치로 존재하며, 클릭 시 기존 동작이 유지된다.
4. [ ] Statusbar가 (왼쪽) Claude 상태 카운터 · (오른쪽) 5H / 7D usage bar 순서로 정렬되고, usage bar 색이 정상/경고/임계 구간에서 각각 indigo·amber·red로 전환된다.
5. [ ] 기존 Settings/About/Help/Cluster/Diff 모달이 새 다크 팔레트와 충돌 없이 표시된다.
6. [ ] `npm run build`가 에러 없이 통과하고, 앱 실행 시 콘솔에 CSS/폰트 로딩 실패 경고가 없다.

### Sprint 2: Rich Sidebar Cards & Pane Headers
**Deliverable**: 사이드바 각 그룹이 project card로 재구성되어 이름·상태 점·카운트·branch·changes·ahead를 한 카드에 표시한다. 터미널 pane header에는 cwd + branch + 제목이 한 줄로 보인다.

**Acceptance Criteria**:
1. [ ] 각 사이드바 그룹 항목에 동시 표시: (a) 상태 점(running=green glow, waiting=amber, idle=gray), (b) 그룹 이름, (c) 우측 카운트 pill(세션 수 또는 live 표식), (d) 하단 메타 라인에 branch 아이콘+단축 브랜치명, dirty 개수, ahead 개수 — git polling 캐시와 실시간 동기화.
2. [ ] 그룹 이름 ellipsis 처리, branch 이름 26자 초과 시 말줄임, 1280px 윈도우에서 카드 폭 overflow 없음.
3. [ ] 기존 기능 전부 작동: 클릭→그룹 전환, 더블클릭→rename, drag reorder, close/notes 버튼, Cmd+1~9, cluster 헤더, MRU 섹션, notification badge(Running/Waiting/Done), sidebar-tab-approval 강조.
4. [ ] 활성 그룹은 indigo gradient 배경 + indigo 테두리로 구분, hover 시 새 팔레트와 일치.
5. [ ] 각 pane header에 한 줄 표시: 상태 점 · cwd(~ 축약) · branch(accent 컬러) · pane 제목 · 우측 mini 버튼(Clear/Split/Close). 더블클릭 rename, 버튼 동작 기존과 동일.
6. [ ] Pane focus 시 indigo border + subtle shadow, hook state marker/notification badge가 새 pane header 안에서 기존 의미로 표시.

### Sprint 3: Layout Presets & Toolbar Row
**Deliverable**: 터미널 영역 상단에 toolbar row가 추가되고, 1/2/3/4-pane 레이아웃 프리셋 버튼을 클릭 한 번으로 적용할 수 있다.

**Acceptance Criteria**:
1. [ ] Toolbar row 우측에 4개 레이아웃 프리셋 버튼(single / split / 3-pane / 4-pane)이 segmented control 형태로 배치되고, 현재 레이아웃에 해당하는 버튼이 indigo 하이라이트된다.
2. [ ] 프리셋 버튼 클릭 시 해당 그룹의 pane 트리가 해당 구조로 재구성된다. 기존 pane은 재사용, 부족분은 신규 생성, 초과분은 기존 close 경로로 처리된다.
3. [ ] 레이아웃 전환 후 xterm.js 리사이즈가 자동 수행되어 모든 pane의 프롬프트가 정상 표시된다.
4. [ ] 선택된 레이아웃이 sessions.json에 저장되고, 앱 재실행 시 해당 그룹 복원 시 동일 레이아웃이 유지된다.
5. [ ] 기존 수동 split(Cmd+D, 우클릭, divider drag)이 프리셋 적용 후에도 작동한다.
6. [ ] Toolbar row가 사이드바 숨김·resize에 관계없이 항상 접근 가능하다.

## Architecture Blueprint (advisory)

### Affected Files
- `src/renderer/index.html` — DOM 골격 확장 (toolbar row, 사이드바 검색, titlebar 중앙)
- `src/renderer/styles.css` — 전역 palette 토큰, 카드·pane header·toolbar·statusbar 재스타일링
- `src/renderer/sidebar.ts` — addSidebarEntryDOM: status dot, count pill, meta row
- `src/renderer/git-status.ts` — updateSidebarGitBadge → 카드 메타 포맷(branch/changes/ahead)
- `src/renderer/renderer.ts` — pane header 마크업 확장(cwd + branch + mini 버튼)
- `src/renderer/statusbar.ts` — 왼쪽 영역 정리, usage bar 시각 토큰 재매핑
- `src/renderer/hook-state.ts` — 마커 컬러만 새 토큰에 매핑, selector 보존
- (Sprint 3 신규) `src/renderer/layout-presets.ts` — 프리셋 적용/복원 로직

### Component Relationships
- titlebar ↔ 활성 탭 레이블·git cache (읽기 전용)
- sidebar card ↔ git-status cache, hook-state, notification badge (기존 API 재사용)
- toolbar row ↔ layout-presets ↔ pane-tree (기존 split/close 경로 재사용)
- statusbar ↔ agent status counter + usage API (기존 IPC 그대로)

## Constraints
- TypeScript 로직(IPC, PTY, hooks, sessions, git polling, MRU, notes)은 기존 signature·동작 유지
- `npm run build`가 각 스프린트 종료 시점에 에러 없이 통과
- 기존 notification 체계(Running/Waiting/Done, sidebar-tab-approval, hook-state marker)는 시각 토큰만 교체, 의미·트리거 보존
- Tweaks panel과 AI error toast는 구현하지 않음
- `#terminal-list`, `.terminal-entry`, `.pane-leaf`, `.pane-header` 등 기존 selector 의존 클래스/ID는 계속 존재해야 함
