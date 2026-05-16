/// <reference path="./global.d.ts" />

// ---------------------------------------------------------------------------
// Dashboard Git Flow module — split out of dashboard.ts (Sprint 2 — design v2).
// Loaded as a plain <script> after dashboard.js, so it shares dashboard.ts's
// global scope. State that lives here:
//   - _gitFlowCache, _gitFlowInflight  (workspace-keyed fetch cache)
//   - _gitflowModalScale, _gitflowModalWorkspaceId  (zoom modal state)
// dashboard.ts calls clearGitflowCache() on refresh and ensureGitflowForWorkspace()
// when a card expands; openGitflowModal() opens the modal.
// ---------------------------------------------------------------------------

declare function dashEsc(s: string): string;
declare function cssAttrEsc(s: string): string;
declare var _workspaces: WorkspaceEntry[];
declare var _expandedIds: Set<string>;

// Sprint 2: gitflow data cache, keyed by workspace id.
// undefined  = not yet fetched (fetch on next expand)
// null       = fetched but unavailable (non-git / failed) — do not retry until refresh
// otherwise  = ready data, render immediately on expand
var _gitFlowCache: Map<string, DashboardGitFlowData | null> = new Map();
// Track in-flight fetches so we don't double-fire when a card gets expanded
// repeatedly while a request is pending.
var _gitFlowInflight: Set<string> = new Set();

function clearGitflowCache(): void {
  _gitFlowCache.clear();
  _gitFlowInflight.clear();
}

// Lane color tokens lifted verbatim from the design source so visual parity
// with the static mock is grep-checkable.
var GITFLOW_LANE_COLORS: Record<string, string> = {
  main:    "#4a78c0",
  hotfix:  "#a78bfa",
  release: "#7fc3f5",
  develop: "#ff7a6b",
  feature: "#9ad641",
  feature2:"#9ad641",
};
var GITFLOW_LANE_BG: Record<string, string> = {
  main:    "rgba(74,120,192,0.18)",
  hotfix:  "rgba(167,139,250,0.18)",
  release: "rgba(127,195,245,0.2)",
  develop: "rgba(255,122,107,0.18)",
  feature: "rgba(154,214,65,0.2)",
  feature2:"rgba(154,214,65,0.2)",
};

function gitflowLaneKey(branchName: string): string {
  var n = branchName.toLowerCase();
  if (n === "main" || n === "master") return "main";
  if (n === "develop" || n === "dev") return "develop";
  if (n.startsWith("release/") || n === "release") return "release";
  if (n.startsWith("hotfix/") || n === "hotfix") return "hotfix";
  return "feature";
}

function gitflowPushSummary(ahead: number | null | undefined, behind: number | null | undefined): string {
  var a = typeof ahead === "number" ? ahead : null;
  var b = typeof behind === "number" ? behind : null;
  if (a === null && b === null) return "No upstream tracking";
  if ((a || 0) === 0 && (b || 0) === 0) return "Up to date with upstream";
  var parts: string[] = [];
  if ((a || 0) > 0) parts.push(`${a} commit${a === 1 ? "" : "s"} ready to push`);
  if ((b || 0) > 0) parts.push(`${b} commit${b === 1 ? "" : "s"} to pull`);
  return parts.join(", ");
}

function gitflowBranchSummaryMap(data: DashboardGitFlowData): Record<string, DashboardGitFlowBranchSummary> {
  var out: Record<string, DashboardGitFlowBranchSummary> = {};
  var summaries = Array.isArray(data.branchSummaries) ? data.branchSummaries : [];
  for (var b of summaries) out[b.name] = b;
  return out;
}

function gitflowBranchTooltip(data: DashboardGitFlowData, branchName: string): string {
  var summary = gitflowBranchSummaryMap(data)[branchName];
  var lines = [`Branch: ${branchName}`];
  if (data.branch === branchName) lines.push("Current branch");
  if (summary) {
    if (summary.shortHash) lines.push(`Latest commit: ${summary.shortHash}${summary.lastMessage ? " - " + summary.lastMessage : ""}`);
    if (summary.lastCommitRelTime) lines.push(`Updated: ${summary.lastCommitRelTime}`);
    lines.push(`Upstream: ${summary.upstream || "none"}`);
    lines.push(`Push status: ${gitflowPushSummary(summary.ahead, summary.behind)}`);
  } else {
    lines.push("No local branch summary available");
  }
  return lines.join("\n");
}

