# Evaluator Report
## Sprint: 3 — Polling Efficiency & UX Polish
## Iteration: 1
## Overall Score: 27/30
## Hard Threshold Violations: none
## Verdict: PASS

## Builder Claim vs Evaluator Finding

| Builder Claims | Evaluator Verified | Match? |
|---|---|---|
| `pollAllGitStatus` 제거 → `pollActiveGitStatus()` (activeTabId only) | git-status.ts:137-141, grep shows no remaining `pollAllGitStatus` reference | YES |
| `pollGitOnTabSwitch` added + called in switchToTab | git-status.ts:159-162, renderer.ts:352 | YES |
| agent-status burst log added | agent-status.ts:157 `console.log('[agent-status] polling N pane(s)...')` | YES |
| agent-status already activeTabId-only | agent-status.ts:149-153 guards non-active | YES |
| `tryCloseNotesPanel` wired to close/ESC/overlay | notes-panel.ts:147 (close), :155 (ESC), :162 (overlay) | YES |
| Empty textarea fast-path | notes-panel.ts:41-54 `if unsaved !== ""` gate | YES |
| `path:checkExists` IPC added in main/preload/global.d.ts | main.ts:607, preload.ts:89/214, global.d.ts:107 | YES |
| `validateMruProjects` at startup | sidebar-mru.ts:187-201 called from initSidebarMru:211 | YES |
| Click-time path check + toast | sidebar-mru.ts:104-124, showToast on miss | YES |
| `activeSessionSettings` global + createPaneSession uses it | renderer.ts:19-22, :190-191 | YES |
| Build 0 errors | `npm run build` → 0 errors, 0 warnings | YES |

## Acceptance Criteria Results

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | Active-only git polling + on-demand refresh on tab switch | PASS | `pollActiveGitStatus` returns early if `activeTabId === null`; setInterval only polls `activeTabId`; `switchToTab` calls `pollGitOnTabSwitch` synchronously (renderer.ts:352) — guarantees badge refresh within one cycle (immediate on-demand). |
| 2 | Agent polling: single burst for N panes of active tab | PASS | `pollAgentStatus` guards `activeTabId === null` (line 149), uses single `Promise.all` burst (line 161-165); log at line 157 confirms "polling N pane(s) for active tab X". No IPC for non-active tabs. |
| 3 | Notes panel close with unsaved text shows confirm; empty → no prompt | PASS | `tryCloseNotesPanel` checks `notesInput.value.trim() !== ""` (line 42); three wire-ups verified: close button (:147), ESC (:155), overlay click (:162). Cancel → return (keep text & panel), confirm → clear + close. |
| 4 | Stale MRU paths removed on load; click shows error toast | PASS | `validateMruProjects` called in `initSidebarMru` (:211), parallel per-path `.catch(() => false)`; click-time check in `onMruEntryClick` calls `showToast(..., "error")` and `removeMruProject` on miss. |
| 5 | Settings change applies to newly created tabs | PASS | `activeSessionSettings` updated by `applyFontSizeToAll`/`applyTheme` (settings-modal.ts:80,92); `createPaneSession` applies fontSize/theme immediately after `session.open()` (renderer.ts:190-191). |
| 6 | No regression in git badge, agent marker, notes, settings modal | PASS | `pollGitForTab` logic unchanged → badge format intact; existing `setPaneAgentStatus` and `updateSidebarAgentMarker` untouched; `closeNotesPanel` still used by `closeTab` (forced close, intentional); settings modal keybind/overlay intact. |

## Adversarial Testing

