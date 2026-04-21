# HyperTerm

An Electron terminal app for macOS, designed for multi-session work alongside Claude Code.

Built on xterm.js with per-pane PTY processes. Group names, clusters, and layouts are persisted and restored on relaunch.

---

## Features

### Terminal group management
- **Sidebar** — list of terminal groups; click to switch
- **Rename group** — double-click to edit inline
- **Group clusters** — set a project-level cluster name with `Cmd+Shift+G`
- **Metadata persistence** — group names, clusters, and layouts are saved to `sessions.json` and restored on relaunch

> Note: PTY processes themselves are not preserved across app restarts. Only group metadata (name, cluster, layout) is restored; terminals start fresh.

### Multi-pane splits
- Horizontal / vertical splits (right-click context menu)
- Drag dividers to resize
- Layout presets in the toolbar (single / 2-split / 3-split)

### Claude Code integration
- **Running / Waiting badges** — `⚙ Running` while Claude is working, `⚠ Waiting` when permission is required
- **Completion badge** — `✓ Done` shown for 5 seconds after a task finishes
- **Multi-tab monitoring** — background tabs are polled so their Claude state stays live
- **Jump to waiting** — `Cmd+Shift+A` jumps to any tab awaiting approval
- **Claude Usage** — status bar shows Claude Code plan usage (5h / 7d windows, refreshed every 5 minutes)

### Sidebar sub-rows
Each group entry shows a per-pane status row:
- **Git branch** — current working branch
- **Status indicator** — idle (gray) / running (green) / waiting (pulsing orange) / done (green flash)
- **Changed file count** — `●N` for uncommitted changes

### Theme
- **Dark theme** (default) — SF Mono, `#0e1014` background
- **Light theme** — full CSS-variable override for consistent colors
- Toggle from settings

### Changed Files panel
- `Cmd+Shift+E` — side panel listing the current tab's git changes
- Inline diff view (diff2html)

---

## System requirements

| Item | Requirement |
|------|-------------|
| OS | macOS (Apple Silicon, arm64) |
| Node.js | 18+ |
| npm | 9+ |

> Intel Mac, Windows, and Linux are not supported.

---

## Installation

### Use the pre-built app (recommended)

1. Download the latest `HyperTerm-x.x.x-arm64.dmg` from [Releases](https://github.com/robothannu/hyperterm/releases).
2. Open the DMG and drag `HyperTerm.app` to `/Applications`.
3. **First launch requires a Gatekeeper workaround** (the app is not signed with an Apple Developer ID).

#### First launch — Gatekeeper workaround

**Option 1: Right-click in Finder (recommended)**

1. In `/Applications`, **right-click `HyperTerm.app` → Open**
2. Click **Open** in the warning dialog
3. Subsequent launches work like any normal app

**Option 2: When you see `"HyperTerm is damaged and can't be opened"`**

Common on macOS Sequoia and later due to the quarantine flag. Run in Terminal:

```bash
xattr -cr /Applications/HyperTerm.app
open /Applications/HyperTerm.app
```

> **Why is this necessary?**
> HyperTerm is not signed with an Apple Developer ID ($99/year), so macOS Gatekeeper blocks it by default. It is not malicious — the full source is in this repository, and you can verify download integrity using the SHA-256 checksums published on each Release.

### Build from source

```bash
git clone https://github.com/robothannu/hyperterm.git
cd hyperterm
npm install
npm run dist
```

Build outputs:
- `release/HyperTerm-<version>-arm64.dmg` — installer
- `release/mac-arm64/HyperTerm.app` — app bundle

### Development mode

```bash
git clone https://github.com/robothannu/hyperterm.git
cd hyperterm
npm install
npm start
```

---

## Usage

### Terminal groups

| Action | How |
|--------|-----|
| New group | Sidebar `+` button or `Cmd+N` |
| Switch group | Click in sidebar, or `Cmd+1`–`Cmd+9` |
| Previous / next group | `Cmd+Shift+[` / `Cmd+Shift+]` |
| Rename | Double-click in sidebar |
| Close group | Sidebar `×` button |
| Quit app | `Cmd+Q` (group metadata is restored on next launch; PTYs restart fresh) |

### Pane splits

| Action | How |
|--------|-----|
| Horizontal / vertical split | Right-click terminal area → choose split |
| Focus adjacent pane | `Cmd+Arrow` |
| Layout preset | Toolbar buttons (single / side-by-side / stacked / 3-split) |

### Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+N` | New terminal group |
| `Cmd+1`–`Cmd+9` | Switch to the Nth tab |
| `Cmd+Shift+]` / `[` | Next / previous tab |
| `Cmd+Arrow` | Move focus between panes |
| `Cmd+Shift+G` | Set cluster (project) name |
| `Cmd+Shift+A` | Jump to a Claude tab that is waiting for approval |
| `Cmd+Shift+E` | Toggle Changed Files panel |
| `Cmd++` / `Cmd+-` | Increase / decrease font size |
| `Cmd+0` | Reset font size (12pt) |
| `Cmd+C` | Copy selection (sends SIGINT when no selection) |
| `Cmd+V` | Paste text |
| `Ctrl+V` | Paste image (compatible with Claude Code image input) |

### Claude Code integration

On first launch, HyperTerm installs hooks into `~/.config/hyperterm/hook.sh` and `~/.claude/settings.json`.

| State | Badge | Meaning |
|-------|-------|---------|
| Running | `⚙ Running` (blue) | Claude is generating a response or using a tool |
| Waiting | `⚠ Waiting` (pulsing orange) | Permission required |
| Done | `✓ Done` (green, 5s) | Task finished |

- Per-tab state is tracked independently, so you can run Claude in several tabs at once.
- Use `Cmd+Shift+A` to jump to any tab that needs approval.

### Claude Usage status bar

The bottom status bar shows Claude Code plan usage:
- **Format:** `5h: N% | 7d: N%`
- **Refresh:** every 5 minutes
- **Color:** yellow at 80%+, red at 95%+
- **Requires:** signed-in Claude Code OAuth session

---

## Tech stack

| Component | Version | Role |
|-----------|---------|------|
| Electron | 34 | App framework |
| xterm.js | 6 | Terminal emulator (WebGL rendering) |
| node-pty | — | PTY process management |
| TypeScript | 5 | Renderer + main process |

---

## License

MIT
