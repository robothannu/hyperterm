# Claude Usage Status Bar

## Overview

HyperTerm 앱 하단에 Claude Code 사용량(Pro/Max 플랜)을 표시하는 고정 상태바를 추가한다.

## Data Source

Anthropic OAuth API를 사용하여 사용량 데이터를 가져온다.

- **Endpoint:** `GET https://api.anthropic.com/api/oauth/usage`
- **Auth:** `Authorization: Bearer <oauth-token>`, `anthropic-beta: oauth-2025-04-20`
- **Token location:** macOS Keychain, service name `"Claude Code-credentials"`, JSON 내 `claudeAiOauth.accessToken`

### Response Format

```json
{
  "five_hour": { "utilization": 6.0, "resets_at": "2025-11-04T04:59:59Z" },
  "seven_day": { "utilization": 35.0, "resets_at": "2025-11-06T03:59:59Z" },
  "seven_day_opus": { "utilization": 0.0, "resets_at": null }
}
```

## UI Design

### Status Bar

- **위치:** 앱 최하단, terminal-pane 아래
- **높이:** 24px 고정
- **배경:** #252525 (titlebar보다 약간 어둡게)
- **상단 경계선:** 1px solid #3a3a3a

### Display Format

```
5h: 23%  |  7d: 45%  |  Opus: 12%
```

- 각 항목은 `|`로 구분
- 리셋 시간은 해당 항목에 마우스 hover 시 tooltip으로 표시
- 데이터 로드 실패 시: `Usage: --` 표시
- OAuth 토큰을 찾을 수 없을 때: `Usage: not logged in` 표시

### Color Rules (per metric)

| Range   | Color           |
|---------|-----------------|
| 0-79%   | #808080 (grey)  |
| 80-94%  | #ccaa00 (yellow)|
| 95-100% | #cc3333 (red)   |

### Refresh

- 앱 시작 시 자동 로드 (1회)
- 상태바 클릭 시 즉시 새로고침
- 로딩 중일 때 클릭 무시 (중복 호출 방지)

## Architecture

### main.ts

새로운 IPC 핸들러 추가:

- `usage:fetch` — Keychain에서 OAuth 토큰을 읽고 API를 호출하여 사용량 JSON을 반환
  - `security find-generic-password -s "Claude Code-credentials" -w` 로 Keychain 접근
  - JSON 파싱하여 `claudeAiOauth.accessToken` 추출
  - `https://api.anthropic.com/api/oauth/usage` GET 요청
  - 에러 시 `{ error: string }` 반환

### preload.ts

TerminalAPI에 추가:

- `fetchUsage(): Promise<UsageData | { error: string }>`

### renderer.ts

- 앱 초기화 시 `fetchUsage()` 호출하여 상태바 업데이트
- 상태바 클릭 이벤트에 `fetchUsage()` 바인딩
- `updateStatusBar(data)` — 데이터에 따라 텍스트와 색상 업데이트

### index.html

`#main-area` 다음에 상태바 DOM 추가:

```html
<div id="statusbar">
  <span id="usage-5h" title="">5h: --%</span>
  <span class="usage-sep">|</span>
  <span id="usage-7d" title="">7d: --%</span>
  <span class="usage-sep">|</span>
  <span id="usage-opus" title="">Opus: --%</span>
</div>
```

### styles.css

상태바 스타일 추가 (24px 높이, flex center, 기존 테마 톤)

## Error Handling

- Keychain 접근 실패: `{ error: "keychain" }` — 상태바에 `Usage: not logged in`
- API 호출 실패 (네트워크/401 등): `{ error: "api" }` — 상태바에 `Usage: --`
- JSON 파싱 실패: `{ error: "parse" }` — 상태바에 `Usage: --`

## Files to Modify

1. `src/main/main.ts` — `usage:fetch` IPC 핸들러
2. `src/preload/preload.ts` — `fetchUsage` API 노출
3. `src/renderer/index.html` — 상태바 DOM
4. `src/renderer/styles.css` — 상태바 스타일
5. `src/renderer/renderer.ts` — UI 로직
6. `src/renderer/global.d.ts` — UsageData 타입 (필요 시)