function gitflowCommitTooltip(c: GitflowLayoutCommit): string {
  var lines = [
    `Commit: ${c.shortHash}`,
    `Branch: ${c.lane}`,
    `Message: ${c.msg || "(no message)"}`,
  ];
  if (c.author) lines.push(`Author: ${c.author}`);
  if (c.relTime) lines.push(`Date: ${c.relTime}`);
  if (c.parents.length > 0) lines.push(`Parents: ${c.parents.map((p) => p.slice(0, 8)).join(", ")}`);
  if (c.tag) lines.push(`Tag: ${c.tag}`);
  if (c.isHead) lines.push("HEAD");
  return lines.join("\n");
}

function gitflowDataTooltip(data: DashboardGitFlowData): string {
  var lines = [
    `Git Flow: ${data.summary || data.commits.length + " commits"}`,
    `Current branch: ${data.branch || "unknown"}`,
  ];
  if (data.remoteUrl) lines.push(`Remote: ${data.remoteUrl}`);
  lines.push(`Current push status: ${gitflowPushSummary(data.ahead, data.behind)}`);
  var summaries = Array.isArray(data.branchSummaries) ? data.branchSummaries : [];
  if (summaries.length > 0) {
    lines.push("");
    lines.push("Branches:");
    for (var b of summaries.slice(0, 8)) {
      var msg = b.lastMessage ? ` - ${b.lastMessage}` : "";
      lines.push(`- ${b.name}: ${gitflowPushSummary(b.ahead, b.behind)}${msg}`);
    }
    if (summaries.length > 8) lines.push(`- +${summaries.length - 8} more branches`);
  }
  return lines.join("\n");
}

