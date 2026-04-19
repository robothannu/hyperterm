# Evaluator Report
## Sprint: 3 — Layout Presets & Toolbar Row
## Iteration: 1
## Overall Score: 27/30
## Hard Threshold Violations: none
## Verdict: PASS

## Builder Claim vs Evaluator Finding

| Builder Claims | Evaluator Verified | Match? |
|---|---|---|
| toolbar-row.ts 신규 생성 (initToolbarRow, SVG icons, 4 buttons) | src/renderer/toolbar-row.ts 409L, LAYOUT_PRESETS x4 with SVG paths, layout-btn DOM built | Yes |
| applyLayoutPreset: getAllLeaves → create/destroy → buildPresetTree → resize | Confirmed flow L315–L409; RAF-gated resizeAllPanes + setFocusedPane | Yes |
| Excess pane teardown bypasses closePaneByPtyId (manual destroy) | L351–L363: pane-destroy event + destroyPty + session.dispose + sessions/sessionKeys/ptyToTab delete + cleanupPaneAgentMarker + cleanupPaneHookMarker + element.remove | Yes |
| SavedTab.layoutPreset?: string | pane-types.d.ts L51 | Yes |
| saveSessionMetadata writes layoutPreset | renderer.ts L760 getTabLayoutPreset(tabId) | Yes |
| restoreFromSaved calls setTabLayoutPreset | renderer.ts L869–L871 | Yes |
| switchToTab calls syncToolbarToTab | renderer.ts L494 | Yes |
| toolbar-row is direct child of #terminal-pane, flex-shrink:0 | toolbar-row.ts L77–L83 inserts before .tab-container; styles.css L2297 | Yes |
| initToolbarRow called from init.ts | init.ts L15 before restoreFromSaved | Yes |
| npm run build: zero errors | `tsc && cp` executed clean, dist/renderer/toolbar-row.js emitted | Yes |

## Acceptance Criteria Results

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | 4 preset buttons, segmented, active highlight | PASS | .layouts container with 4 .layout-btn; .layout-btn.active uses indigo rgba(124,140,255,0.15) + inset ring (styles.css L2341) |
| 2 | Click applies preset (reuse/create/destroy panes) | PASS | applyLayoutPreset flow covers create (needed>current), destroy (current>needed), re-parent |
| 3 | xterm resize after layout change | PASS | requestAnimationFrame → resizeAllPanes(tab.root) (L400–L405). Pane-leaf element (with xterm host inside) is moved intact; resize re-fits. |
| 4 | layoutPreset persisted & restored | PASS | saveSessionMetadata:760 writes; restoreFromSaved:869 reads + setTabLayoutPreset; switchToTab syncs toolbar highlight |
| 5 | manual split still works after preset | PASS | buildSplitTree/buildTripleTree/buildQuadTree attach PaneSplit nodes with divider + setupDividerDrag; subsequent Cmd+D or right-click paths operate on the new root |
| 6 | Toolbar accessible regardless of sidebar hide/resize | PASS | #toolbar-row lives in #terminal-pane (flex:1), unaffected by #sidebar width changes; height:36px flex-shrink:0 always visible |

## Adversarial Testing

