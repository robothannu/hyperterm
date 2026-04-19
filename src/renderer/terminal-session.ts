// UMD globals loaded via <script> tags in index.html
// xterm.js spreads exports onto globalThis: Terminal is a direct constructor,
// addons are namespaces (e.g. window.FitAddon = { FitAddon: class ... })
declare const Terminal: typeof import("@xterm/xterm").Terminal;
declare const FitAddon: { FitAddon: typeof import("@xterm/addon-fit").FitAddon };
declare const SerializeAddon: { SerializeAddon: typeof import("@xterm/addon-serialize").SerializeAddon };
declare const WebglAddon: { WebglAddon: typeof import("@xterm/addon-webgl").WebglAddon };

type TerminalInstance = InstanceType<typeof Terminal>;
type FitAddonInstance = InstanceType<typeof FitAddon.FitAddon>;
type SerializeAddonInstance = InstanceType<typeof SerializeAddon.SerializeAddon>;

const XTERM_THEME_DARK = {
  background: "#0e1014", foreground: "#d0d0d0", cursor: "#d0d0d0", cursorAccent: "#0e1014",
  selectionBackground: "#414453", selectionForeground: "#ffffff",
  black: "#000000", red: "#990000", green: "#00a600", yellow: "#999900",
  blue: "#0000b2", magenta: "#b200b2", cyan: "#00a6b2", white: "#bfbfbf",
  brightBlack: "#666666", brightRed: "#e50000", brightGreen: "#00d900",
  brightYellow: "#e5e500", brightBlue: "#0000ff", brightMagenta: "#e500e5",
  brightCyan: "#00e5e5", brightWhite: "#e5e5e5",
};

const XTERM_THEME_LIGHT = {
  background: "#f8f8f8", foreground: "#1a1a1a", cursor: "#333333", cursorAccent: "#f8f8f8",
  selectionBackground: "#b3d4ff", selectionForeground: "#000000",
  black: "#000000", red: "#cc0000", green: "#006600", yellow: "#999900",
  blue: "#0000cc", magenta: "#cc00cc", cyan: "#007a7a", white: "#888888",
  brightBlack: "#555555", brightRed: "#ff3333", brightGreen: "#00aa00",
  brightYellow: "#cccc00", brightBlue: "#3333ff", brightMagenta: "#ff33ff",
  brightCyan: "#00cccc", brightWhite: "#333333",
};

class TerminalSession {
  public readonly terminal: TerminalInstance;
  public readonly container: HTMLElement;
  private fitAddon: FitAddonInstance;
  private serializeAddon: SerializeAddonInstance;
  private fontSize: number = 12;
  private autoCopyListener: () => void;
  private paneClickListeners: { mousedown: (e: MouseEvent) => void; mouseup: (e: MouseEvent) => void } | null = null;

  constructor(container: HTMLElement) {
    this.container = container;

    this.terminal = new Terminal({
      cursorBlink: true,
      fontSize: this.fontSize,
      fontFamily:
        "'SF Mono', Menlo, Monaco, 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', monospace",
      scrollback: 10000,
      theme: XTERM_THEME_DARK,
      allowProposedApi: true,
      rightClickSelectsWord: false,
    });

    // Handle Cmd+C (copy) and Cmd+V (paste)
    this.terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.type !== "keydown") return true;
      const isMeta = e.metaKey || e.ctrlKey;

      // Cmd+C: copy selection if text is selected, otherwise let terminal handle (SIGINT)
      if (isMeta && e.key === "c") {
        const selection = this.terminal.getSelection();
        if (selection) {
          window.terminalAPI.copyToClipboard(selection);
          this.terminal.clearSelection();
          return false; // prevent sending to terminal
        }
        return true; // no selection → send SIGINT
      }

      // Cmd+V: paste from clipboard
      if (isMeta && e.key === "v") {
        const text = window.terminalAPI.readFromClipboard();
        if (text) {
          e.preventDefault();
          this.terminal.paste(text);
          return false;
        }
        // No text in clipboard (image etc.) — pass through to PTY
        // so apps like Claude Code can handle image paste
        return true;
      }

