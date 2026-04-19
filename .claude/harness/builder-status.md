## Builder Status — Sprint 3: Layout Presets & Toolbar Row

**Status**: DONE
**Build**: PASS (`npm run build` — tsc + copy-static, zero errors)
**Commit**: `81b2e1c` on `feature/hyperterm-redesign`

---

### Files Modified / Created

| File | Action | Summary |
|------|--------|---------|
| `src/renderer/toolbar-row.ts` | Created | New module: toolbar row UI + preset logic |
| `src/renderer/pane-types.d.ts` | Modified | Added `layoutPreset?: string` to `SavedTab` |
| `src/renderer/global.d.ts` | Modified | Added 4 cross-module function declarations |
| `src/renderer/renderer.ts` | Modified | `saveSessionMetadata` saves preset, `restoreFromSaved` restores it, `switchToTab` syncs toolbar |
| `src/renderer/styles.css` | Modified | Added `#toolbar-row`, `.layouts`, `.layout-btn`, `.layout-btn.active` styles |
| `src/renderer/index.html` | Modified | Added `<script src="toolbar-row.js">` (load order: after pane-tree, before notes-panel) |
| `src/renderer/init.ts` | Modified | Added `initToolbarRow()` call before `restoreFromSaved()` |

---

### Acceptance Criteria Verification

1. **[PASS]** Toolbar row (#toolbar-row) height 36px, flex row, right-aligned segmented control (.layouts) with 4 layout-btn elements. Active button gets rgba(124,140,255,0.15) bg + inset box-shadow. SVG icons per spec (single/split-V/3-pane/4-pane).

2. **[PASS]** `applyLayoutPreset()`: collects `getAllLeaves()`, creates new panes via `createPaneSession()` if needed, destroys excess manually (bypasses closeTab), clears container DOM, rebuilds tree via `buildPresetTree()` dispatching `setupDividerDrag()` on all new split nodes.

3. **[PASS]** After tree rebuild: `requestAnimationFrame(() => { resizeAllPanes(tab.root); setFocusedPane(tab.focusedPtyId); })` triggers xterm.js fit on all panes.

4. **[PASS]** `SavedTab.layoutPreset?: string` field in pane-types.d.ts. `saveSessionMetadata()` calls `getTabLayoutPreset(tabId)`. `restoreFromSaved()` calls `setTabLayoutPreset(tabId, savedTab.layoutPreset)`. `switchToTab()` calls `syncToolbarToTab(tabId)` to update button highlight.

5. **[PASS]** `splitFocusedPane()` and `setupDividerDrag()` untouched. Context menu split actions untouched.

6. **[PASS]** `#toolbar-row` is direct child of `#terminal-pane` with `flex-shrink: 0`, inserted before `.tab-container` elements. Sidebar show/hide does not affect terminal-pane layout.

---

### Implementation Notes

- **Excess pane teardown**: Bypasses `closePaneByPtyId` to avoid `closeTab` side effect when closing multiple panes. Direct manual teardown: `pane-destroy` event + `destroyPty` + `session.dispose` + map cleanup.
- **New pane creation**: `createPaneSession(tab.container)` appends directly to container (visible, xterm initializes). Step 4 detaches all leaf elements before clearing container.
- **Cross-module globals**: TypeScript treats all project .ts files as shared global scope. `sessions`, `sessionKeys`, `tabMap`, etc. accessible without re-declaration.
- **tabLayoutPresets Map**: Separate Map tracks preset per tabId. Orphaned on tab close but harmless.
