/// <reference path="./global.d.ts" />
/// <reference path="./pane-types.d.ts" />

// --- Changed Files Panel ---
// Slide-in panel (right side) showing git-changed files for the active tab.
// Toggle: Cmd+Shift+E
// Refresh: on tab switch + 5s polling (piggybacks git-status.ts poll interval)

let changedFilesPanelOpen = false;
let changedFilesRefreshTimer: ReturnType<typeof setInterval> | null = null;
const CHANGED_FILES_POLL_MS = 5000;

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function getPanel(): HTMLElement {
  return document.getElementById("changed-files-panel") as HTMLElement;
}

function getList(): HTMLElement {
  return document.getElementById("changed-files-list") as HTMLElement;
}

// ---------------------------------------------------------------------------
// Status → display
// ---------------------------------------------------------------------------

interface FileStatus {
  label: string;
  color: string;
  title: string;
}

function classifyFile(x: string, y: string): FileStatus {
  // Untracked
  if (x === "?" && y === "?") {
    return { label: "?", color: "#808080", title: "Untracked" };
  }
  // Deleted (staged or unstaged)
  if (x === "D" || y === "D") {
    return { label: "D", color: "#e55555", title: "Deleted" };
  }
  // Added / staged new file
  if (x === "A") {
    return { label: "A", color: "#4caf50", title: "Added (staged)" };
  }
  // Renamed
  if (x === "R" || y === "R") {
    return { label: "R", color: "#4caf50", title: "Renamed" };
  }
  // Modified (staged or unstaged)
  if (x === "M" || y === "M") {
    return { label: "M", color: "#ff9500", title: "Modified" };
  }
  // Fallback
  const ch = x !== " " && x !== "?" ? x : y;
  return { label: ch, color: "#b3b3b3", title: "Changed" };
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function renderChangedFiles(
  files: { path: string; x: string; y: string }[]
): void {
  const list = getList();
  list.innerHTML = "";

  if (files.length === 0) {
    const empty = document.createElement("div");
    empty.className = "changed-files-empty";
    empty.textContent = "No changes";
    list.appendChild(empty);
    return;
  }

  for (const f of files) {
    const status = classifyFile(f.x, f.y);

    const item = document.createElement("div");
    item.className = "changed-file-item";
    item.title = `${status.title}: ${f.path}`;
    item.dataset.path = f.path;

    const badge = document.createElement("span");
    badge.className = "changed-file-badge";
    badge.textContent = status.label;
    badge.style.color = status.color;
    badge.style.borderColor = status.color;

    const name = document.createElement("span");
    name.className = "changed-file-name";
    // Show only the filename, full path in title
    const parts = f.path.split("/");
    name.textContent = parts[parts.length - 1];
    if (parts.length > 1) {
      const dir = document.createElement("span");
      dir.className = "changed-file-dir";
      dir.textContent = parts.slice(0, -1).join("/") + "/";
      item.appendChild(badge);
      item.appendChild(dir);
      item.appendChild(name);
    } else {
      item.appendChild(badge);
      item.appendChild(name);
    }

    // Sprint 4: open diff viewer on file click
    item.addEventListener("click", () => {
      const cached = activeTabId !== null ? tabGitCache.get(activeTabId) : null;
      const projectRoot = cached?.projectRoot ?? null;
      if (!projectRoot) {
        console.warn("[changed-files] no projectRoot — cannot open diff viewer");
        return;
      }
      openDiffViewer(projectRoot, f.path, f.x, f.y);
    });

    list.appendChild(item);
  }
}

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------

async function refreshChangedFilesPanel(): Promise<void> {
  if (!changedFilesPanelOpen) return;
  if (activeTabId === null) {
    renderChangedFiles([]);
    return;
  }

  const cached = tabGitCache.get(activeTabId);
  const projectRoot = cached?.projectRoot ?? null;

  if (!projectRoot) {
    renderChangedFiles([]);
    return;
  }

  try {
    const files = await window.terminalAPI.gitFiles(projectRoot);
    renderChangedFiles(files);
  } catch {
    renderChangedFiles([]);
  }
}

// ---------------------------------------------------------------------------
// Open / Close
// ---------------------------------------------------------------------------

function openChangedFilesPanel(): void {
  if (changedFilesPanelOpen) return;
  changedFilesPanelOpen = true;
  const panel = getPanel();
  panel.classList.remove("hidden");
  // Trigger transition on next frame
  requestAnimationFrame(() => panel.classList.add("open"));
  refreshChangedFilesPanel();
  // Start polling
  if (changedFilesRefreshTimer === null) {
    changedFilesRefreshTimer = setInterval(() => {
      refreshChangedFilesPanel();
    }, CHANGED_FILES_POLL_MS);
  }
}

function closeChangedFilesPanel(): void {
  if (!changedFilesPanelOpen) return;
  changedFilesPanelOpen = false;
  const panel = getPanel();
  panel.classList.remove("open");
  // Wait for slide-out transition then hide
  const onEnd = () => {
    panel.classList.add("hidden");
    panel.removeEventListener("transitionend", onEnd);
  };
  panel.addEventListener("transitionend", onEnd);
  // Stop polling
  if (changedFilesRefreshTimer !== null) {
    clearInterval(changedFilesRefreshTimer);
    changedFilesRefreshTimer = null;
  }
}

function toggleChangedFilesPanel(): void {
  if (changedFilesPanelOpen) {
    closeChangedFilesPanel();
  } else {
    openChangedFilesPanel();
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function initChangedFilesPanel(): void {
  const closeBtn = document.getElementById("close-changed-files");
  if (closeBtn) {
    closeBtn.addEventListener("click", closeChangedFilesPanel);
  }
}