function gitflowRemoteLabel(remoteUrl: string | null): string {
  if (!remoteUrl) return "No remote";
  var match = remoteUrl.match(/github\.com[:/](.+?)(?:\.git)?$/i);
  if (match && match[1]) return match[1];
  return remoteUrl.replace(/^https?:\/\//, "").replace(/\.git$/, "");
}

function renderGitflowInsights(data: DashboardGitFlowData): string {
  var summaries = Array.isArray(data.branchSummaries) ? data.branchSummaries : [];
  var current = summaries.find((b) => b.name === data.branch) ?? null;
  var currentPush = gitflowPushSummary(data.ahead, data.behind);
  var latestMsg = current?.lastMessage || data.commits[0]?.msg || "No recent commit message";
  var branchList = summaries
    .slice()
    .sort((a, b) => {
      if (a.name === data.branch) return -1;
      if (b.name === data.branch) return 1;
      return a.name.localeCompare(b.name);
    })
    .slice(0, 4);
  var branchChips = branchList.map((b) => {
    var push = gitflowPushSummary(b.ahead, b.behind);
    var currentClass = b.name === data.branch ? " current" : "";
    return `<button type="button" class="gf-branch-chip${currentClass}" data-gf-type="branch" data-gf-id="${dashEsc(b.name)}" title="${dashEsc(gitflowBranchTooltip(data, b.name))}">${dashEsc(b.name)}<span>${dashEsc(push)}</span></button>`;
  }).join("");
  var more = summaries.length > branchList.length
    ? `<span class="gf-branch-more">+${summaries.length - branchList.length} more</span>`
    : "";

  return ""
    + `<div class="gitflow-insights">`
    + `<div class="gf-insight-main">`
    + `<span><strong>${dashEsc(data.branch || "unknown")}</strong> · ${dashEsc(currentPush)}</span>`
    + `<span>${dashEsc(gitflowRemoteLabel(data.remoteUrl))}</span>`
    + `</div>`
    + `<div class="gf-insight-sub" title="${dashEsc(latestMsg)}">${dashEsc(latestMsg)}</div>`
    + `<div class="gf-branch-chips">${branchChips}${more}</div>`
    + `</div>`;
}

interface GitflowLaneRow {
  key: string;
  label: string;
  colorKey: string;
}

interface GitflowLayoutCommit {
  id: string;
  shortHash: string;
  parents: string[];
  msg: string;
  author: string;
  relTime: string;
  tag: string | null;
  isHead: boolean;
  lane: string;
  x: number;
}

function gitflowAssignLanes(
  data: DashboardGitFlowData,
): { lanes: GitflowLaneRow[]; commits: GitflowLayoutCommit[] } {
  var commits = data.commits;
  if (commits.length === 0) {
    return { lanes: [], commits: [] };
  }

  var laneOf: Record<string, string> = {};
  for (var c of commits) {
    if (c.branch) laneOf[c.id] = c.branch;
  }

  var byHash: Record<string, DashboardGitFlowCommit> = {};
  for (var c2 of commits) byHash[c2.id] = c2;
  for (var c3 of commits) {
    var lane = laneOf[c3.id];
    if (!lane) continue;
    var firstParent = c3.parents[0];
    if (firstParent && byHash[firstParent] && !laneOf[firstParent]) {
      laneOf[firstParent] = lane;
    }
  }

  var fallbackLane = data.branch || "main";
  for (var c4 of commits) {
    if (!laneOf[c4.id]) laneOf[c4.id] = fallbackLane;
  }

  var seen: Record<string, boolean> = {};
  var laneOrder: string[] = [];
  for (var c5 of commits) {
    var l = laneOf[c5.id];
    if (!seen[l]) { seen[l] = true; laneOrder.push(l); }
  }
  laneOrder.sort(function (a, b) {
    var aMain = (a === "main" || a === "master") ? 0 : 1;
    var bMain = (b === "main" || b === "master") ? 0 : 1;
    if (aMain !== bMain) return aMain - bMain;
    return 0;
  });

  var lanes: GitflowLaneRow[] = laneOrder.map(function (name) {
    return { key: name, label: name, colorKey: gitflowLaneKey(name) };
  });

  var N = commits.length;
  var layoutCommits: GitflowLayoutCommit[] = commits.map(function (c, i) {
    return {
      id: c.id,
      shortHash: c.shortHash,
      parents: c.parents,
      msg: c.msg,
      author: c.author,
      relTime: c.relTime,
      tag: c.tag,
      isHead: c.isHead,
      lane: laneOf[c.id],
      x: (N - 1) - i,
    };
  });

  return { lanes, commits: layoutCommits };
}

function gitflowFindCommit(data: DashboardGitFlowData, commitId: string): DashboardGitFlowCommit | null {
  return data.commits.find((c) => c.id === commitId || c.shortHash === commitId) ?? null;
}

function gitflowFindBranch(data: DashboardGitFlowData, branchName: string): DashboardGitFlowBranchSummary | null {
  var summaries = Array.isArray(data.branchSummaries) ? data.branchSummaries : [];
  return summaries.find((b) => b.name === branchName) ?? null;
}

function gitflowDetailKV(label: string, value: string | null | undefined): string {
  return ""
    + `<div class="gf-detail-kv">`
    + `<div>${dashEsc(label)}</div>`
    + `<div>${dashEsc(value && value.length > 0 ? value : "—")}</div>`
    + `</div>`;
}

function renderGitflowOverviewDetail(data: DashboardGitFlowData): string {
  var summaries = Array.isArray(data.branchSummaries) ? data.branchSummaries : [];
  var currentPush = gitflowPushSummary(data.ahead, data.behind);
  var branchRows = summaries
    .slice()
    .sort((a, b) => {
      if (a.name === data.branch) return -1;
      if (b.name === data.branch) return 1;
      return a.name.localeCompare(b.name);
    })
    .slice(0, 8)
    .map((b) => {
      var current = b.name === data.branch ? `<span class="gf-detail-pill">current</span>` : "";
      return `<button type="button" class="gf-detail-branch" data-gf-type="branch" data-gf-id="${dashEsc(b.name)}"><strong>${dashEsc(b.name)}</strong>${current}<span>${dashEsc(gitflowPushSummary(b.ahead, b.behind))}</span></button>`;
    }).join("");
  return ""
    + `<div class="gf-detail-title">Repository</div>`
    + `<div class="gf-detail-sub">${dashEsc(data.summary || data.commits.length + " commits")}</div>`
    + `<div class="gf-detail-grid">`
    + gitflowDetailKV("Current branch", data.branch || "unknown")
    + gitflowDetailKV("Remote", gitflowRemoteLabel(data.remoteUrl))
    + gitflowDetailKV("Push status", currentPush)
    + gitflowDetailKV("HEAD", data.head ? data.head.slice(0, 12) : null)
    + `</div>`
    + `<div class="gf-detail-section-title">Branches</div>`
    + `<div class="gf-detail-branches">${branchRows || '<div class="gf-detail-empty">No branch summary available.</div>'}</div>`;
}

function renderGitflowBranchDetail(data: DashboardGitFlowData, branchName: string): string {
  var b = gitflowFindBranch(data, branchName);
  var laneCommits = data.commits.filter((c) => c.branch === branchName);
  var latest = b?.shortHash || laneCommits[0]?.shortHash || null;
  var latestMessage = b?.lastMessage || laneCommits[0]?.msg || null;
  var current = branchName === data.branch;
  return ""
    + `<div class="gf-detail-title">${dashEsc(branchName)}${current ? ' <span class="gf-detail-pill">current</span>' : ""}</div>`
    + `<div class="gf-detail-sub">Branch details</div>`
    + `<div class="gf-detail-grid">`
    + gitflowDetailKV("Latest commit", latest)
    + gitflowDetailKV("Latest message", latestMessage)
    + gitflowDetailKV("Updated", b?.lastCommitRelTime || laneCommits[0]?.relTime || null)
    + gitflowDetailKV("Upstream", b?.upstream || null)
    + gitflowDetailKV("Push status", b ? gitflowPushSummary(b.ahead, b.behind) : "No upstream tracking")
    + gitflowDetailKV("Visible commits", laneCommits.length > 0 ? String(laneCommits.length) : "0")
    + `</div>`
    + `<div class="gf-detail-section-title">Recent commits on this lane</div>`
    + `<div class="gf-detail-commit-list">`
    + laneCommits.slice(0, 6).map((c) => `<button type="button" class="gf-detail-commit" data-gf-type="commit" data-gf-id="${dashEsc(c.id)}"><strong>${dashEsc(c.shortHash)}</strong><span>${dashEsc(c.msg || "(no message)")}</span></button>`).join("")
    + (laneCommits.length === 0 ? '<div class="gf-detail-empty">No visible commits for this branch in the current graph.</div>' : "")
    + `</div>`;
}

function renderGitflowCommitDetail(data: DashboardGitFlowData, commitId: string): string {
  var c = gitflowFindCommit(data, commitId);
  if (!c) {
    return `<div class="gf-detail-title">Commit not found</div><div class="gf-detail-empty">Refresh Git Flow and try again.</div>`;
  }
  var parents = c.parents.length > 0 ? c.parents.map((p) => p.slice(0, 12)).join(", ") : "—";
  return ""
    + `<div class="gf-detail-title">${dashEsc(c.shortHash)}${c.isHead ? ' <span class="gf-detail-pill">HEAD</span>' : ""}</div>`
    + `<div class="gf-detail-sub">${dashEsc(c.msg || "(no message)")}</div>`
    + `<div class="gf-detail-grid">`
    + gitflowDetailKV("Branch", c.branch || "unknown")
    + gitflowDetailKV("Author", c.author)
    + gitflowDetailKV("Date", c.relTime)
    + gitflowDetailKV("Full hash", c.id)
    + gitflowDetailKV("Parents", parents)
    + gitflowDetailKV("Tag", c.tag || null)
    + `</div>`;
}

function renderGitflowDetail(data: DashboardGitFlowData, type: string, id: string | null): string {
  if (type === "branch" && id) return renderGitflowBranchDetail(data, id);
  if (type === "commit" && id) return renderGitflowCommitDetail(data, id);
  return renderGitflowOverviewDetail(data);
}

function setGitflowSelection(type: string, id: string | null): void {
  var detail = document.getElementById("gf-detail");
  if (!_gitflowModalWorkspaceId || !detail) return;
  var data = _gitFlowCache.get(_gitflowModalWorkspaceId);
  if (!data) return;
  detail.innerHTML = renderGitflowDetail(data, type, id);
  document.querySelectorAll<HTMLElement>("#gf-canvas [data-gf-selected]").forEach((el) => {
    el.removeAttribute("data-gf-selected");
  });
  if (id) {
    document.querySelectorAll<HTMLElement>(`#gf-canvas [data-gf-type="${cssAttrEsc(type)}"][data-gf-id="${cssAttrEsc(id)}"]`).forEach((el) => {
      el.setAttribute("data-gf-selected", "true");
    });
  }
}

function renderGitflowSVG(workspaceId: string, data: DashboardGitFlowData): string {
  var laid = gitflowAssignLanes(data);
  var lanes = laid.lanes;
  var commits = laid.commits;
  if (lanes.length === 0 || commits.length === 0) return "";

  var padR = 16, padT = 30, padB = 18;
  var laneH = 44;
  var colW = 44;
  var maxLabelChars = lanes.reduce(function (m, l) { return Math.max(m, l.label.length); }, 0);
  var padL = Math.max(96, Math.ceil(maxLabelChars * 7.2 + 22 + 14));

  var maxX = commits.reduce(function (m, c) { return Math.max(m, c.x); }, 0);
  var innerW = maxX * colW + colW + 40;
  var W = padL + innerW + padR;
  var H = padT + lanes.length * laneH + padB;

  var laneY: Record<string, number> = {};
  lanes.forEach(function (l, i) { laneY[l.key] = padT + i * laneH + laneH / 2; });

  var posByHash: Record<string, { x: number; y: number }> = {};
  commits.forEach(function (c) {
    posByHash[c.id] = { x: padL + c.x * colW + 16, y: laneY[c.lane] };
  });

  var laneSVG = lanes.map(function (l) {
    var y = laneY[l.key];
    var color = GITFLOW_LANE_COLORS[l.colorKey] || "#888";
    var bg = GITFLOW_LANE_BG[l.colorKey] || "rgba(255,255,255,0.05)";
    var labelW = (l.label.length * 7.2) + 22;
    var tooltip = gitflowBranchTooltip(data, l.label);
    return ""
      + `<line class="lane-line" x1="${padL - 6}" y1="${y}" x2="${W - padR}" y2="${y}"/>`
      + `<g class="lane-meta" data-gf-type="branch" data-gf-id="${dashEsc(l.label)}">`
      + `<title>${dashEsc(tooltip)}</title>`
      + `<rect x="${padL - labelW - 14}" y="${y - 18}" width="${W - padL + labelW + 6}" height="36" fill="transparent" pointer-events="all"/>`
      + `<rect x="${padL - labelW - 8}" y="${y - 12}" width="${labelW}" height="24" rx="12" fill="${bg}" stroke="${color}" stroke-opacity="0.4"/>`
      + `<text x="${padL - labelW - 8 + labelW / 2}" y="${y + 4}" text-anchor="middle" class="lane-label" fill="${color}">${dashEsc(l.label)}</text>`
      + `</g>`;
  }).join("");

  var arrowId = `gf-arrow-${workspaceId}`;
  var safeArrowId = arrowId.replace(/[^a-zA-Z0-9_-]/g, "_");
  var edgeSVG = commits.map(function (c) {
    var b = posByHash[c.id];
    if (!b) return "";
    var isMerge = c.parents.length > 1;
    return c.parents.map(function (parentHash) {
      var a = posByHash[parentHash];
      if (!a) return "";
      var sameLane = a.y === b.y;
      var d;
      if (sameLane) {
        d = `M${a.x + 5},${a.y} L${b.x - 5},${b.y}`;
      } else {
        var mx = (a.x + b.x) / 2;
        d = `M${a.x},${a.y} C${mx},${a.y} ${mx},${b.y} ${b.x},${b.y}`;
      }
      var cls = isMerge ? "commit-edge merge" : "commit-edge";
      return `<path class="${cls}" d="${d}" marker-end="url(#${safeArrowId})"/>`;
    }).join("");
  }).join("");

  var commitSVG = commits.map(function (c) {
    var p = posByHash[c.id];
    var color = GITFLOW_LANE_COLORS[gitflowLaneKey(c.lane)] || "#888";
    var r = c.isHead ? 9 : 7;
    var tagSVG = "";
    if (c.tag) {
      var tw = c.tag.length * 7.2 + 16;
      var tagX = p.x - tw / 2;
      var tagY = padT - 24;
      tagSVG = ""
        + `<g transform="translate(${tagX}, ${tagY})">`
        + `<path d="M0,0 H${tw} V14 L${tw / 2 + 4},18 L${tw / 2 - 4},18 L${tw / 2},22 L${tw / 2 - 4},18 L${tw / 2 - 4},18 H0 Z" class="tag-bg"/>`
        + `<text x="${tw / 2}" y="10" text-anchor="middle" class="tag">${dashEsc(c.tag)}</text>`
        + `<line x1="${tw / 2}" y1="22" x2="${tw / 2}" y2="${p.y - padT + 24 - 6}" stroke="${color}" stroke-opacity="0.4" stroke-dasharray="2 2"/>`
        + `</g>`;
    }
    var headSVG = "";
    if (c.isHead) {
      headSVG = ""
        + `<g transform="translate(${p.x + 13}, ${p.y - 11})">`
        + `<rect x="0" y="0" width="42" height="18" rx="4" fill="${color}" fill-opacity="0.15" stroke="${color}" stroke-opacity="0.5"/>`
        + `<text x="21" y="13" text-anchor="middle" class="head-label" fill="${color}">HEAD</text>`
        + `</g>`;
    }
    var titleText = gitflowCommitTooltip(c);
    return ""
      + tagSVG
      + `<g class="commit ${c.isHead ? "head" : ""}" data-gf-type="commit" data-gf-id="${dashEsc(c.id)}">`
      + `<circle class="commit-hit" cx="${p.x}" cy="${p.y}" r="18" fill="transparent" pointer-events="all"/>`
      + `<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="${color}"/>`
      + headSVG
      + `<title>${dashEsc(titleText)}</title>`
      + `</g>`;
  }).join("");

  var legendItems = lanes.map(function (l) {
    var color = GITFLOW_LANE_COLORS[l.colorKey] || "#888";
    var tooltip = gitflowBranchTooltip(data, l.label);
    return `<button type="button" class="lg-item" data-gf-type="branch" data-gf-id="${dashEsc(l.label)}" title="${dashEsc(tooltip)}"><span class="lg-dot" style="background:${color}"></span>${dashEsc(l.label)}</button>`;
  }).join("");
  var flowTooltip = gitflowDataTooltip(data);

  return ""
    + `<div class="gitflow-wrap">`
    + `<div class="gitflow-head" data-gf-type="overview" title="${dashEsc(flowTooltip)}">`
    + `<span>Git Flow · ${dashEsc(data.summary || "")}</span>`
    + `<span class="legend">${legendItems}</span>`
    + `</div>`
    + renderGitflowInsights(data)
    + `<div class="gitflow-scroll">`
    + `<svg class="gitflow-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
    + `<defs>`
    + `<marker id="${safeArrowId}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">`
    + `<path d="M0,0 L8,4 L0,8 Z" fill="rgba(255,255,255,0.35)"/>`
    + `</marker>`
    + `</defs>`
    + laneSVG
    + edgeSVG
    + commitSVG
    + `</svg>`
    + `</div>`
    + `</div>`;
}

function paintGitflowInto(workspaceId: string, data: DashboardGitFlowData | null): void {
  var host = document.getElementById("ce-" + workspaceId);
  if (!host) return;
  if (!data || !data.commits || data.commits.length === 0) {
    host.innerHTML = "";
    return;
  }
  var summary = data.summary || (data.commits.length + " commits");
  var tooltip = gitflowDataTooltip(data);
  host.innerHTML = ""
    + `<button class="gitflow-trigger" type="button" data-action="open-gitflow" data-id="${dashEsc(workspaceId)}" title="${dashEsc(tooltip)}">`
    +   `<span class="gf-trig-icon">`
    +     `<svg width="14" height="14" viewBox="0 0 16 16" fill="none">`
    +       `<circle cx="4" cy="4" r="1.6" fill="currentColor"/>`
    +       `<circle cx="4" cy="12" r="1.6" fill="currentColor"/>`
    +       `<circle cx="12" cy="8" r="1.6" fill="currentColor"/>`
    +       `<path d="M4 5.5v5M5.5 12h3a2.5 2.5 0 002.5-2.5v0" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" fill="none"/>`
    +     `</svg>`
    +   `</span>`
    +   `<span class="gf-trig-label">Git Flow</span>`
    +   `<span class="gf-trig-summary">${dashEsc(summary)}</span>`
    +   `<span class="gf-trig-arrow">&rarr;</span>`
    + `</button>`;
  var btn = host.querySelector(".gitflow-trigger") as HTMLElement | null;
  if (btn) {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      openGitflowModal(workspaceId);
    });
  }
}

