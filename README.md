# HyperTerm

A macOS terminal app built with Electron, xterm.js, and tmux.

Sessions are managed by tmux, so your work persists even after quitting the app and is automatically restored on relaunch.

## Features

- **Tab-based terminal management** — Create, switch, rename, and close terminals from the sidebar
- **Pane splitting** — Split horizontally/vertically with draggable dividers
- **Session persistence** — All sessions are automatically restored on app restart via tmux
- **Notes** — Per-terminal notes that persist across app restarts
- **Claude usage monitor** — Status bar showing Claude Code plan usage (5h/7d, auto-refreshes every 5 minutes)
- **Clipboard** — Text and image paste support (compatible with Claude Code image input)
- **macOS Terminal theme** — SF Mono 12pt, neutral grey tones

## System Requirements

| Item | Requirement |
|------|-------------|
| OS | macOS (arm64 / Apple Silicon) |
| Node.js | 18+ |
| npm | 9+ |
| tmux | Bundled (no separate installation needed) |

> Currently macOS arm64 only. Intel Mac, Windows, and Linux are not supported.

## Installation

### Pre-built App (Recommended)

Download the DMG from [Releases](https://github.com/robothannu/hyperterm/releases), or build it yourself:

```bash
git clone https://github.com/robothannu/hyperterm.git
cd hyperterm
npm install
npm run dist
```

Build output:
- `release/HyperTerm-0.1.0-arm64.dmg` — DMG installer
- `release/mac-arm64/HyperTerm.app` — App bundle

### Development Mode

```bash
git clone https://github.com/robothannu/hyperterm.git
cd hyperterm
npm install
npm start
```

## Usage

### Terminal Management

| Action | How |
|--------|-----|
| New terminal | Sidebar `+` button |
| Switch terminal | Click in sidebar |
| Rename | Double-click in sidebar |
| Close terminal | Sidebar `x` button (kills tmux session) |
| Quit app | `Cmd+Q` (tmux sessions stay alive, restored on relaunch) |

### Pane Splitting

Right-click in the terminal area and choose horizontal or vertical split from the context menu. Drag the divider to adjust the ratio.

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+C` | Copy selected text (sends SIGINT if no selection) |
| `Cmd+V` | Paste text |
| `Ctrl+V` | Paste image (Claude Code compatible) |
| `Cmd+A` | Select all |

### Claude Usage Status Bar

The bottom status bar displays your Claude Code plan usage.

- **Format:** `5h: N% | 7d: N%`
- **Auto-refresh:** Every 5 minutes
- **Manual refresh:** Click the status bar
- **Color coding:** Yellow at 80%+, red at 95%+
- **Requires:** Active Claude Code login (OAuth token stored in macOS Keychain)

### Notes

Click the pencil icon in the sidebar to open notes for that terminal. Press `Cmd+Enter` to quickly add a note.

## Tech Stack

- **Electron** 34 — App framework
- **xterm.js** 6 — Terminal emulator (WebGL rendering)
- **node-pty** — PTY process management
- **tmux** — Session management (vendored binary)
- **TypeScript** 5

## Code Signing

Currently using ad-hoc signing. An Apple Developer certificate is required for distribution.

## License

MIT
