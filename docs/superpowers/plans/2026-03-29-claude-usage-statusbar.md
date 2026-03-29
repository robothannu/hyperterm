# Claude Usage Status Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HyperTerm 앱 하단에 Claude Code 사용량(5h/7d/Opus)을 표시하는 상태바를 추가한다.

**Architecture:** main 프로세스에서 macOS Keychain으로 OAuth 토큰을 읽고 Anthropic API를 호출한다. 결과를 IPC로 renderer에 전달하고, renderer는 하단 상태바 DOM을 업데이트한다.

**Tech Stack:** Electron IPC, macOS `security` CLI, Anthropic OAuth API, TypeScript

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/renderer/global.d.ts` | Modify | `UsageData` 타입, `TerminalAPI.fetchUsage` 선언 |
| `src/main/main.ts` | Modify | `usage:fetch` IPC 핸들러 (Keychain + API 호출) |
| `src/preload/preload.ts` | Modify | `fetchUsage()` bridge 노출 |
| `src/renderer/index.html` | Modify | 상태바 DOM 추가 |
| `src/renderer/styles.css` | Modify | 상태바 스타일 |
| `src/renderer/renderer.ts` | Modify | 상태바 UI 로직 |

---

### Task 1: 타입 정의 + IPC 핸들러

**Files:**
- Modify: `src/renderer/global.d.ts`
- Modify: `src/main/main.ts`
- Modify: `src/preload/preload.ts`

- [ ] **Step 1: `global.d.ts`에 UsageData 타입 추가**

파일 맨 위 `PaneInfo` 앞에 추가:

```typescript
interface UsageMetric {
  utilization: number;
  resets_at: string | null;
}

interface UsageData {
  five_hour: UsageMetric;
  seven_day: UsageMetric;
  seven_day_opus: UsageMetric;
}

interface UsageResult {
  data?: UsageData;
  error?: "keychain" | "api" | "parse";
}
```

`TerminalAPI` 인터페이스 안에 (마지막 메서드 뒤에) 추가:

```typescript
fetchUsage(): Promise<UsageResult>;
```

- [ ] **Step 2: `main.ts`에 usage:fetch IPC 핸들러 추가**

파일 상단 import 바로 아래에 `child_process`와 `https` import 추가:

```typescript
import { execSync } from "child_process";
import * as https from "https";
```

`// --- Pane IPC ---` 섹션 바로 앞에 다음 블록을 추가:

```typescript
// --- Usage IPC ---

function getOAuthToken(): string | null {
  try {
    const raw = execSync(
      'security find-generic-password -s "Claude Code-credentials" -w',
      { encoding: "utf8", timeout: 5000 }
    ).trim();
    const parsed = JSON.parse(raw);
    return parsed?.claudeAiOauth?.accessToken || null;
  } catch {
    return null;
  }
}

function fetchUsageFromAPI(token: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      "https://api.anthropic.com/api/oauth/usage",
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "anthropic-beta": "oauth-2025-04-20",
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => (body += chunk.toString()));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error("parse"));
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error("timeout"));
    });
  });
}

ipcMain.handle("usage:fetch", async () => {
  const token = getOAuthToken();
  if (!token) {
    return { error: "keychain" };
  }
  try {
    const data = await fetchUsageFromAPI(token);
    return { data };
  } catch (err: any) {
    console.error("[main] Usage fetch failed:", err?.message || err);
    return { error: err?.message === "parse" ? "parse" : "api" };
  }
});
```

- [ ] **Step 3: `preload.ts`에 fetchUsage bridge 추가**

`TerminalAPI` 인터페이스 선언 안 마지막에 추가:

```typescript
fetchUsage(): Promise<{ data?: any; error?: string }>;
```

`contextBridge.exposeInMainWorld` 객체 안 마지막에 추가 (`,` 뒤에):

```typescript
fetchUsage: (): Promise<{ data?: any; error?: string }> => {
  return ipcRenderer.invoke("usage:fetch");
},
```

- [ ] **Step 4: 빌드 확인**

Run: `cd /Users/davidhan/claude_workspace/terminal_app && npm run build`
Expected: 에러 없이 컴파일 성공

- [ ] **Step 5: Commit**

```bash
git add src/renderer/global.d.ts src/main/main.ts src/preload/preload.ts
git commit -m "feat: add usage:fetch IPC handler for Claude usage data"
```

---

### Task 2: 상태바 DOM + 스타일

**Files:**
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/styles.css`

- [ ] **Step 1: `index.html`에 상태바 DOM 추가**

`</div>` (id="app"의 닫는 태그) 바로 앞, `</main>` 다음 줄에 추가:

```html
    <div id="statusbar">
      <span id="usage-5h" class="usage-metric" title="">5h: --%</span>
      <span class="usage-sep">|</span>
      <span id="usage-7d" class="usage-metric" title="">7d: --%</span>
      <span class="usage-sep">|</span>
      <span id="usage-opus" class="usage-metric" title="">Opus: --%</span>
    </div>
```

즉, `#app` div의 구조는 `#titlebar` → `#main-area` → `#statusbar` 순서가 된다.

- [ ] **Step 2: `styles.css`에 상태바 스타일 추가**

파일 맨 끝 (`/* xterm.js overrides */` 섹션 앞)에 추가:

