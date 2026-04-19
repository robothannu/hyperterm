/// <reference path="./global.d.ts" />

// --- Claude Code Hook Installation Banner ---
// Shows a banner at app start if hooks are not installed in ~/.claude/settings.json.
// User can install hooks with one click.

function createHookBanner(): HTMLElement {
  const banner = document.createElement("div");
  banner.id = "hook-install-banner";
  banner.className = "hook-install-banner";
  banner.innerHTML = `
    <span class="hook-banner-icon">⚡</span>
    <span class="hook-banner-text">Claude Code hooks가 설치되지 않았습니다. HyperTerm과 통합하면 실시간 상태를 확인할 수 있습니다.</span>
    <button id="hook-banner-install" class="hook-banner-btn">설치</button>
    <button id="hook-banner-dismiss" class="hook-banner-dismiss" title="닫기">✕</button>
  `;
  return banner;
}

async function initHookInstallBanner(): Promise<void> {
  try {
    const installed = await window.terminalAPI.hookCheckInstalled();
    if (installed) return;
  } catch {
    return;
  }

  const banner = createHookBanner();
  // Insert after titlebar, before main-area
  const titlebar = document.getElementById("titlebar");
  if (titlebar && titlebar.parentNode) {
    titlebar.parentNode.insertBefore(banner, titlebar.nextSibling);
  } else {
    document.getElementById("app")?.prepend(banner);
  }

  document.getElementById("hook-banner-install")?.addEventListener("click", async () => {
    const btn = document.getElementById("hook-banner-install") as HTMLButtonElement | null;
    if (btn) {
      btn.disabled = true;
      btn.textContent = "설치 중...";
    }
    try {
      const ok = await window.terminalAPI.hookInstall();
      if (ok) {
        banner.remove();
        showHookInstallToast("Claude Code hooks 설치 완료!");
      } else {
        if (btn) {
          btn.disabled = false;
          btn.textContent = "설치";
        }
        showHookInstallToast("설치 실패. ~/.claude/settings.json 권한을 확인하세요.", true);
      }
    } catch {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "설치";
      }
    }
  });

  document.getElementById("hook-banner-dismiss")?.addEventListener("click", () => {
    banner.remove();
  });
}

function showHookInstallToast(message: string, isError = false): void {
  const toast = document.createElement("div");
  toast.className = "hook-toast" + (isError ? " hook-toast-error" : " hook-toast-ok");
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}
