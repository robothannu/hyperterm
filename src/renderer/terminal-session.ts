declare const FitAddon: { FitAddon: new () => any };
declare const WebglAddon: { WebglAddon: new () => any };
declare const SerializeAddon: { SerializeAddon: new () => any };

class TerminalSession {
  public readonly terminal: any;
  public readonly container: HTMLElement;
  private fitAddon: any;
  private serializeAddon: any;

  constructor(container: HTMLElement) {
    this.container = container;

    if (!(window as any).Terminal) {
      throw new Error("xterm.js failed to load. Check script tags in index.html.");
    }

    this.terminal = new (window as any).Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily:
        "'SF Mono', Menlo, Monaco, 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', monospace",
      scrollback: 0,
      theme: {
        background: "#1c1c1c",
        foreground: "#d0d0d0",
        cursor: "#d0d0d0",
        cursorAccent: "#1c1c1c",
        selectionBackground: "#414453",
        selectionForeground: "#ffffff",
        black: "#000000",
        red: "#990000",
        green: "#00a600",
        yellow: "#999900",
        blue: "#0000b2",
        magenta: "#b200b2",
        cyan: "#00a6b2",
        white: "#bfbfbf",
        brightBlack: "#666666",
        brightRed: "#e50000",
        brightGreen: "#00d900",
        brightYellow: "#e5e500",
        brightBlue: "#0000ff",
        brightMagenta: "#e500e5",
        brightCyan: "#00e5e5",
        brightWhite: "#e5e5e5",
      },
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
    this.container.addEventListener("mouseup", () => {
      const selection = this.terminal.getSelection();
      if (selection) {
        window.terminalAPI.copyToClipboard(selection);
      }
    });

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
    let startX = 0;
    let startY = 0;
    this.container.addEventListener("mousedown", (e: MouseEvent) => {
      if (e.button !== 0) return;
      startX = e.clientX;
      startY = e.clientY;
    });
    this.container.addEventListener("mouseup", (e: MouseEvent) => {
      if (e.button !== 0) return;
      const dx = Math.abs(e.clientX - startX);
      const dy = Math.abs(e.clientY - startY);
      if (dx < 5 && dy < 5) {
        const xtermEl = this.container.querySelector(".xterm-screen");
        if (!xtermEl) return;
        const rect = xtermEl.getBoundingClientRect();
        const cellWidth = rect.width / this.terminal.cols;
        const cellHeight = rect.height / this.terminal.rows;
        const col = Math.floor((e.clientX - rect.left) / cellWidth);
        const row = Math.floor((e.clientY - rect.top) / cellHeight);
        callback(col, row);
      }
    });
  }

  dispose(): void {
    this.terminal.dispose();
  }
}
