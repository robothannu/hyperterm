/// <reference path="./global.d.ts" />

// --- Usage Status Bar ---

const statusBarEl = document.getElementById("statusbar")!;
const usage5h = document.getElementById("usage-5h")!;
const usage7d = document.getElementById("usage-7d")!;
const usageSeps = statusBarEl.querySelectorAll(".usage-sep");
let usageLoading = false;

function getUsageColorClass(utilization: number): string {
  if (utilization >= 95) return "critical";
  if (utilization >= 80) return "warn";
  return "normal";
}

function formatResetTime(resetsAt: string | null): string {
  if (!resetsAt) return "";
  const date = new Date(resetsAt);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  if (diffMs <= 0) return "reset imminent";
  const diffD = Math.floor(diffMs / 86400000);
  const diffH = Math.floor((diffMs % 86400000) / 3600000);
  const diffM = Math.floor((diffMs % 3600000) / 60000);
  if (diffD > 0) return `${diffD}d ${diffH}h`;
  if (diffH > 0) return `${diffH}h ${diffM}m`;
  return `${diffM}m`;
}

function updateUsageMetric(
  el: HTMLElement,
  label: string,
  metric: { utilization: number; resets_at: string | null } | undefined
): void {
  if (!metric || metric.utilization == null) {
    el.innerHTML = `<span class="usage-label">${label}</span><span class="usage-bar-wrap"><span class="usage-bar"><span class="usage-bar-fill normal" style="width:0%"></span></span><span class="usage-pct">--</span></span><span class="usage-reset"></span>`;
    el.title = "";
    el.className = "usage-metric";
    return;
  }
  const pct = Math.round(metric.utilization);
  const colorClass = getUsageColorClass(metric.utilization);
  const pctClass = colorClass === 'critical' ? 'usage-critical' : colorClass === 'warn' ? 'usage-warn' : '';
  const resetText = formatResetTime(metric.resets_at);
  el.innerHTML = `<span class="usage-label">${label}</span><span class="usage-bar-wrap"><span class="usage-bar"><span class="usage-bar-fill ${colorClass}" style="width:${pct}%"></span></span><span class="usage-pct ${pctClass}">${pct}%</span></span><span class="usage-reset">${resetText}</span>`;
  el.title = "";
  el.className = "usage-metric";
}

async function refreshUsage(): Promise<void> {
  if (usageLoading) return;
  usageLoading = true;

  try {
    const result = await window.terminalAPI.fetchUsage();

    if (result.error) {
      // On any error (auth or fetch), hide usage entirely
      usage5h.textContent = "";
      usage5h.className = "usage-metric";
      usage5h.title = "";
      usage7d.textContent = "";
      usage7d.className = "usage-metric";
      usage7d.title = "";
      usageSeps.forEach((sep) => {
        (sep as HTMLElement).style.display = "none";
      });
      return;
    }

    if (result.data) {
      // Show separators
      usageSeps.forEach((sep) => {
        (sep as HTMLElement).style.display = "";
      });
      updateUsageMetric(usage5h, "5h", result.data.five_hour);
      updateUsageMetric(usage7d, "7d", result.data.seven_day);
    }
  } catch (err) {
    console.error("[renderer] Usage refresh failed:", err);
  } finally {
    usageLoading = false;
  }
}

statusBarEl.addEventListener("click", () => {
  refreshUsage();
});