// ---------------------------------------------------------------------------
// Git Flow zoom modal
// ---------------------------------------------------------------------------

var _gitflowModalScale: number = 1;
var _gitflowModalWorkspaceId: string | null = null;
var GITFLOW_ZOOM_MIN = 0.4;
var GITFLOW_ZOOM_MAX = 4;
var GITFLOW_ZOOM_STEP = 0.2;

function openGitflowModal(workspaceId: string): void {
  var data = _gitFlowCache.get(workspaceId);
  if (!data) return;
  var modal = document.getElementById("gitflow-modal");
  var canvas = document.getElementById("gf-canvas");
  var detail = document.getElementById("gf-detail");
  var titleEl = document.getElementById("gf-modal-title");
  if (!modal || !canvas) return;
  _gitflowModalWorkspaceId = workspaceId;
  var ws = _workspaces.find(function (w) { return w.id === workspaceId; });
  if (titleEl) {
    titleEl.textContent = "Git Flow — " + (ws ? ws.name : workspaceId) + " · " + (data.summary || "");
  }
  canvas.innerHTML = renderGitflowSVG("modal-" + workspaceId, data);
  if (detail) detail.innerHTML = renderGitflowOverviewDetail(data);
  modal.classList.add("open");
  requestAnimationFrame(function () {
    setGitflowZoomFit();
  });
}