```css
/* === Status Bar === */
#statusbar {
  height: 24px;
  min-height: 24px;
  background: #252525;
  border-top: 1px solid #3a3a3a;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0;
  cursor: pointer;
  user-select: none;
  -webkit-app-region: no-drag;
}

.usage-metric {
  font-size: 11px;
  font-family: "SF Mono", "Menlo", monospace;
  color: #808080;
  padding: 0 8px;
  transition: color 0.2s;
}

.usage-sep {
  font-size: 11px;
  color: #3a3a3a;
}

.usage-warn {
  color: #ccaa00;
}

.usage-critical {
  color: #cc3333;
}

#statusbar:hover {
  background: #2a2a2a;
}

#statusbar:active {
  background: #1e1e1e;
}
```

- [ ] **Step 3: 빌드 확인**

Run: `cd /Users/davidhan/claude_workspace/terminal_app && npm run build`
Expected: 에러 없이 컴파일 성공

- [ ] **Step 4: Commit**

```bash
git add src/renderer/index.html src/renderer/styles.css
git commit -m "feat: add status bar DOM and styles for usage display"
```

---

### Task 3: 상태바 UI 로직

**Files:**
- Modify: `src/renderer/renderer.ts`

- [ ] **Step 1: renderer.ts에 상태바 로직 추가**

파일 하단, `// --- Init ---` 섹션 바로 앞에 다음 블록을 추가:

```typescript
// --- Usage Status Bar ---

const statusbar = document.getElementById("statusbar")!;
const usage5h = document.getElementById("usage-5h")!;
const usage7d = document.getElementById("usage-7d")!;
const usageOpus = document.getElementById("usage-opus")!;
let usageLoading = false;

function getUsageColorClass(utilization: number): string {
  if (utilization >= 95) return "usage-critical";
  if (utilization >= 80) return "usage-warn";
  return "";
}

function formatResetTime(resetsAt: string | null): string {
  if (!resetsAt) return "";
  const date = new Date(resetsAt);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  if (diffMs <= 0) return "reset imminent";
  const diffH = Math.floor(diffMs / 3600000);
  const diffM = Math.floor((diffMs % 3600000) / 60000);
  if (diffH > 0) return `resets in ${diffH}h ${diffM}m`;
  return `resets in ${diffM}m`;
}

function updateUsageMetric(
  el: HTMLElement,
  label: string,
  metric: { utilization: number; resets_at: string | null }
): void {
  const pct = Math.round(metric.utilization);
  el.textContent = `${label}: ${pct}%`;
  el.title = formatResetTime(metric.resets_at);
  el.className = "usage-metric " + getUsageColorClass(metric.utilization);
}

async function refreshUsage(): Promise<void> {
  if (usageLoading) return;
  usageLoading = true;

  try {
    const result = await window.terminalAPI.fetchUsage();

    if (result.error) {
      const msg =
        result.error === "keychain" ? "not logged in" : "--";
      usage5h.textContent = `Usage: ${msg}`;
      usage5h.className = "usage-metric";
      usage5h.title = "";
      usage7d.textContent = "";
      usage7d.className = "usage-metric";
      usage7d.title = "";
      usageOpus.textContent = "";
      usageOpus.className = "usage-metric";
      usageOpus.title = "";
      // Hide separators when showing error
      statusbar.querySelectorAll(".usage-sep").forEach((sep) => {
        (sep as HTMLElement).style.display = "none";
      });
      return;
    }

    if (result.data) {
      // Show separators
      statusbar.querySelectorAll(".usage-sep").forEach((sep) => {
        (sep as HTMLElement).style.display = "";
      });
      updateUsageMetric(usage5h, "5h", result.data.five_hour);
      updateUsageMetric(usage7d, "7d", result.data.seven_day);
      updateUsageMetric(usageOpus, "Opus", result.data.seven_day_opus);
    }
  } catch (err) {
    console.error("[renderer] Usage refresh failed:", err);
  } finally {
    usageLoading = false;
  }
}

statusbar.addEventListener("click", () => {
  refreshUsage();
});
```

- [ ] **Step 2: 앱 초기화에서 usage 로드 호출 추가**

`// --- Init ---` 섹션 안, IIFE `(async () => { ... })()` 블록의 `try` 안에서 기존 restore/create 로직이 끝난 뒤 (맨 마지막)에 추가:

```typescript
    // Load usage data
    refreshUsage();
```

즉 `try` 블록의 마지막 줄이 `refreshUsage();`가 된다.

- [ ] **Step 3: 빌드 확인**

Run: `cd /Users/davidhan/claude_workspace/terminal_app && npm run build`
Expected: 에러 없이 컴파일 성공

- [ ] **Step 4: 수동 테스트**

Run: `cd /Users/davidhan/claude_workspace/terminal_app && npm start`

확인 사항:
1. 앱 하단에 상태바가 표시되는가
2. Claude Code에 로그인된 상태라면 `5h: N% | 7d: N% | Opus: N%` 형태로 데이터가 나오는가
3. 상태바 클릭 시 데이터가 새로고침되는가
4. 사용률 80%+ 항목은 노란색, 95%+ 항목은 빨간색으로 표시되는가
5. 로그인 안 된 상태에서는 `Usage: not logged in`이 표시되는가

- [ ] **Step 5: Commit**

```bash
git add src/renderer/renderer.ts
git commit -m "feat: add usage status bar UI logic with color-coded alerts"
```
