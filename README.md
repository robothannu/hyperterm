# HyperTerm

macOS용 Electron 터미널 앱. Claude Code와 함께 멀티 세션 작업을 위해 설계됨.

xterm.js + tmux 기반으로 세션이 앱 종료 후에도 유지되며, 재실행 시 자동 복원됩니다.

---

## 주요 기능

### 터미널 그룹 관리
- **사이드바** — 터미널 그룹 목록, 클릭으로 전환
- **그룹 이름 변경** — 더블클릭으로 인라인 편집
- **그룹 클러스터** — `Cmd+Shift+G`로 프로젝트 단위 묶음 설정
- **세션 영속성** — tmux 기반, 앱 종료 후에도 세션 유지 및 자동 복원

### 멀티 패인 분할
- 수평/수직 분할 (우클릭 컨텍스트 메뉴)
- 드래그로 분할 비율 조정
- 레이아웃 프리셋 (툴바에서 1패인 / 2분할 / 3분할 선택)

### Claude Code 연동
- **Running/Waiting 뱃지** — Claude가 작업 중이면 `⚙ Running`, 승인 대기 시 `⚠ Waiting`
- **완료 알림** — 작업 완료 시 `✓ Done` 뱃지 5초 표시
- **멀티탭 동시 모니터링** — 백그라운드 탭의 Claude 세션 상태도 실시간 감지
- **승인 대기 점프** — `Cmd+Shift+A`로 `waiting_approval` 상태 탭으로 즉시 이동
- **Claude Usage** — 상태바에 Claude Code 플랜 사용량 표시 (5h/7d, 5분마다 자동 갱신)

### 사이드바 서브행
각 그룹 항목 아래 pane별 상태 행 표시:
- **git branch** — 현재 작업 브랜치
- **상태 인디케이터** — idle(회색) / running(초록) / waiting(주황 맥박) / done(초록 flash)
- **변경 파일 수** — `●N` 형태로 uncommitted 변경 수

### 테마
- **다크 테마** (기본) — SF Mono, `#0e1014` 배경
- **라이트 테마** — 전체 CSS 변수 재정의로 일관된 색상
- 설정에서 토글

### Changed Files 패널
- `Cmd+Shift+E` — 현재 탭의 git 변경 파일 목록 사이드 패널
- diff 뷰 (diff2html)

---

## 시스템 요구사항

| 항목 | 요구사항 |
|------|---------|
| OS | macOS (Apple Silicon, arm64) |
| Node.js | 18+ |
| npm | 9+ |
| tmux | 번들 포함 (별도 설치 불필요) |

> Intel Mac, Windows, Linux 미지원

---

## 설치

### 빌드된 앱 사용 (권장)