function closeGitflowModal(): void {
  var modal = document.getElementById("gitflow-modal");
  if (!modal) return;
  modal.classList.remove("open");
  _gitflowModalWorkspaceId = null;
  _gitflowModalScale = 1;
  var canvas = document.getElementById("gf-canvas");
  if (canvas) canvas.innerHTML = "";
  var detail = document.getElementById("gf-detail");
  if (detail) detail.innerHTML = "";
}

function setGitflowZoom(scale: number): void {
  var clamped = Math.max(GITFLOW_ZOOM_MIN, Math.min(GITFLOW_ZOOM_MAX, scale));
  _gitflowModalScale = clamped;
  var canvas = document.getElementById("gf-canvas");
  var label = document.getElementById("gf-zoom-label");
  if (canvas) canvas.style.transform = "scale(" + clamped + ")";
  if (label) label.textContent = Math.round(clamped * 100) + "%";
}

function setGitflowZoomFit(): void {
  var body = document.getElementById("gf-stage") || document.getElementById("gf-modal-body");
  var canvas = document.getElementById("gf-canvas");
  if (!body || !canvas) return;
  var svg = canvas.querySelector("svg.gitflow-svg") as SVGSVGElement | null;
  if (!svg) return;
  var natW = svg.width.baseVal.value || parseFloat(svg.getAttribute("width") || "0");
  var natH = svg.height.baseVal.value || parseFloat(svg.getAttribute("height") || "0");
  if (!natW || !natH) return;
  var availW = body.clientWidth - 56;
  var availH = body.clientHeight - 56;
  var fit = Math.min(availW / natW, availH / natH);
  setGitflowZoom(Math.min(fit, 2));
}

