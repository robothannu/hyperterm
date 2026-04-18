# Work Progress

## Current Task
- 병렬 Claude 워크플로 UX 개선 완료 + packaged .app 빌드 완료

## Last Session (2026-04-18)

**코드 리뷰 & 개선 (Plan Mode → 8개 항목 구현)**:
- **A1 — Pane cwd 복원**: 앱 재시작 시 각 pane이 원래 프로젝트 cwd에서 열림. `SavedPaneLeaf.cwd` 필드 추가, `serializePaneTree` async로 변경
- **A2 — 탭 전환 단축키**: `Cmd+1..9` 탭 점프, `Cmd+Shift+]/[` 순환, `Cmd+Shift+A` 승인 대기 탭 점프
- **A3 — 상태바 글로벌 카운터**: `⚙3 ⚠1 ✓2` 배지 — 전체 탭 Claude 상태 한눈에
- **A4 — Done 시각화**: 작업 완료 시 사이드바 dot 초록 glow(8초) + pane `✓ 완료` 마커(5초)
- **A5 — Activity 히스토리**: 사이드바 "Recent Activity" 섹션, 최근 20개, 클릭 시 탭 점프
- **B1 — closeTab 누수 수정**: 탭 닫을 때 paneAgentMarkers / hookStateMarkers 정리
- **B2 — Git 폴링 통합**: git-status + changed-files 공유 캐시(`filesTs`), 탭 병렬 폴링(`Promise.all`)
- **B3 — 저장 디바운싱**: `saveSessionMetadata` 200ms 디바운스 + quit 시 flush

**버그 수정**:
- `Usage: --` 버그: Node `https.get` → `curl execFile`로 교체 (Electron 환경 HTTPS 실패 원인)
- Statusbar UI 재설계: 3px 슬림 바, 색상 계층화, 어두운 배경
- hook.sh `socat` → macOS 내장 `nc -U`로 교체 (외부 의존성 제거)
- 토스트 알림 + 사이드바 dot pulse 구현 (입력 대기 / 완료 시)
- macOS 알림 기본값 ON

**빌드**: `npm run dist` 성공 → `release/HyperTerm-0.1.0-arm64.dmg` (arm64)

## Next Steps
- [ ] **HIGH: 실제 Claude Code 연동 검증** — packaged .app에서 `claude` 실행 후 hook 이벤트 왕복, 상태 전환 확인
- [ ] **MEDIUM: /Applications 배포** — `cp -r release/mac-arm64/HyperTerm.app /Applications/HyperTerm.app`
- [ ] **LOW: Settings 확장** — auto-switch on approval 토글, sound 알림 옵션
- [ ] **LOW: Diff 뷰어 prev/next** — 파일 간 연속 review 키보드 네비
- [ ] **LOW: 세션 시간 추적** — `⚙ 3m 12s` pane 마커, 10분 초과 시 경고
- [ ] **LOW: 죽은 코드 제거** — `pty-manager.ts`의 `getSessionPid`/`getSessionKey`/`getSessionCurrentCommand`

## Key Decisions
- **Companion 방향**: 풀 IDE 아님. 터미널 중심 유지, Claude Code 세션 시각화에 집중.
- **Process 기반 감지**: data-stream 파싱 금지 (tmux 노이즈 이력). `ps` + binary name 매칭.
- **Hook 통합**: Claude Code settings.json hooks → Unix socket → 상태 머신. `nc -U` (socat 불필요).
- **Usage API**: Node `https.get` 대신 `curl execFile` — Electron 샌드박스에서 더 안정적.
- **Git 폴링**: git-status와 changed-files가 공유 캐시(`tabGitCache.files`) 사용. 3초 이내면 IPC 생략.
- **cwd 복원**: `SavedPaneLeaf.cwd`에 저장, optional이라 구버전 호환.
- **배포**: Ad-hoc 서명. Apple Developer ID 없으면 notarization 불가.

## Harness State
- Phase: complete — HyperTerm Claude Code Companion 완료 + 추가 개선 완료
- Feature: -
- Branch: 2d_gui
- Sprint: -, Iteration: -

## Blockers / Notes
- Gatekeeper 경고 시: `xattr -cr HyperTerm.app` 또는 시스템 설정 > 보안에서 허용
- macOS arm64 전용 빌드 (Intel 미테스트)
- Claude Code 연동은 HyperTerm 앱이 실행된 상태에서만 소켓이 생성됨 (`~/Library/Application Support/HyperTerm/agent.sock`)