| Test | Result | Detail |
|---|---|---|
| activeTabId null at poll fire | PASS | `pollActiveGitStatus` line 138 returns early; `pollAgentStatus` line 149 returns early — no crash. |
| Rapid tab switching vs in-flight poll | PASS (acceptable) | Multiple in-flight `pollGitForTab(tabId)` calls per-tabId race is benign: each writes its own tab's cache; the winner is last-write, but both target same tab. No cross-tab contamination. Minor: could display brief stale branch on same tab, but resolves within 5s. |
| `checkPathExists` IPC rejects for all paths | MINOR CONCERN | `validateMruProjects` uses `.catch(() => false)` per-path — if IPC is globally broken, ALL MRU entries would be wiped silently on startup. Not a crash, but potential data loss. Unlikely (fs.existsSync is safe). -1 edge_cases. |
| Race: typing then quickly clicking close + confirm | PASS | `window.confirm` is synchronous & modal in Electron; no race window. Textarea value read at function entry. |
| All MRU entries invalid | PASS | `renderMruSection` handles `mruProjects.length === 0` with "최근 프로젝트 없음" placeholder; no crash. |
| pollGitForTab still works for active tab | PASS | Called by both `pollActiveGitStatus` (timer) and `pollGitOnTabSwitch` (on-demand). Function body unchanged. |
| startGitPolling / startAgentPolling still invoked | PASS | `init.ts:21-23` calls both at startup. Polling lifecycle intact. |
| Init order: settings modal initializes AFTER first tab | PASS (by design) | `initSettingsModal` runs after `createNewTab` in init.ts, but `applyFontSizeToAll`/`applyTheme` iterate `sessions.values()` — existing sessions get updated retroactively. New tabs created post-init use `activeSessionSettings`. |

## Findings

| # | Finding | Dimension | Severity | Score Impact |
|---|---|---|---|---|
| 1 | If `path:checkExists` IPC were to fail globally on startup, `validateMruProjects` silently wipes ALL recent projects (each `.catch(() => false)` marks path as stale). Not a crash but potential data loss. | Edge Cases | Low | -1 |
| 2 | `pollActiveGitStatus` runs initial poll synchronously in `startGitPolling` (line 167) — if `activeTabId` is still null at init time (race with `createNewTab`), first poll no-ops. Minor but works fine on next 5s tick or on tab switch. | Performance | Low | 0 (acceptable) |
| 3 | First tab created during init doesn't benefit from `activeSessionSettings` user overrides because `initSettingsModal` runs after. Mitigated by settings modal applying to existing `sessions.values()` on load. | Regression | Low | 0 |
| 4 | `closeTab` uses raw `closeNotesPanel` bypassing unsaved-text prompt. Intentional per builder, but may surprise users who type notes then delete tab. | User Experience | Low | -0.5 (not deducted; documented trade-off) |

## Scores

| Dimension | Base | Deductions | Final | Key Finding |
|---|---|---|---|---|
| Functionality | 5 | 0 | 5 | All 6 AC verified through code analysis |
| User Experience | 5 | 0 | 5 | Confirm dialog clear; transparent polling |
| Visual Quality | 5 | 0 | 5 | No layout changes; badge/marker intact |
| Edge Cases | 5 | -1 | 4 | Silent MRU wipe on global IPC failure |
| Performance | 5 | 0 | 5 | IPC reduced from N tabs × poll to 1 active tab + on-demand. Confirmed single-burst agent poll. |
| Regression | 5 | -1 | 4 | Intentional bypass of confirm in closeTab; first-tab settings race mitigated but present. |
| **TOTAL** | | | **27/30** | Pass threshold 24+, no 1/5 |

## Revision Items

None required for PASS. Optional hardening:
- In `validateMruProjects`, track whether IPC succeeded at all; if zero successes across all paths AND there are paths, skip the wipe and log a warning instead of silently removing all MRU entries.
- Optionally wire `tryCloseNotesPanel` into `closeTab` path when a tab with unsaved notes is being closed (or suppress panel entirely for that tab).

## What Worked Well

- Clean extraction of `pollGitOnTabSwitch` as a reusable public function; sensible separation from the timer-driven `pollActiveGitStatus`.
- `FAIL_SENTINEL` pattern in agent-status (pre-existing) + explicit log makes burst behavior observable.
- `activeSessionSettings` as a typed global with `declare var` integration works cleanly across modules; `applyFontSizeToAll` / `applyTheme` side-channel both updates live sessions AND mutates the default.
- Parallel `Promise.all` MRU validation is efficient and non-blocking.
- IPC surface addition (`path:checkExists`) is minimal, side-effect-free, and uses safe `fs.existsSync`.
- `npm run build` clean (0 errors, 0 warnings).