      // Cmd+A: select all
      if (isMeta && e.key === "a") {
        this.terminal.selectAll();
        return false;
      }

      return true;
    });

    // Auto-copy: 드래그 후 마우스를 놓으면 선택된 텍스트를 클립보드에 자동 복사
    this.autoCopyListener = () => {
      const selection = this.terminal.getSelection();
      if (selection) {
        window.terminalAPI.copyToClipboard(selection);
      }
    };
    this.container.addEventListener("mouseup", this.autoCopyListener);

    this.fitAddon = new FitAddon.FitAddon();
    this.terminal.loadAddon(this.fitAddon);

    this.serializeAddon = new SerializeAddon.SerializeAddon();
    this.terminal.loadAddon(this.serializeAddon);
  }

  open(): void {
    this.terminal.open(this.container);
    try {
      const webgl = new WebglAddon.WebglAddon();
      this.terminal.loadAddon(webgl);
    } catch {
      // WebGL not available; canvas renderer is used automatically
    }

    this.fit();
  }

  fit(): void {
    this.fitAddon.fit();
  }

  getCols(): number {
    return this.terminal.cols;
  }

  getRows(): number {
    return this.terminal.rows;
  }

  focus(): void {
    this.terminal.focus();
  }

  getFontSize(): number {
    return this.fontSize;
  }

  setFontSize(size: number): void {
    this.fontSize = Math.max(8, Math.min(24, size));
    this.terminal.options.fontSize = this.fontSize;
    this.fit();
  }

  setTheme(theme: "dark" | "light"): void {
    this.terminal.options.theme = theme === "light" ? XTERM_THEME_LIGHT : XTERM_THEME_DARK;
  }

  increaseFontSize(): void {
    this.setFontSize(this.fontSize + 1);
  }

  decreaseFontSize(): void {
    this.setFontSize(this.fontSize - 1);
  }

  write(data: string): void {
    this.terminal.write(data);
  }

  onData(callback: (data: string) => void): void {
    this.terminal.onData(callback);
  }

  onResize(callback: (size: { cols: number; rows: number }) => void): void {
    this.terminal.onResize(callback);
  }

  serialize(): string {
    return this.serializeAddon.serialize();
  }

  onPaneClick(callback: (col: number, row: number) => void): void {
    // Remove existing listeners before adding new ones to prevent accumulation
    if (this.paneClickListeners) {
      this.container.removeEventListener("mousedown", this.paneClickListeners.mousedown);
      this.container.removeEventListener("mouseup", this.paneClickListeners.mouseup);
    }
    let startX = 0;
    let startY = 0;
    const mousedown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      startX = e.clientX;
      startY = e.clientY;
    };
    const mouseup = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const dx = Math.abs(e.clientX - startX);
      const dy = Math.abs(e.clientY - startY);
      if (dx < 5 && dy < 5) {
        const xtermEl = this.container.querySelector(".xterm-screen");
        if (!xtermEl) return;
        const rect = xtermEl.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        const cellWidth = rect.width / this.terminal.cols;
        const cellHeight = rect.height / this.terminal.rows;
        const col = Math.floor((e.clientX - rect.left) / cellWidth);
        const row = Math.floor((e.clientY - rect.top) / cellHeight);
        callback(col, row);
      }
    };
    this.container.addEventListener("mousedown", mousedown);
    this.container.addEventListener("mouseup", mouseup);
    this.paneClickListeners = { mousedown, mouseup };
  }

  dispose(): void {
    this.container.removeEventListener("mouseup", this.autoCopyListener);
    if (this.paneClickListeners) {
      this.container.removeEventListener("mousedown", this.paneClickListeners.mousedown);
      this.container.removeEventListener("mouseup", this.paneClickListeners.mouseup);
    }
    this.terminal.dispose();
  }
}
