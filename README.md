# HyperTerm

Electron + xterm.js + tmux 기반 macOS 터미널 앱.

세션을 tmux로 관리하여 앱을 종료해도 작업이 유지되고, 재실행 시 자동 복원됩니다.

## 주요 기능

- **탭 기반 터미널 관리** — 사이드바에서 터미널 생성/전환/이름변경/삭제
- **Pane 분할** — 좌우/상하 분할, 드래그로 비율 조절
- **세션 복원** — tmux 기반으로 앱 재시작 시 모든 세션 자동 복원
- **노트** — 터미널별 메모 기능 (앱 재시작 후에도 유지)
- **Claude 사용량 표시** — 하단 상태바에 Claude Code 플랜 사용률 표시 (5h/7d, 5분 자동 갱신)
- **클립보드** — 텍스트 및 이미지 붙여넣기 지원 (Claude Code 이미지 입력 호환)
- **macOS Terminal 스타일 테마** — SF Mono 12pt, 중립 그레이 톤

## 시스템 요구사항

| 항목 | 요구사항 |
|------|----------|
| OS | macOS (arm64 / Apple Silicon) |
| Node.js | 18 이상 |
| npm | 9 이상 |
| tmux | 번들 포함 (별도 설치 불필요) |

> 현재 macOS arm64 전용입니다. Intel Mac 및 Windows/Linux는 지원하지 않습니다.

## 설치

### 빌드된 앱 사용 (권장)

[Releases](https://github.com/robothannu/hyperterm/releases)에서 DMG를 다운로드하거나, 직접 빌드:

```bash
git clone https://github.com/robothannu/hyperterm.git
cd hyperterm
npm install
npm run dist
```

빌드 결과물:
- `release/HyperTerm-0.1.0-arm64.dmg` — DMG 설치 파일
- `release/mac-arm64/HyperTerm.app` — 앱 번들

### 개발 모드

```bash
git clone https://github.com/robothannu/hyperterm.git
cd hyperterm
npm install
npm start
```

## 사용법

### 터미널 관리

| 동작 | 방법 |
|------|------|
| 새 터미널 | 사이드바 `+` 버튼 |
| 터미널 전환 | 사이드바에서 클릭 |
| 이름 변경 | 사이드바에서 더블클릭 |
| 터미널 닫기 | 사이드바 `x` 버튼 (tmux 세션도 종료) |
| 앱 종료 | `Cmd+Q` (tmux 세션 유지, 재실행 시 복원) |

### Pane 분할

터미널 영역에서 우클릭하여 컨텍스트 메뉴에서 좌우/상하 분할을 선택합니다. 분할선을 드래그하여 비율을 조절할 수 있습니다.

### 키보드 단축키

| 단축키 | 동작 |
|--------|------|
| `Cmd+C` | 선택 텍스트 복사 (선택 없으면 SIGINT) |
| `Cmd+V` | 텍스트 붙여넣기 |
| `Ctrl+V` | 이미지 붙여넣기 (Claude Code 호환) |
| `Cmd+A` | 전체 선택 |

### Claude 사용량 상태바

하단 상태바에 Claude Code 플랜 사용률이 표시됩니다.

- **표시 형식:** `5h: N% | 7d: N%`
- **자동 갱신:** 5분마다
- **수동 갱신:** 상태바 클릭
- **색상:** 80% 이상 노랑, 95% 이상 빨강
- **요구사항:** Claude Code에 로그인된 상태 (OAuth 토큰이 macOS Keychain에 저장되어 있어야 함)

### 노트

사이드바에서 연필 아이콘을 클릭하면 해당 터미널에 대한 노트를 작성할 수 있습니다. `Cmd+Enter`로 빠르게 추가할 수 있습니다.

## 기술 스택

- **Electron** 34 — 앱 프레임워크
- **xterm.js** 6 — 터미널 에뮬레이터 (WebGL 렌더링)
- **node-pty** — PTY 프로세스 관리
- **tmux** — 세션 관리 (vendor 번들)
- **TypeScript** 5

## 코드 서명

현재 ad-hoc 서명입니다. 배포 시 Apple Developer 인증서가 필요합니다.

## 라이선스

MIT
