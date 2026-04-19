# Plan: Renderer Process Hardening — Code Review Issue Remediation

## Iteration: 1
## Project Type: web
## Strategy: NEW

## Goal
코드 리뷰에서 발견된 15개 이슈를 3개 스프린트로 해결한다. Sprint 1은 메모리·리스너 누수(장기 세션 안정성), Sprint 2는 race condition·에러 가시성(정확성), Sprint 3은 polling 효율·UX 개선(품질) 순으로 진행한다.

## Sprints

### Sprint 1: Leak & Lifecycle Hygiene
**Deliverable**: 이벤트 리스너, 옵저버, 타이머가 사이드바 재렌더·탭 생성/삭제·앱 종료 시 결정론적으로 해제된다.
**Covers**: #1(sidebar 리스너), #2(pane-click 리스너), #3(ResizeObserver), #8(global keydown on quit)

**Acceptance Criteria**:
1. [ ] 20개 탭 생성 → 15개 삭제 → 10개 rename 후, DevTools "Event Listeners" 패널에서 `#terminal-list` 엘리먼트의 리스너 수가 탭 수에 비례해 증가하지 않는다(상한 bounded).
2. [ ] 앱 리로드(`Cmd+R`) 후 콘솔에 orphaned observer 경고 없음, DevTools Memory에서 이전 사이클의 sidebar `<li>` detached node 잔류 없음.
3. [ ] File → Quit 시 resize observer, agent polling, git polling, global keydown handler 해제 로그가 콘솔에 확인되고 `quitReady` 전에 출력된다.
4. [ ] 같은 pane을 30회 열고 닫아도 DevTools에서 해당 pane 컨테이너의 mousedown/mouseup 핸들러 수가 증가하지 않는다.
5. [ ] 3번의 renderSidebar() 재렌더 후 click, double-click rename, drag-reorder, notes-button, close-button 이 모두 정상 동작한다.

---

### Sprint 2: Correctness & Failure Visibility
**Deliverable**: 탭·pane lifecycle이 race-safe, IPC 에러가 사용자에게 노출, hook 미지원 이벤트 로깅, 전역 function 타입 검사 제거.
**Covers**: #4(closePaneByPtyId race), #5(createNewTab partial state), #6(agent polling silent error), #7(tab 생성 UI 피드백), #11(typeof 검사), #14(unknown hook event)

**Acceptance Criteria**:
1. [ ] PTY 생성 강제 실패 시 (a) 사용자에게 토스트/상태바 오류 메시지, (b) sidebar에 phantom 항목 없음, (c) tabMap·tabLabels·tabClusters·ptyToTab에 실패한 탭의 항목 없음(콘솔 dump 확인).
2. [ ] pane 닫기 중 IPC teardown이 진행 중일 때 uncaught promise rejection 없음, 형제 pane이 500ms 이내 키 입력 수용.
3. [ ] agent-status IPC 반복 실패 시(main process 핸들러 비활성화 시뮬레이션) statusbar에 폴링 저하 표시, 콘솔에 throttled warning 출력(silent 아님).
4. [ ] 미지정 hook event 수신 시 `console.warn`에 해당 이벤트 이름 출력, 어떤 pane의 agentState도 변경되지 않음.
5. [ ] Changed Files 패널 refresh가 `typeof` 런타임 검사 없이 모듈 로드 여부에 따라 명시적으로 처리된다.
6. [ ] create tab → split pane → close pane → close tab → invalid-dir tab(실패) → rename → reorder 시나리오에서 DevTools 콘솔 uncaught error 없음.

---

### Sprint 3: Polling Efficiency & UX Polish
**Deliverable**: 비활성 탭 polling 축소, stale MRU 항목 제거, settings 기본값 신규 세션 반영, notes 미저장 경고.
**Covers**: #9(git polling scope), #10(agent polling batching), #12(notes 미저장 경고), #13(MRU path validation), #15(settings 신규 세션 반영)

**Acceptance Criteria**:
1. [ ] 8개 탭 중 1개만 표시 시, 5초 polling 창당 main process git IPC 호출 수가 탭 총 수가 아닌 활성 탭 수에 비례한다(main process 로그 확인). 탭 전환 후 1 polling 주기 이내 비활성 탭 git 배지가 갱신된다.
2. [ ] 활성 탭의 agent-status polling이 N개 pane을 대상으로 하나의 burst로 실행된다(main process 로그에서 단일 그룹으로 확인 가능). 비활성 탭에 대한 IPC 호출 없음.
3. [ ] notes panel 닫기(close 버튼·ESC·오버레이 클릭) 시 textarea에 미저장 텍스트가 있으면 확인 프롬프트; "취소" → 패널 열린 채 텍스트 유지, "폐기" → 패널 닫고 텍스트 초기화. 빈 textarea면 프롬프트 없음.
4. [ ] 앱 실행 시 디스크에 존재하지 않는 MRU 경로가 목록에서 제거된다. 존재하지 않는 경로 클릭 시 사용자 오류 메시지 표시 후 항목 삭제.
5. [ ] Settings에서 폰트 크기·테마 변경 후 즉시 생성한 신규 탭에 업데이트된 값이 반영된다(변경 전 기본값 아님).
6. [ ] 기존 git 배지, agent 마커, notes 기능, settings 모달 동작 리그레션 없음.

## Architecture Blueprint (advisory)

### Affected Files
- `src/renderer/sidebar.ts` — event delegation으로 전환
- `src/renderer/renderer.ts` — lifecycle teardown, race condition 수정, feature detection
- `src/renderer/hook-state.ts` — unknown event 로깅
- `src/renderer/terminal-session.ts` — pane click listener 안전성
- `src/renderer/agent-status.ts` — 에러 표면화, 활성 탭 전용 polling
- `src/renderer/git-status.ts` — 활성 탭 우선 polling
- `src/renderer/keybindings.ts` — quit 시 teardown
- `src/renderer/notes-panel.ts` — 미저장 확인
- `src/renderer/sidebar-mru.ts` — 경로 존재 검증
- `src/renderer/settings-modal.ts` — 신규 세션 기본값 전파

### Component Relationships
- Renderer lifecycle hub: 단일 init / teardown 지점 (현재 init.ts)
- Sidebar: 순수 render target, `#terminal-list`에 delegation으로 이벤트 중계
- Polling modules: `activeTabId` 기준으로 scope 제한

## Constraints
- Group vs. tmux-session 아키텍처 유지
- sessions.json / settings JSON 스키마 불변
- 기존 키보드 단축키·한국어 문자열 유지
- 신규 외부 의존성 없음
- 모듈별 독립 편집 가능성 유지

## Self-Review Checklist
- [x] 모든 수락 기준이 실행 중인 앱 관찰로 검증 가능
- [x] 구현 세부사항(함수명·알고리즘) 없음
- [x] 스프린트 3개, 각각 독립 검증 가능
- [x] 15개 리뷰 이슈가 정확히 하나의 스프린트에 배치됨
- [x] 위험도 순 정렬: 누수 → 정확성 → 효율/UX
