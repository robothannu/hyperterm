# HyperTerm

## Overview
HyperTerm — macOS용Electron 터미널 앱. xterm.js + tmux 통합.

## Session Continuity
- At session start, always check `progress.md` for current work status.
- Before ending a session, run `/stopwork` to save progress.

## Architecture: Group vs Session
- **Group** = 사용자가 변경하는 이름. tmux 세션 이름과 무관. 사용자가 그룹을 삭제하기 전까지 변경 사항이 저장되고, 앱 재실행 시 `sessions.json`에서 복원된다.
- **tmux session** = 내부 멀티 세션 관리용. 그룹 이름과 동기화되지 않는다.
- `tabLabels` Map: tabId → 그룹 이름 (사용자 정의 레이블)
- `saveSessionMetadata()`: 그룹 이름, 클러스터, 레이아웃을 `sessions.json`에 저장
- 복원 시 `savedTab.label` → `tabLabels.set(tabId, savedTab.label)`
