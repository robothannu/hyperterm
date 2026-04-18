# Work Progress

## Current Task
- 버그 수정 완료 (그룹 이름 편집)

## Last Session (2026-04-18)
- **그룹 이름 편집 버그 수정 (2개 커밋)**:
  - `a52f562` — Sprint 2에서 `.terminal-entry-row` 래퍼 추가 후 `li.insertBefore(input, labelEl)` 깨짐 수정. `labelEl.parentElement`를 부모로 사용.
  - `45fb5ea` — 더블클릭 시 이름 삭제되는 버그 수정:
    - `tabLabels.get(tabId)` 를 source of truth로 사용 (`labelEl.textContent` 대신)
    - `setTimeout(0)`으로 focus 딜레이 → 더블클릭 이벤트 체인 완료 후 focus
    - `committed` 플래그로 중복 commit 차단
    - `mousedown` stopPropagation 추가

## Previous Sessions (2026-04-18)
- **병렬 Claude 워크플로 UX 개선 8개**: cwd 복원, Cmd+1..9 탭 전환, 상태바 카운터, Done glow, Activity 히스토리, closeTab 누수 수정, git 폴링 통합, saveSession 디바운싱
- **Usage 버그 수정**: Node https.get → curl execFile
- **Statusbar UI 재설계**: 슬림 바, 색상 계층화
- **hook.sh**: socat → nc -U (macOS 내장, 외부 의존성 제거)
- **알림**: 토스트 + 사이드바 dot pulse
- **빌드**: `release/HyperTerm-0.1.0-arm64.dmg` 완료

## Next Steps
- [ ] **HIGH: 실제 Claude Code 연동 검증** — packaged .app에서 `claude` 실행 후 hook 이벤트 왕복 확인
- [ ] **MEDIUM: /Applications 배포** — `cp -r release/mac-arm64/HyperTerm.app /Applications/HyperTerm.app`
- [ ] **LOW: Settings 확장** — auto-switch on approval 토글, sound 알림 옵션
- [ ] **LOW: Diff 뷰어 prev/next** — 파일 간 연속 review 키보드 네비
- [ ] **LOW: 세션 시간 추적** — `⚙ 3m 12s` pane 마커, 10분 초과 시 경고
- [ ] **LOW: 죽은 코드 제거** — `pty-manager.ts`의 미사용 함수들

## Key Decisions
- **Rename**: `tabLabels` Map이 source of truth. `labelEl.textContent`는 injected element 영향 받을 수 있어 신뢰 불가.
- **Hook 통합**: Claude Code hooks → Unix socket → 상태 머신. `nc -U` (socat 불필요).
- **Usage API**: `curl execFile` — Electron 샌드박스에서 Node https.get보다 안정적.
- **Git 폴링**: git-status + changed-files 공유 캐시(`tabGitCache.files`). 3초 이내면 IPC 생략.
- **cwd 복원**: `SavedPaneLeaf.cwd` optional 필드. 구버전 호환.
- **배포**: Ad-hoc 서명. Gatekeeper 경고 시 `xattr -cr HyperTerm.app`.

## Harness State
- Phase: complete
- Feature: -
- Branch: 2d_gui

## Blockers / Notes
- macOS arm64 전용 빌드 (Intel 미테스트)
- Claude Code 연동은 HyperTerm 앱 실행 중일 때만 소켓 생성됨
