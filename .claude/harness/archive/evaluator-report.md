# Evaluator Report — Sprint 6 (Iteration 1)

Feature: Settings UI Modal + Sidebar MRU
Date: 2026-04-18

## Build / Artifacts
- `npm run build` 성공 (tsc + copy-static). 에러 없음.
- dist/renderer/settings-modal.js (8109B), sidebar-mru.js (sibling .map도 생성됨) 존재.
- 기존 18개 renderer 모듈 유지. main.js 빌드 정상.

## Source Verification

### Feature 1: Settings Modal
- AC1 Cmd+,: settings-modal.ts L201-208에서 `document.addEventListener("keydown")`으로 metaKey+"," 처리. 토글 동작(열려있으면 close, 닫혀있으면 open). PASS
- AC2 폰트 슬라이더: L144-151 input 이벤트에서 `applyFontSizeToAll()`이 모든 sessions에 대해 `session.setFontSize(size)` 호출. terminal-session.ts L145에 setFontSize 정의 존재. min=10, max=24, 기본 14 (index.html L170). PASS
- AC3 테마 토글: L155-157 change 이벤트, `applyTheme`이 body.theme-light/theme-dark 클래스 교체. styles.css L1722~에 light theme 규칙 존재. PASS
- AC4 Claude 알림 토글: currentSettings.claudeNotifications 반영, 기본 false. PASS
- AC5 Hook 상태: L56-71 hookCheckInstalled 결과로 "설치됨/미설치" 표시. 설치 버튼 존재, click 핸들러에서 hookInstall() 호출. PASS
- AC6 IPC: getSettings/saveSettings 사용. main.ts L625-630 핸들러 확인. AppSettings 타입에 fontSize/theme/recentProjects 필드 모두 존재 (global.d.ts L31-36 및 main.ts L41-46). PASS
- AC7 ESC + overlay click: L196-200 ESC 처리, L188-190 overlay 클릭(e.target===modal) 처리. 둘 다 closeSettingsModal() 호출하며 내부에서 saveSettingsFromUI() 실행. PASS

### Feature 2: Sidebar MRU
- AC1 git root 감지 훅: git-status.ts L111-117에서 projectRoot 변경 시에만 `addMruProject(projectRoot)` 호출. 캐시된 prevCached.projectRoot와 비교해 변경 시에만 추가 — 효율적. PASS
- AC2 dedup + max10: sidebar-mru.ts L42-54. indexOf 검색, 존재 시 splice 후 unshift, length>10이면 slice(0,10). 같은 경로가 이미 top(idx=0)이면 early return. 로직 정확. PASS
- AC3 저장: AppSettings.recentProjects 필드, saveSettings/getSettings 통해 저장. PASS
- AC4 렌더: createMruSectionDOM이 sidebar-mru-section을 #sidebar 하단에 append, "Recent Projects" 헤더 + 접기 토글, 기본 항목 렌더. CSS .sidebar-mru-section에 margin-top:auto로 하단 고정. PASS
- AC5 클릭 → 새 탭: onMruEntryClick이 createNewTab(label, projectPath) 호출. renderer.ts의 createNewTab은 cwd 인자 수용. PASS
- AC6 경로 미존재 회색: 스펙에서 제외됨 — 스킵.

## Adversarial Tests

1. **같은 경로 11번 addMruProject**: 첫 호출 후 idx===0 early return이 계속 발동 → mruProjects length=1 유지. saveMruProjects도 1회만 호출됨. 정상.
2. **서로 다른 11개 경로 추가**: 11번째에서 length=11 → slice(0,10) → 가장 오래된 항목 버림. 정상.
3. **빈 recentProjects getSettings**: `settings.recentProjects ?? []`로 방어. renderMruSection이 길이 0이면 "최근 프로젝트 없음" li 출력. 정상.
4. **Race — 모달 열려있는 중 MRU 업데이트**: 모달 open 시 `currentSettings = await getSettings()` 스냅샷. 모달이 열려있는 동안 git poll이 addMruProject → saveMruProjects가 `getSettings()` → save → appSettings 갱신. 사용자가 모달 닫으면 saveSettingsFromUI가 `...currentSettings(old recentProjects)...`로 send → main이 {...appSettings, ...settings}로 병합 → **old recentProjects로 덮어씌워짐** (최신 MRU 유실 가능). **MINOR 버그**: 실제 빈도는 낮으나 이론상 존재. 권장: saveSettingsFromUI가 send 직전 currentSettings를 최신화하거나 recentProjects를 payload에서 제외.
5. **설치 버튼 동시 클릭**: installBtn.disabled=true로 잠가 놓음. 정상.
6. **Cmd+, 빠른 연타**: open/close 토글되며 각 close마다 save 발생. IPC 부하 가능하나 문제 수준 아님.

## Regression
- 기존 dist 산출물 유지, main.ts IPC 추가만으로 기존 핸들러 영향 없음.
- styles.css 추가 규칙은 theme-light/MRU 전용, 기존 클래스 수정 없음.
- index.html에 script 태그 2개 추가, 기존 요소 제거 없음.

## Scoring

| Dimension | Score | Note |
|---|---|---|
| Functionality | 5 | 모든 AC 구현, 로직 정확. |
| User Experience | 4 | Cmd+, 토글/ESC/overlay 지원, live preview. Cmd+, 단축키가 settings-modal 자체에서 처리되어 keybindings.ts 일관성과 조금 어긋남. |
| Visual Quality | 4 | MRU/모달 CSS, light theme 규칙 존재. light theme 커버리지가 일부 영역(터미널 pane 등)에 한정될 수 있으나 코드상 충분한 기본. |
| Edge Cases | 4 | dedup/trim/빈 배열 OK. 모달+MRU race 미세 결함. |
| Performance | 5 | MRU는 projectRoot 변경 시에만 추가, 폰트 live 적용은 O(sessions). 문제 없음. |
| Regression | 5 | 빌드 성공, 기존 모듈 영향 없음. |
| **Total** | **27/30** | |

Verdict: **PASS** (>=24, 어떤 차원도 1/5 아님, MUST FIX 없음)

## Recommendations (non-blocking)
- saveSettingsFromUI의 payload에서 recentProjects를 제외하거나, close 시 최신 getSettings를 다시 읽어 merge하면 race 해결.
- Cmd+, 처리를 keybindings.ts에 통합하면 단축키 관리 일원화.