| # | Test | Result | Detail |
|---|---|---|---|
| 1 | npm run build reproducible | PASS | `tsc && cp` emitted no errors; commit 81b2e1c present |
| 2 | Excess pane teardown completeness vs closePaneByPtyId | PASS | Parity check: destroyPty, session.dispose, sessions/sessionKeys/ptyToTab delete, cleanupPaneAgentMarker/HookMarker, pane-destroy event all invoked. Bypasses closeTab to avoid sidebar eviction. |
| 3 | DOM re-parent xterm survival | LIKELY PASS | xterm host div is inside pane-leaf; removing pane-leaf and re-appending under new split preserves DOM subtree. Follow-up resizeAllPanes re-fits. Risk: webgl addon may lose context on detach, but same pattern is already used in closePaneByPtyId via element.replaceWith. |
| 4 | createPaneSession(tab.container) placement | PASS | New leaves are appended directly to tab.container as transient placement; step 4 unconditionally detaches all leaves before buildPresetTree re-assembles. No orphan unless step 2 throws mid-loop (minor). |
| 5 | Restore flow with layoutPreset="triple" | PASS | SavedPaneNode tree drives actual DOM shape via restorePaneTree; layoutPreset is metadata only via setTabLayoutPreset; switchToTab triggers syncToolbarToTab for highlight. Correct separation. |
| 6 | Script load order | PASS | index.html: renderer.js (271) → pane-tree.js (272) → toolbar-row.js (273) → init.js (287). All globals defined before init IIFE. |
| 7 | saveSessionMetadata actually calls getTabLayoutPreset | PASS | renderer.ts L760 calls guarded by typeof === "function" |
| 8 | tabLayoutPresets cleanup on closeTab | FAIL (leak) | closeTab (L665–L721) never deletes from tabLayoutPresets Map. No exported helper like clearTabLayoutPreset(tabId). Minor memory leak. |
| 9 | Single-pane case attach path | PASS | buildSingleTree sets flex:"1 1 0px" and appends directly to tab.container; tab.root becomes the leaf itself |
| 10 | Partial failure during pane creation loop | WEAK | If createPaneSession throws on 3rd iteration when going 1→4, the first 2 already-created panes remain in tab.container but applyLayoutPreset returns early. tab.root is still old. Toast shown. User must manually close orphans. Not a regression, but not graceful. |
| 11 | preset click while tab has unsaved state | PASS | saveSessionMetadata is debounced (200ms); step 11 calls it unconditionally |

## Findings

| # | Finding | Dimension | Severity | Score Impact |
|---|---|---|---|---|
| 1 | tabLayoutPresets Map is never cleaned on closeTab → small unbounded growth across tab churn | Edge Cases | Low | -1 |
| 2 | Partial failure in step 2 (2nd+ new pane create fails) leaves orphan panes in tab.container with ptyToTab entries | Edge Cases | Low | -1 |
| 3 | No visible toast or sidebar feedback when layout preset is applied; relies only on button highlight | UX | Trivial | -1 |
| 4 | When needed > current, new leaves are appended to tab.container alongside the existing split wrapper — briefly the DOM has both old split and new leaves as siblings until step 4 reshuffles. Harmless but could flicker. | Performance | Trivial | 0 |

## Scores

| Dimension | Base | Deductions | Final | Key Finding |
|---|---|---|---|---|
| Functionality | 5 | 0 | 5 | All 6 acceptance criteria verified through code paths; build clean |
| User Experience | 5 | -1 | 4 | No status feedback beyond button highlight; Finding 3 |
| Visual Quality | 5 | 0 | 5 | Segmented control, indigo active state, SVG icons match Linear/Raycast feel |
| Edge Cases | 5 | -2 | 3 | tabLayoutPresets leak + partial-failure orphans (Findings 1, 2) |
| Performance | 5 | 0 | 5 | RAF-gated resize, debounced save, direct DOM re-parent |
| Regression | 5 | 0 | 5 | Manual splits, divider drag, close paths all still wired through setupDividerDrag and closePaneByPtyId |

Total: 5+4+5+3+5+5 = 27/30

## Revision Items

1. Expose `clearTabLayoutPreset(tabId)` from toolbar-row.ts and call it from closeTab alongside tabLabels.delete.
2. In applyLayoutPreset step 2 catch block, tear down any successfully-created new leaves before returning to prevent orphans.
3. Optional: showToast("Layout: {name}") after successful apply for UX feedback.

## What Worked Well

- Separation of concerns: DOM/tree construction in toolbar-row.ts, persistence in renderer.ts.
- Manual teardown path correctly mirrors closePaneByPtyId's cleanup while avoiding closeTab side-effects — exactly the right call.
- Restore flow is clean: real tree comes from SavedPaneNode; layoutPreset is pure metadata for toolbar highlight.
- Script load order documented inline and matches the dependency graph.
- #toolbar-row placement inside #terminal-pane keeps it decoupled from sidebar width/resize — criterion 6 is structurally guaranteed, not just visually verified.