function ensureGitflowForWorkspace(ws: WorkspaceEntry): void {
  if (_gitFlowCache.has(ws.id)) {
    paintGitflowInto(ws.id, _gitFlowCache.get(ws.id) || null);
    return;
  }
  if (_gitFlowInflight.has(ws.id)) return;
  var api = window.dashboardAPI;
  if (!api || typeof api.gitFlow !== "function") return;
  _gitFlowInflight.add(ws.id);
  api.gitFlow(ws.absolutePath)
    .then(function (data) {
      _gitFlowCache.set(ws.id, data || null);
      if (_expandedIds.has(ws.id)) {
        paintGitflowInto(ws.id, data || null);
      }
    })
    .catch(function (err) {
      console.log("[dashboard] gitFlow fetch failed for " + ws.absolutePath + ": " + (err instanceof Error ? err.message : String(err)));
      _gitFlowCache.set(ws.id, null);
    })
    .finally(function () {
      _gitFlowInflight.delete(ws.id);
    });
}

// ---------------------------------------------------------------------------
// Modal control wiring + keyboard shortcuts (only fires when modal open)
// ---------------------------------------------------------------------------

function initGitflowModalControls(): void {
  var modal = document.getElementById("gitflow-modal");
  if (!modal) return;
  modal.addEventListener("click", function (e) {
    if (e.target === modal) closeGitflowModal();
  });
  var closeBtn = document.getElementById("gf-modal-close");
  if (closeBtn) closeBtn.addEventListener("click", closeGitflowModal);
  var zin = document.getElementById("gf-zoom-in");
  if (zin) zin.addEventListener("click", function () { setGitflowZoom(_gitflowModalScale + GITFLOW_ZOOM_STEP); });
  var zout = document.getElementById("gf-zoom-out");
  if (zout) zout.addEventListener("click", function () { setGitflowZoom(_gitflowModalScale - GITFLOW_ZOOM_STEP); });
  var zfit = document.getElementById("gf-zoom-fit");
  if (zfit) zfit.addEventListener("click", setGitflowZoomFit);
  var zreset = document.getElementById("gf-zoom-reset");
  if (zreset) zreset.addEventListener("click", function () { setGitflowZoom(1); });
  var body = document.getElementById("gf-stage") || document.getElementById("gf-modal-body");
  if (body) {
    body.addEventListener("wheel", function (e) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      var delta = e.deltaY > 0 ? -GITFLOW_ZOOM_STEP : GITFLOW_ZOOM_STEP;
      setGitflowZoom(_gitflowModalScale + delta);
    }, { passive: false });
  }
  var canvas = document.getElementById("gf-canvas");
  if (canvas) {
    canvas.addEventListener("click", function (e) {
      var target = e.target as Element | null;
      var el = target?.closest("[data-gf-type]") as HTMLElement | null;
      if (!el) return;
      var type = el.getAttribute("data-gf-type") || "overview";
      var id = el.getAttribute("data-gf-id");
      if (type === "overview") {
        setGitflowSelection("overview", null);
        return;
      }
      if (type === "branch" || type === "commit") {
        e.stopPropagation();
        setGitflowSelection(type, id);
      }
    });
  }
  var detail = document.getElementById("gf-detail");
  if (detail) {
    detail.addEventListener("click", function (e) {
      var target = e.target as Element | null;
      var el = target?.closest("[data-gf-type]") as HTMLElement | null;
      if (!el) return;
      var type = el.getAttribute("data-gf-type") || "";
      var id = el.getAttribute("data-gf-id");
      if (type === "branch" || type === "commit") {
        e.stopPropagation();
        setGitflowSelection(type, id);
      }
    });
  }
}

// Modal-scoped keyboard shortcuts. Listener is always attached but only acts
// when _gitflowModalWorkspaceId is set (modal open). dashboard.ts's own
// keyboard handler no longer needs to know about gitflow keys.
document.addEventListener("keydown", function (e) {
  if (!_gitflowModalWorkspaceId) return;
  if (e.key === "Escape") { e.preventDefault(); closeGitflowModal(); return; }
  if (e.key === "+" || e.key === "=") { e.preventDefault(); setGitflowZoom(_gitflowModalScale + GITFLOW_ZOOM_STEP); return; }
  if (e.key === "-" || e.key === "_") { e.preventDefault(); setGitflowZoom(_gitflowModalScale - GITFLOW_ZOOM_STEP); return; }
  if (e.key === "0") { e.preventDefault(); setGitflowZoom(1); return; }
  if (e.key === "f" || e.key === "F") {
    if (!e.metaKey && !e.ctrlKey) { e.preventDefault(); setGitflowZoomFit(); return; }
  }
});
