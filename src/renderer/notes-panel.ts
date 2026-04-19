/// <reference path="./global.d.ts" />
/// <reference path="./pane-types.d.ts" />

// --- Notes Panel ---

const notesPanel = document.getElementById("notes-panel")!;
const notesTitle = document.getElementById("notes-title")!;
const notesList = document.getElementById("notes-list")!;
const notesInput = document.getElementById("notes-input") as HTMLTextAreaElement;
const notesAddBtn = document.getElementById("notes-add")!;
const notesCloseBtn = document.getElementById("notes-close")!;

let notesPanelTabId: number | null = null;
const sessionNotesCache = new Map<number, Note[]>();

function getTabSessionKey(tabId: number): string | null {
  const tab = tabMap.get(tabId);
  if (!tab) return null;
  const leaves = getAllLeaves(tab.root);
  if (leaves.length === 0) return null;
  return sessionKeys.get(leaves[0].ptyId) || null;
}

function openNotesPanel(tabId: number): void {
  notesPanelTabId = tabId;
  const label = tabLabels.get(tabId) || "Terminal";
  notesTitle.textContent = `Notes \u2014 ${label}`;
  notesPanel.classList.remove("hidden");
  notesInput.value = "";
  loadAndRenderNotes(tabId);
}

/**
 * Attempt to close the notes panel.
 * If there is unsaved text in the textarea, show a confirmation prompt.
 * "취소" → keep panel open, text preserved.
 * "폐기" → close panel, clear textarea.
 * Empty textarea → close immediately without prompt.
 */
function tryCloseNotesPanel(): void {
  const unsaved = notesInput.value.trim();
  if (unsaved !== "") {
    const discard = window.confirm(
      "저장되지 않은 노트가 있습니다.\n폐기하고 닫으시겠습니까?"
    );
    if (!discard) {
      // 취소: keep panel open, text preserved
      return;
    }
    // 폐기: clear textarea then close
    notesInput.value = "";
  }
  closeNotesPanel();
}

function closeNotesPanel(): void {
  notesPanel.classList.add("hidden");
  notesPanelTabId = null;
}

async function loadAndRenderNotes(tabId: number): Promise<void> {
  const sk = getTabSessionKey(tabId);
  if (!sk) return;

  const notes: Note[] = await window.terminalAPI.loadNotes(sk);
  sessionNotesCache.set(tabId, notes);
  renderNotes(notes);
  updateNoteIndicator(tabId, notes.length > 0);
}

function renderNotes(notes: Note[]): void {
  if (notes.length === 0) {
    notesList.innerHTML = '<div class="notes-empty">No notes yet</div>';
    return;
  }

  notesList.innerHTML = "";
  for (let i = notes.length - 1; i >= 0; i--) {
    const note = notes[i];
    const item = document.createElement("div");
    item.className = "note-item";

    const date = new Date(note.createdAt);
    const timeStr = date.toLocaleString();

    item.innerHTML = `
      <div class="note-content">${escapeHtml(note.content)}</div>
      <div class="note-footer">
        <span class="note-time">${escapeHtml(timeStr)}</span>
        <button class="note-delete" data-id="${note.id}">Delete</button>
      </div>
    `;

    item.querySelector(".note-delete")!.addEventListener("click", () => {
      deleteNote(note.id);
    });

    notesList.appendChild(item);
  }
}


async function addNote(): Promise<void> {
  const content = notesInput.value.trim();
  if (!content || notesPanelTabId === null) return;

  const sk = getTabSessionKey(notesPanelTabId);
  if (!sk) return;

  const notes = sessionNotesCache.get(notesPanelTabId) || [];
  const maxId = notes.reduce((max, n) => Math.max(max, n.id), 0);
  const newNote: Note = {
    id: maxId + 1,
    content,
    createdAt: new Date().toISOString(),
  };

  notes.push(newNote);
  await window.terminalAPI.saveNotes(sk, notes);
  sessionNotesCache.set(notesPanelTabId, notes);
  renderNotes(notes);
  updateNoteIndicator(notesPanelTabId, true);
  notesInput.value = "";
  notesInput.focus();
}

async function deleteNote(noteId: number): Promise<void> {
  if (notesPanelTabId === null) return;

  const sk = getTabSessionKey(notesPanelTabId);
  if (!sk) return;

  let notes = sessionNotesCache.get(notesPanelTabId) || [];
  notes = notes.filter((n) => n.id !== noteId);
  await window.terminalAPI.saveNotes(sk, notes);
  sessionNotesCache.set(notesPanelTabId, notes);
  renderNotes(notes);
  updateNoteIndicator(notesPanelTabId, notes.length > 0);
}

function updateNoteIndicator(tabId: number, hasNotes: boolean): void {
  const li = terminalList.querySelector(`[data-id="${tabId}"]`);
  const btn = li?.querySelector(".btn-notes");
  if (btn) btn.classList.toggle("has-notes", hasNotes);
}

notesCloseBtn.addEventListener("click", tryCloseNotesPanel);
notesAddBtn.addEventListener("click", addNote);
notesInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    addNote();
  } else if (e.key === "Escape") {
    e.preventDefault();
    tryCloseNotesPanel();
  }
});

// Overlay click on notes panel background closes panel (with unsaved check)
notesPanel.addEventListener("click", (e) => {
  if (e.target === notesPanel) {
    tryCloseNotesPanel();
  }
});
