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
    <span class="hook-banner-text">Claude Code hooks are not installed. Install them to enable live HyperTerm status updates.</span>
    <button id="hook-banner-install" class="hook-banner-btn">Install</button>
    <button id="hook-banner-dismiss" class="hook-banner-dismiss" title="Close">✕</button>
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
      btn.textContent = "Installing...";
    }
    try {
      const ok = await window.terminalAPI.hookInstall();
      if (ok) {
        banner.remove();
        showHookInstallToast("Claude Code hooks installed.");
      } else {
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Install";
        }
        showHookInstallToast("Install failed. Check permissions for ~/.claude/settings.json.", true);
      }
    } catch {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Install";
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
