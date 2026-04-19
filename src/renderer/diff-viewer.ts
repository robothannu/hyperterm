/// <reference path="./global.d.ts" />

// --- Diff Viewer ---
// Read-only diff modal using diff2html.
// Opens on file click from changed-files-panel.
// Close: ESC or close button.

// diff2html is loaded as UMD global in index.html
declare const Diff2Html: {
  html(diffInput: string, options?: Record<string, unknown>): string;
};

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function getDiffModal(): HTMLElement {
  return document.getElementById("diff-modal") as HTMLElement;
}

function getDiffTitle(): HTMLElement {
  return document.getElementById("diff-modal-title") as HTMLElement;
}

function getDiffContent(): HTMLElement {
  return document.getElementById("diff-modal-content") as HTMLElement;
}

// ---------------------------------------------------------------------------
// ESC key handler
// ---------------------------------------------------------------------------

function onDiffModalKeyDown(e: KeyboardEvent): void {
  if (e.key === "Escape") {
    closeDiffViewer();
  }
}

// ---------------------------------------------------------------------------
// Open / Close
// ---------------------------------------------------------------------------

function closeDiffViewer(): void {
  const modal = getDiffModal();
  modal.classList.add("hidden");
  document.removeEventListener("keydown", onDiffModalKeyDown);
}

async function openDiffViewer(
  projectRoot: string,
  filePath: string,
  fileX: string,
  fileY: string
): Promise<void> {
  const modal = getDiffModal();
  const titleEl = getDiffTitle();
  const contentEl = getDiffContent();

  // Show loading state
  titleEl.textContent = filePath;
  contentEl.innerHTML = '<div class="diff-loading">Loading diff...</div>';
  modal.classList.remove("hidden");

  // Register ESC handler
  document.addEventListener("keydown", onDiffModalKeyDown);

  // Determine staged flag: x !== ' ' && x !== '?' means staged change exists
  const isUntracked = fileX === "?" && fileY === "?";
  const hasStaged = fileX !== " " && fileX !== "?";
  // Prefer staged diff if available, otherwise unstaged
  const staged = !isUntracked && hasStaged;

  try {
    let diffString = "";

    if (isUntracked) {
      // Untracked: use --no-index /dev/null <file>
      const result = await window.terminalAPI.gitDiff(projectRoot, filePath, false);
      if ("tooLarge" in result) {
        contentEl.innerHTML = `<div class="diff-too-large">File too large to diff (${result.lineCount.toLocaleString()} lines)</div>`;
        return;
      }
      if ("error" in result) {
        contentEl.innerHTML = `<div class="diff-error">Error: ${diffEscapeHtml(result.error)}</div>`;
        return;
      }
      diffString = result.diff;
    } else {
      const result = await window.terminalAPI.gitDiff(projectRoot, filePath, staged);
      if ("tooLarge" in result) {
        contentEl.innerHTML = `<div class="diff-too-large">File too large to diff (${result.lineCount.toLocaleString()} lines)</div>`;
        return;
      }
      if ("error" in result) {
        contentEl.innerHTML = `<div class="diff-error">Error: ${diffEscapeHtml(result.error)}</div>`;
        return;
      }
      diffString = result.diff;
    }

    if (!diffString || diffString.trim() === "") {
      contentEl.innerHTML = '<div class="diff-empty">No diff available for this file.</div>';
      return;
    }

    const html = Diff2Html.html(diffString, {
      drawFileList: false,
      matching: "lines",
      outputFormat: "side-by-side",
    });
    contentEl.innerHTML = html;
  } catch (err) {
    contentEl.innerHTML = `<div class="diff-error">Failed to load diff: ${diffEscapeHtml(String(err))}</div>`;
  }
}

// ---------------------------------------------------------------------------
// Util
// ---------------------------------------------------------------------------

function diffEscapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function initDiffViewer(): void {
  const closeBtn = document.getElementById("diff-modal-close");
  if (closeBtn) {
    closeBtn.addEventListener("click", closeDiffViewer);
  }
  // Close on backdrop click (outside modal dialog)
  const modal = getDiffModal();
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      closeDiffViewer();
    }
  });
}