1. [Releases](https://github.com/robothannu/hyperterm/releases) 페이지에서 최신 `HyperTerm-x.x.x-arm64.dmg` 다운로드
2. DMG를 열고 `HyperTerm.app`을 `/Applications`로 드래그
3. **첫 실행은 아래 우회 절차 필요** (앱이 Apple Developer ID로 서명되지 않음)

#### 첫 실행 — Gatekeeper 우회

**방법 1: Finder 우클릭 (권장)**

1. `/Applications`에서 HyperTerm.app **우클릭 → 열기**
2. 경고 창에서 **열기** 클릭
3. 이후부터는 일반 앱처럼 실행 가능

**방법 2: `"손상되었기 때문에 열 수 없습니다"` 메시지가 뜰 때**

macOS Sequoia 이상에서 Quarantine 플래그 때문에 자주 발생. 터미널에서:

```bash
xattr -cr /Applications/HyperTerm.app
open /Applications/HyperTerm.app
```

> **왜 이런 절차가 필요한가?**
> HyperTerm은 Apple Developer ID($99/년)로 정식 서명되지 않아 macOS Gatekeeper가 기본적으로 차단합니다. 악성 소프트웨어가 아니며, 전체 소스코드는 이 저장소에서 확인할 수 있습니다. 무결성 확인은 Release 페이지의 SHA-256 체크섬으로 가능합니다.

### 직접 빌드

```bash
git clone https://github.com/robothannu/hyperterm.git
cd hyperterm
npm install
npm run dist
```

빌드 결과물:
- `release/HyperTerm-<version>-arm64.dmg` — DMG 인스톨러
- `release/mac-arm64/HyperTerm.app` — 앱 번들

### 개발 모드

```bash
git clone https://github.com/robothannu/hyperterm.git
cd hyperterm
npm install
npm start
```

---

## 사용법

### 터미널 그룹

| 동작 | 방법 |
|------|------|
| 새 그룹 | 사이드바 `+` 버튼 또는 `Cmd+N` |
| 그룹 전환 | 사이드바 클릭 또는 `Cmd+1~9` |
| 이전/다음 그룹 | `Cmd+Shift+[` / `Cmd+Shift+]` |
| 이름 변경 | 사이드바에서 더블클릭 |
| 그룹 닫기 | 사이드바 `×` 버튼 |
| 앱 종료 | `Cmd+Q` (tmux 세션 유지됨, 재시작 시 복원) |

### 패인 분할

| 동작 | 방법 |
|------|------|
| 수평/수직 분할 | 터미널 영역 우클릭 → 분할 선택 |
| 패인 간 포커스 이동 | `Cmd+Arrow` |
| 레이아웃 프리셋 | 툴바 버튼 (1패인 / 좌우 / 상하 / 3분할) |

### 키보드 단축키

| 단축키 | 동작 |
|--------|------|
| `Cmd+N` | 새 터미널 그룹 |
| `Cmd+1~9` | N번째 탭으로 이동 |
| `Cmd+Shift+]` / `[` | 다음/이전 탭 |
| `Cmd+Arrow` | 패인 간 포커스 이동 |
| `Cmd+Shift+G` | 클러스터(프로젝트) 이름 설정 |
| `Cmd+Shift+A` | 승인 대기 중인 Claude 탭으로 점프 |
| `Cmd+Shift+E` | Changed Files 패널 토글 |
| `Cmd++` / `Cmd+-` | 폰트 크기 증가/감소 |
| `Cmd+0` | 폰트 크기 초기화 (12pt) |
| `Cmd+C` | 선택 텍스트 복사 (선택 없으면 SIGINT) |
| `Cmd+V` | 텍스트 붙여넣기 |
| `Ctrl+V` | 이미지 붙여넣기 (Claude Code 이미지 입력 호환) |

### Claude Code 연동

앱 실행 시 `~/.config/hyperterm/hook.sh`와 `~/.claude/settings.json`에 훅이 자동 설치됩니다.

| 상태 | 뱃지 | 의미 |
|------|------|------|
| 작업 중 | `⚙ Running` (파란색) | Claude가 응답 생성 또는 툴 사용 중 |
| 승인 대기 | `⚠ Waiting` (주황 맥박) | 권한 승인 필요 |
| 완료 | `✓ Done` (초록, 5초) | 작업 완료 |

- 여러 탭에서 동시에 Claude를 실행해도 각 탭의 상태가 독립적으로 표시됩니다.
- `Cmd+Shift+A`로 승인이 필요한 탭에 즉시 점프할 수 있습니다.

### Claude Usage 상태바

하단 상태바에서 Claude Code 플랜 사용량 확인:
- **형식:** `5h: N% | 7d: N%`
- **자동 갱신:** 5분마다
- **색상:** 80%+ 노란색, 95%+ 빨간색
- **조건:** Claude Code OAuth 로그인 상태 필요

---

## 기술 스택

| 구성요소 | 버전 | 역할 |
|---------|------|------|
| Electron | 34 | 앱 프레임워크 |
| xterm.js | 6 | 터미널 에뮬레이터 (WebGL 렌더링) |
| node-pty | — | PTY 프로세스 관리 |
| tmux | 번들 | 세션 관리 |
| TypeScript | 5 | 렌더러 + 메인 프로세스 |

---

## 라이선스

MIT
