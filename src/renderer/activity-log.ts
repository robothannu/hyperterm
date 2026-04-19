/// <reference path="./global.d.ts" />
/// <reference path="./pane-types.d.ts" />

// --- Activity Log (Recent Claude events) ---
// Stores last 20 waiting_approval / done events in sidebar "Recent Activity" section.

const ACTIVITY_MAX = 20;

interface ActivityEntry {
  type: "waiting_approval" | "done" | "working";
  tabId: number;
  tabLabel: string;
  ts: number;
}

const activityLog: ActivityEntry[] = [];
let activitySectionCollapsed = false;
let activityRefreshTimer: ReturnType<typeof setInterval> | null = null;

function logActivity(entry: Omit<ActivityEntry, "ts">): void {
  activityLog.unshift({ ...entry, ts: Date.now() });
  if (activityLog.length > ACTIVITY_MAX) activityLog.length = ACTIVITY_MAX;
  renderActivitySection();
}

function formatRelativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  return `${Math.floor(diff / 3600)}h`;
}

function renderActivitySection(): void {
  const section = document.getElementById("activity-log-section");
  if (!section) return;

  const header = section.querySelector(".sidebar-section-header") as HTMLElement;
  const list = section.querySelector(".activity-list") as HTMLElement;
  if (!header || !list) return;

  // Toggle collapse
  list.style.display = activitySectionCollapsed ? "none" : "";

  if (activityLog.length === 0) {
    list.innerHTML = `<div class="activity-empty">없음</div>`;
    return;
  }

  list.innerHTML = "";
  for (const entry of activityLog) {
    const tabExists = tabMap.has(entry.tabId);
    const icon = entry.type === "waiting_approval" ? "⚠" : entry.type === "working" ? "⚙" : "✓";
    const colorClass = entry.type === "waiting_approval" ? "activity-warn" : entry.type === "working" ? "activity-working" : "activity-done";

    const item = document.createElement("div");
    item.className = `activity-item${tabExists ? "" : " activity-stale"}`;
    item.title = tabExists ? `${entry.tabLabel} 탭으로 이동` : "탭이 닫혔음";
    item.innerHTML = `<span class="activity-icon ${colorClass}">${icon}</span><span class="activity-label">${escapeHtml(entry.tabLabel)}</span><span class="activity-time">${formatRelativeTime(entry.ts)}</span>`;

    if (tabExists) {
      item.addEventListener("click", () => switchToTab(entry.tabId));
    }
    list.appendChild(item);
  }
}


function createActivitySectionDOM(): void {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar || document.getElementById("activity-log-section")) return;

  const section = document.createElement("div");
  section.id = "activity-log-section";
  section.className = "sidebar-section";
  section.innerHTML = `
    <div class="sidebar-section-header">
      <span class="sidebar-section-title">Recent Activity</span>
      <span class="collapse-icon">▼</span>
    </div>
    <div class="activity-list"></div>
  `;
  sidebar.appendChild(section);
}

function initActivityLog(): void {
  createActivitySectionDOM();
  const section = document.getElementById("activity-log-section");
  if (!section) return;
  const header = section.querySelector(".sidebar-section-header");
  if (header) {
    header.addEventListener("click", () => {
      activitySectionCollapsed = !activitySectionCollapsed;
      const icon = header.querySelector(".collapse-icon");
      if (icon) icon.textContent = activitySectionCollapsed ? "▶" : "▼";
      renderActivitySection();
    });
  }
  renderActivitySection();
  if (!activityRefreshTimer) {
    activityRefreshTimer = setInterval(() => renderActivitySection(), 30000);
  }
}
