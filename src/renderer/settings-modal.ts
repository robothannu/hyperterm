/// <reference path="./global.d.ts" />
/// <reference path="./pane-types.d.ts" />

// --- Settings Modal (Sprint 6) ---
// Opens with Cmd+, or settings button. Saves on close.

const DEFAULT_FONT_SIZE = 14;

let settingsModalEl: HTMLElement | null = null;
let currentSettings: AppSettings = { claudeNotifications: false };

// ---------------------------------------------------------------------------
// Open / Close
// ---------------------------------------------------------------------------

async function openSettingsModal(): Promise<void> {
  if (!settingsModalEl) return;
  try {
    currentSettings = await window.terminalAPI.getSettings();
  } catch {
    currentSettings = { claudeNotifications: false };
  }
  populateSettingsUI();
  settingsModalEl.classList.remove("hidden");
}

function closeSettingsModal(): void {
  if (!settingsModalEl) return;
  saveSettingsFromUI();
  settingsModalEl.classList.add("hidden");
}

// ---------------------------------------------------------------------------
// UI population
// ---------------------------------------------------------------------------

function populateSettingsUI(): void {
  const fontSlider = document.getElementById("settings-font-size-slider") as HTMLInputElement | null;
  const fontValue = document.getElementById("settings-font-size-value");
  const themeToggle = document.getElementById("settings-theme-toggle") as HTMLInputElement | null;
  const notifToggle = document.getElementById("settings-notif-toggle") as HTMLInputElement | null;
  const hookStatus = document.getElementById("settings-hook-status");

  const fontSize = currentSettings.fontSize ?? DEFAULT_FONT_SIZE;
  if (fontSlider) fontSlider.value = String(fontSize);
  if (fontValue) fontValue.textContent = `${fontSize}px`;

  const isDark = (currentSettings.theme ?? "dark") === "dark";
  if (themeToggle) themeToggle.checked = !isDark; // checked = light

  if (notifToggle) notifToggle.checked = currentSettings.claudeNotifications ?? false;

  // Hook status
  if (hookStatus) {
    hookStatus.textContent = "확인 중...";
    window.terminalAPI.hookCheckInstalled().then((installed) => {
      if (!hookStatus) return;
      const installBtn = document.getElementById("settings-hook-install-btn") as HTMLButtonElement | null;
      if (installed) {
        hookStatus.textContent = "설치됨";
        hookStatus.className = "settings-hook-status installed";
        if (installBtn) installBtn.style.display = "none";
      } else {
        hookStatus.textContent = "미설치";
        hookStatus.className = "settings-hook-status not-installed";
        if (installBtn) installBtn.style.display = "inline-block";
      }
    }).catch(() => {
      if (hookStatus) hookStatus.textContent = "알 수 없음";
    });
  }
}

// ---------------------------------------------------------------------------
// Apply font size live to all terminals
// ---------------------------------------------------------------------------

function applyFontSizeToAll(size: number): void {
  // Update global default so new sessions inherit this size
  activeSessionSettings.fontSize = size;
  for (const session of sessions.values()) {
    session.setFontSize(size);
  }
}

// ---------------------------------------------------------------------------
// Apply theme
// ---------------------------------------------------------------------------

function applyTheme(theme: "dark" | "light"): void {
  // Update global default so new sessions inherit this theme
  activeSessionSettings.theme = theme;
  document.body.classList.toggle("theme-light", theme === "light");
  document.body.classList.toggle("theme-dark", theme === "dark");
  for (const session of sessions.values()) {
    session.setTheme(theme);
  }
}

// ---------------------------------------------------------------------------
// Save settings from UI
// ---------------------------------------------------------------------------

function saveSettingsFromUI(): void {
  const fontSlider = document.getElementById("settings-font-size-slider") as HTMLInputElement | null;
  const themeToggle = document.getElementById("settings-theme-toggle") as HTMLInputElement | null;
  const notifToggle = document.getElementById("settings-notif-toggle") as HTMLInputElement | null;

  const fontSize = fontSlider ? parseInt(fontSlider.value, 10) : (currentSettings.fontSize ?? DEFAULT_FONT_SIZE);
  const theme: "dark" | "light" = themeToggle?.checked ? "light" : "dark";
  const claudeNotifications = notifToggle?.checked ?? false;

  const updated: AppSettings = {
    ...currentSettings,
    fontSize,
    theme,
    claudeNotifications,
  };

  window.terminalAPI.saveSettings(updated).catch((e) => {
    console.error("[settings] Failed to save settings:", e);
  });

  currentSettings = updated;
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function initSettingsModal(): Promise<void> {
  settingsModalEl = document.getElementById("settings-modal");
  if (!settingsModalEl) {
    console.warn("[settings] settings-modal element not found");
    return;
  }

  // Load settings and apply font/theme immediately
  try {
    currentSettings = await window.terminalAPI.getSettings();
    if (currentSettings.fontSize) {
      // applyFontSizeToAll also updates activeSessionSettings
      applyFontSizeToAll(currentSettings.fontSize);
    }
    if (currentSettings.theme) {
      // applyTheme also updates activeSessionSettings
      applyTheme(currentSettings.theme);
    }
  } catch {
    // ignore
  }

  // Font size slider — live update
  const fontSlider = document.getElementById("settings-font-size-slider") as HTMLInputElement | null;
  const fontValue = document.getElementById("settings-font-size-value");
  fontSlider?.addEventListener("input", () => {
    const size = parseInt(fontSlider.value, 10);
    if (fontValue) fontValue.textContent = `${size}px`;
    applyFontSizeToAll(size);
  });

  // Theme toggle — live update
  const themeToggle = document.getElementById("settings-theme-toggle") as HTMLInputElement | null;
  themeToggle?.addEventListener("change", () => {
    applyTheme(themeToggle.checked ? "light" : "dark");
  });

  // Hook install button
  const installBtn = document.getElementById("settings-hook-install-btn") as HTMLButtonElement | null;
  const hookStatus = document.getElementById("settings-hook-status");
  installBtn?.addEventListener("click", async () => {
    if (installBtn) {
      installBtn.disabled = true;
      installBtn.textContent = "설치 중...";
    }
    try {
      const ok = await window.terminalAPI.hookInstall();
      if (ok && hookStatus) {
        hookStatus.textContent = "설치됨";
        hookStatus.className = "settings-hook-status installed";
        if (installBtn) installBtn.style.display = "none";
      } else {
        if (installBtn) {
          installBtn.disabled = false;
          installBtn.textContent = "설치";
        }
      }
    } catch {
      if (installBtn) {
        installBtn.disabled = false;
        installBtn.textContent = "설치";
      }
    }
  });

  // Close on overlay click
  settingsModalEl.addEventListener("click", (e) => {
    if (e.target === settingsModalEl) closeSettingsModal();
  });

  // Close button
  document.getElementById("settings-close")?.addEventListener("click", closeSettingsModal);

  // Cmd+, keyboard shortcut handled in keybindings; ESC handled below
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && settingsModalEl && !settingsModalEl.classList.contains("hidden")) {
      e.preventDefault();
      closeSettingsModal();
    }
    if (e.key === "," && e.metaKey) {
      e.preventDefault();
      if (settingsModalEl && settingsModalEl.classList.contains("hidden")) {
        openSettingsModal();
      } else {
        closeSettingsModal();
      }
    }
  });

  // Settings gear button in sidebar header (if present)
  document.getElementById("btn-settings")?.addEventListener("click", () => {
    openSettingsModal();
  });
}
