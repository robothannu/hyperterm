/// <reference path="./global.d.ts" />
// dashboard-newproject.ts — New Project Wizard modal
// Sprint 1: New Project Wizard
// 모달 렌더링 / 검증 / IPC 호출 / 등록 후 Run with Claude 트리거 담당

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NewProjectOptions {
  tool: "claude" | "codex";
  gitInit: true;
  claudeMd?: boolean;
  progressMd?: boolean;
  agentMd?: boolean;
  handoffMd?: boolean;
  gitignoreNode?: boolean;
}

interface NewProjectPayload {
  projectName: string;
  parentDir: string;
  options: NewProjectOptions;
}

interface NewProjectResult {
  success: boolean;
  absolutePath?: string;
  workspaces?: WorkspaceEntry[];
  error?: string;
  parentCreated?: boolean;
  warnings?: string[];
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

var _npModalEl: HTMLElement | null = null;
var _npOnClose: (() => void) | null = null;

// ---------------------------------------------------------------------------
// HTML escape helper (reuse from dashboard.ts scope via global dashEsc — but
// define locally in case this file loads before dashboard.ts)
// ---------------------------------------------------------------------------

function npEsc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------------------
// Project name validation
// AC #3: 빈 값/잘못된 문자(/, \0, . or .. 단독, 선두 공백 등) 검증
// ---------------------------------------------------------------------------

function validateProjectName(name: string): string | null {
  // 빈 값
  if (!name || name.length === 0) return "Project name is required.";

  // 선두 공백
  if (name !== name.trimStart()) return "Project name must not start with a space.";

  // null 바이트
  if (name.includes("\0")) return "Project name contains invalid characters.";

  // 슬래시 (디렉토리 구분자)
  if (name.includes("/")) return "Project name must not contain '/'.";

  // . 또는 .. 단독 (macOS 예약)
  if (name === "." || name === "..") return 'Project name cannot be "." or "..".';

  // macOS 파일명 최대 길이 255바이트
  if (new TextEncoder().encode(name).length > 255) return "Project name is too long (max 255 bytes).";

  return null; // valid
}

// ---------------------------------------------------------------------------
// Modal HTML
// ---------------------------------------------------------------------------

function buildModalHTML(homeDir: string): string {
  var defaultParent = homeDir ? homeDir + "/dev" : "";

  return `
<div id="np-modal" role="dialog" aria-modal="true" aria-labelledby="np-modal-title"
     style="
       position:fixed; inset:0; z-index:2000;
       background:rgba(8,9,13,0.62);
       display:flex; align-items:center; justify-content:center;
       backdrop-filter:blur(4px); -webkit-backdrop-filter:blur(4px);
     ">
  <div id="np-dlg" style="
       width:min(520px,calc(100vw - 48px));
       background:var(--bg-1);
       border:1px solid var(--line-2);
       border-radius:12px;
       box-shadow:0 20px 60px rgba(0,0,0,0.55);
       display:flex; flex-direction:column; overflow:hidden;
       ">
    <!-- Head -->
    <div style="
         padding:16px 20px 12px;
         border-bottom:1px solid var(--line);
         display:flex; align-items:center; justify-content:space-between;
         background:linear-gradient(180deg,#0f1116,transparent);
         ">
      <div>
        <div id="np-modal-title" style="font-size:14px;font-weight:600;color:var(--fg-0);">New Project</div>
        <div style="font-size:12px;color:var(--fg-3);margin-top:2px;">Create a new project folder and add it as a workspace.</div>
      </div>
      <button id="np-close-btn" aria-label="Close" title="Close (Esc)" style="
           width:30px;height:30px;background:transparent;
           border:1px solid var(--line);border-radius:7px;
           color:var(--fg-2);cursor:pointer;font-size:14px;
           display:grid;place-items:center;
           ">&times;</button>
    </div>

    <!-- Body -->
    <div style="padding:20px;display:flex;flex-direction:column;gap:18px;">

      <!-- Project name -->
      <div style="display:flex;flex-direction:column;gap:6px;">
        <label for="np-name" style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--fg-3);">
          Project Name <span style="color:var(--err)">*</span>
        </label>
        <input id="np-name" type="text" autocomplete="off" spellcheck="false"
               placeholder="my-project"
               style="
                 height:34px;padding:0 12px;
                 background:var(--bg-2);border:1px solid var(--line);border-radius:8px;
                 color:var(--fg-0);font-size:13px;font-family:inherit;outline:none;
               " />
        <div id="np-name-err" style="font-size:11.5px;color:var(--err);display:none;"></div>
      </div>

      <!-- Parent directory -->
      <div style="display:flex;flex-direction:column;gap:6px;">
        <label for="np-parent-dir" style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--fg-3);">
          Parent Directory <span style="color:var(--err)">*</span>
        </label>
        <div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;">
          <input id="np-parent-dir" type="text" readonly
                 value="${npEsc(defaultParent)}"
                 placeholder="Choose a parent folder"
                 style="
                   width:100%;height:34px;padding:0 12px;
                   background:var(--bg-2);border:1px solid var(--line);border-radius:8px;
                   color:var(--fg-0);font-size:13px;font-family:var(--mono,monospace);outline:none;
                   cursor:default;
                 " />
          <button id="np-parent-choose" type="button"
                  style="
                    height:34px;padding:0 12px;
                    background:var(--bg-2);border:1px solid var(--line);border-radius:8px;
                    color:var(--fg-1);font-size:12px;font-family:inherit;cursor:pointer;
                    white-space:nowrap;
                  ">
            Choose…
          </button>
        </div>
        <div id="np-parent-err" style="font-size:11.5px;color:var(--err);display:none;"></div>
      </div>

      <!-- Final path preview -->
      <div id="np-preview-wrap" style="
           background:var(--bg-2);border:1px solid var(--line);border-radius:8px;
           padding:8px 12px;
           display:flex;align-items:center;gap:8px;
           ">
        <span style="font-size:11px;color:var(--fg-3);font-weight:600;white-space:nowrap;">Path</span>
        <span id="np-preview-path" style="
              font-family:'JetBrains Mono',monospace;font-size:11.5px;color:var(--fg-2);
              overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;
              ">—</span>
      </div>

      <!-- Initialization -->
      <div style="display:flex;flex-direction:column;gap:10px;">
        <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--fg-3);">Initialize with</div>
        <div style="display:flex;gap:8px;">
          <label style="display:flex;align-items:center;gap:7px;padding:8px 12px;
                 border:1px solid var(--line);border-radius:7px;cursor:pointer;
                 background:var(--bg-2);font-size:12.5px;color:var(--fg-1);flex:1;">
            <input type="radio" id="np-tool-claude" name="np-tool" value="claude" checked
                   style="width:14px;height:14px;accent-color:var(--accent);flex:none;" />
            Claude
          </label>
          <label style="display:flex;align-items:center;gap:7px;padding:8px 12px;
                 border:1px solid var(--line);border-radius:7px;cursor:pointer;
                 background:var(--bg-2);font-size:12.5px;color:var(--fg-1);flex:1;">
            <input type="radio" id="np-tool-codex" name="np-tool" value="codex"
                   style="width:14px;height:14px;accent-color:var(--accent);flex:none;" />
            Codex
          </label>
        </div>
        <div style="
             background:var(--bg-2);border:1px solid var(--line);border-radius:8px;
             padding:8px 12px;display:flex;align-items:center;gap:8px;
             ">
          <span style="font-size:11px;color:var(--fg-3);font-weight:600;white-space:nowrap;">Creates</span>
          <span id="np-init-files" style="font-family:'JetBrains Mono',monospace;font-size:11.5px;color:var(--fg-2);
                overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">git, CLAUDE.md, progress.md</span>
        </div>
      </div>

      <!-- Global error -->
      <div id="np-global-err" style="font-size:12px;color:var(--err);background:rgba(255,107,107,0.08);
           border:1px solid rgba(255,107,107,0.2);border-radius:7px;padding:8px 12px;display:none;"></div>
    </div>

    <!-- Footer -->
    <div style="
         padding:12px 20px;border-top:1px solid var(--line);
         background:rgba(255,255,255,0.015);
         display:flex;justify-content:flex-end;align-items:center;gap:8px;
         ">
      <button id="np-cancel-btn" style="
           height:32px;padding:0 16px;
           background:var(--bg-2);border:1px solid var(--line);border-radius:7px;
           color:var(--fg-1);font-size:12.5px;font-family:inherit;cursor:pointer;
           ">Cancel</button>
      <button id="np-create-btn" style="
           height:32px;padding:0 16px;
           background:linear-gradient(180deg,var(--accent),#6a7aef);
           border:none;border-radius:7px;
           color:white;font-size:12.5px;font-family:inherit;cursor:pointer;font-weight:500;
           ">Create Project</button>
    </div>
  </div>
</div>
`;
}

// ---------------------------------------------------------------------------
// Modal state helpers
// ---------------------------------------------------------------------------

function npGetParentDir(): string {
  var inp = document.getElementById("np-parent-dir") as HTMLInputElement | null;
  return inp ? inp.value.trim() : "";
}

function npGetProjectName(): string {
  var inp = document.getElementById("np-name") as HTMLInputElement | null;
  return inp ? inp.value : "";
}

function npUpdatePreview(): void {
  var preview = document.getElementById("np-preview-path") as HTMLElement | null;
  if (!preview) return;
  var parent = npGetParentDir();
  var name = npGetProjectName().trim();
  if (!parent || !name) {
    preview.textContent = "—";
    return;
  }
  // 경로 결합: parent 끝 슬래시 제거 후 name 결합
  var combined = parent.replace(/\/+$/, "") + "/" + name;
  preview.textContent = combined;
}

function npShowNameErr(msg: string | null): void {
  var el = document.getElementById("np-name-err") as HTMLElement | null;
  if (!el) return;
  if (msg) {
    el.textContent = msg;
    el.style.display = "";
    var inp = document.getElementById("np-name") as HTMLInputElement | null;
    if (inp) inp.style.borderColor = "var(--err)";
  } else {
    el.style.display = "none";
    var inp2 = document.getElementById("np-name") as HTMLInputElement | null;
    if (inp2) inp2.style.borderColor = "";
  }
}

function npShowParentErr(msg: string | null): void {
  var el = document.getElementById("np-parent-err") as HTMLElement | null;
  if (!el) return;
  if (msg) {
    el.textContent = msg;
    el.style.display = "";
  } else {
    el.style.display = "none";
  }
}

function npShowGlobalErr(msg: string | null): void {
  var el = document.getElementById("np-global-err") as HTMLElement | null;
  if (!el) return;
  if (msg) {
    el.innerHTML = npEsc(msg);
    el.style.display = "";
  } else {
    el.style.display = "none";
  }
}

function npSetCreateBtnLoading(loading: boolean): void {
  var btn = document.getElementById("np-create-btn") as HTMLButtonElement | null;
  if (!btn) return;
  if (loading) {
    btn.textContent = "Creating…";
    btn.disabled = true;
    btn.style.opacity = "0.7";
    btn.style.cursor = "not-allowed";
  } else {
    btn.textContent = "Create Project";
    btn.disabled = false;
    btn.style.opacity = "";
    btn.style.cursor = "";
  }
}

function npSetParentDir(parentDir: string): void {
  var inp = document.getElementById("np-parent-dir") as HTMLInputElement | null;
  if (!inp) return;
  inp.value = parentDir;
  npShowParentErr(null);
  npUpdatePreview();
}

async function npChooseParentDir(): Promise<void> {
  var api = window.dashboardAPI;
  if (!api || typeof api.pickParentDirectory !== "function") {
    npShowParentErr("Directory picker is not available.");
    return;
  }

  try {
    var current = npGetParentDir();
    var result = await api.pickParentDirectory(current || undefined);
    if (result.canceled || !result.path) return;
    npSetParentDir(result.path);
  } catch (err) {
    var msg = err instanceof Error ? err.message : String(err);
    npShowParentErr("Failed to open directory picker: " + msg);
  }
}

function npUpdateInitSummary(): void {
  var el = document.getElementById("np-init-files") as HTMLElement | null;
  if (!el) return;
  var selectedTool = npGetSelectedTool();
  el.textContent = selectedTool === "codex"
    ? "git, AGENT.md, codex-handoff.md"
    : "git, CLAUDE.md, progress.md";
}

// ---------------------------------------------------------------------------
// Create handler
// ---------------------------------------------------------------------------

async function npHandleCreate(): Promise<void> {
  // 초기화
  npShowNameErr(null);
  npShowParentErr(null);
  npShowGlobalErr(null);

  var nameRaw = npGetProjectName();
  var nameTrimmed = nameRaw.trim();
  var parentDir = npGetParentDir();

  // 이름 검증
  var nameErr = validateProjectName(nameTrimmed);
  if (nameErr) {
    npShowNameErr(nameErr);
    return;
  }

  // 부모 디렉토리 검증
  if (!parentDir) {
    npShowParentErr("Parent directory is required.");
    return;
  }

  var selectedTool = npGetSelectedTool();

  var payload: NewProjectPayload = {
    projectName: nameTrimmed,
    parentDir,
    options: {
      tool: selectedTool,
      gitInit: true,
      claudeMd: selectedTool === "claude",
      progressMd: selectedTool === "claude",
      agentMd: selectedTool === "codex",
      handoffMd: selectedTool === "codex",
      gitignoreNode: false,
    },
  };

  npSetCreateBtnLoading(true);

  try {
    var api = window.dashboardAPI!;
    var result: NewProjectResult = await (api as any).newProject(payload);

    if (!result.success) {
      npSetCreateBtnLoading(false);

      // 이미 존재하는 경로 에러 (AC #4)
      if (result.error === "already_exists") {
        npShowGlobalErr("Directory already exists. Please choose a different name or parent directory.");
        return;
      }
      // 부모 디렉토리 없음 (AC #5 — 서버가 auto-create 후 이 에러를 내지 않음. 명시적 confirm 경우)
      if (result.error === "parent_missing") {
        var shouldCreate = window.confirm(
          `The parent directory "${parentDir}" does not exist.\n\nCreate it automatically?`
        );
        if (!shouldCreate) return;

        // parent_create 플래그 포함해서 재시도
        var retryPayload = { ...payload, createParent: true };
        npSetCreateBtnLoading(true);
        var retryResult: NewProjectResult = await (api as any).newProject(retryPayload);
        npSetCreateBtnLoading(false);
        if (!retryResult.success) {
          npShowGlobalErr(retryResult.error || "Failed to create project.");
          return;
        }
        await npOnSuccess(retryResult);
        return;
      }

      npShowGlobalErr(result.error || "Failed to create project.");
      return;
    }

    npSetCreateBtnLoading(false);

    // parent 자동 생성 알림 (AC #5)
    if (result.parentCreated) {
      console.log(`[new-project] parent directory was created: ${parentDir}`);
      showDashboardToast(`Parent directory created: ${parentDir}`, "ok");
    }

    // 부분 실패 (D.5): non-fatal step warnings 노출
    if (result.warnings && result.warnings.length > 0) {
      console.warn("[new-project] partial failures:", result.warnings);
      showDashboardToast(
        `프로젝트 생성됨 (일부 단계 실패: ${result.warnings.join(", ")})`,
        "warn"
      );
    }

    await npOnSuccess(result);
  } catch (err) {
    npSetCreateBtnLoading(false);
    var msg = err instanceof Error ? err.message : String(err);
    npShowGlobalErr("Unexpected error: " + msg);
    console.error("[new-project] create error:", err);
  }
}

// 선택된 도구(claude | codex) 반환
function npGetSelectedTool(): "claude" | "codex" {
  var codexRadio = document.getElementById("np-tool-codex") as HTMLInputElement | null;
  if (codexRadio && codexRadio.checked) return "codex";
  return "claude";
}

// 성공 후처리: 모달 닫기 → Dashboard 갱신 → Run with 선택된 도구 오픈
async function npOnSuccess(result: NewProjectResult): Promise<void> {
  var absolutePath = result.absolutePath!;
  var updatedWorkspaces = result.workspaces;
  var selectedTool = npGetSelectedTool();

  // workspaces 업데이트 (AC #7 — 즉시 카드 표시)
  if (updatedWorkspaces) {
    window._npInjectedWorkspaces = updatedWorkspaces;
  }

  // 모달 닫기 (AC #9)
  npCloseModal();

  // Dashboard 리렌더 — loadAndRender가 global scope에 선언되어 있음
  if (typeof window.npDashboardRefresh === "function") {
    await window.npDashboardRefresh(updatedWorkspaces);
  }

  showDashboardToast("Project created!", "ok");

  // Sprint 1 (Codex 진입점): 도구에 따라 Claude 또는 Codex로 오픈
  if (selectedTool === "codex") {
    // Run with Codex: npOpenWithCodex는 dashboard.ts에서 window에 노출됨
    if (typeof window.npOpenWithCodex === "function") {
      window.npOpenWithCodex(absolutePath);
    }
  } else {
    // Run with Claude 다이얼로그 자동 오픈 (AC #8)
    // handleOpenWithClaude는 dashboard.ts global scope에서 선언됨
    if (typeof window.npOpenWithClaude === "function") {
      window.npOpenWithClaude(absolutePath);
    }
  }
}

// ---------------------------------------------------------------------------
// Modal open / close
// ---------------------------------------------------------------------------

function npCloseModal(): void {
  if (_npModalEl && _npModalEl.parentNode) {
    _npModalEl.parentNode.removeChild(_npModalEl);
    _npModalEl = null;
  }
  if (_npOnClose) {
    _npOnClose();
    _npOnClose = null;
  }
}

/**
 * 외부 진입점: dashboard.ts의 boot 섹션에서 호출.
 * homeDir: 현재 _homeDir 값을 받아 discovery root 경로 구성에 사용.
 * onClose: 모달 닫힐 때 콜백 (필요 시 활용).
 */
function openNewProjectModal(homeDir: string, onClose?: () => void): void {
  // 이미 열려있으면 무시
  if (_npModalEl) return;

  _npOnClose = onClose || null;

  // 모달 DOM 삽입
  var wrapper = document.createElement("div");
  wrapper.innerHTML = buildModalHTML(homeDir);
  _npModalEl = wrapper.firstElementChild as HTMLElement;
  document.body.appendChild(_npModalEl);

  // 포커스 설정
  var nameInp = document.getElementById("np-name") as HTMLInputElement | null;
  if (nameInp) nameInp.focus();

  // preview 초기화
  npUpdatePreview();
  npUpdateInitSummary();

  // 이벤트 바인딩
  var closeBtn = document.getElementById("np-close-btn");
  if (closeBtn) closeBtn.addEventListener("click", () => npCloseModal());

  var cancelBtn = document.getElementById("np-cancel-btn");
  if (cancelBtn) cancelBtn.addEventListener("click", () => npCloseModal());

  // ESC 키 (AC #9)
  var npEscHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      npCloseModal();
      document.removeEventListener("keydown", npEscHandler);
    }
  };
  document.addEventListener("keydown", npEscHandler);

  // 외부 클릭 — 모달 배경(#np-modal) 클릭 시 닫기 (AC #9)
  _npModalEl.addEventListener("click", (e) => {
    if (e.target === _npModalEl) npCloseModal();
  });

  // Create 버튼
  var createBtn = document.getElementById("np-create-btn");
  if (createBtn) createBtn.addEventListener("click", () => { void npHandleCreate(); });

  // Enter 키 → Create 트리거
  var nameInput = document.getElementById("np-name") as HTMLInputElement | null;
  if (nameInput) {
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { void npHandleCreate(); }
    });
    // 실시간 검증 (AC #3 — 인라인 에러)
    nameInput.addEventListener("input", () => {
      var err = validateProjectName(nameInput!.value.trim());
      if (nameInput!.value.trim()) {
        npShowNameErr(err);
      } else {
        npShowNameErr(null); // 빈 값이면 에러 숨김 (타이핑 중)
      }
      npUpdatePreview();
    });
  }

  var parentChoose = document.getElementById("np-parent-choose");
  if (parentChoose) parentChoose.addEventListener("click", () => { void npChooseParentDir(); });

  var claudeTool = document.getElementById("np-tool-claude");
  if (claudeTool) claudeTool.addEventListener("change", () => npUpdateInitSummary());
  var codexTool = document.getElementById("np-tool-codex");
  if (codexTool) codexTool.addEventListener("change", () => npUpdateInitSummary());
}

window.openNewProjectModal = openNewProjectModal;
