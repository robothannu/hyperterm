/**
 * User-facing workspace-reader tests.
 * Verifies the dashboard chooses Claude vs Codex from real workspace layouts:
 * - Claude-only workspace
 * - Codex-only workspace
 * - Mixed workspace with mtime-based selection
 *
 * Run: npm run build && node test/workspace-reader-overview.test.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}: ${err.message}`);
    failed++;
  }
}

globalThis.module = { exports: {} };
globalThis.exports = globalThis.module.exports;

const distPath = new URL("../dist/main/workspace-reader.js", import.meta.url).pathname;
const require = createRequire(import.meta.url);
const { summarizeOverview, detectTool } = require(distPath);

function makeWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "terminal-app-workspace-"));
  fs.writeFileSync(path.join(dir, "CLAUDE.md"), "# Claude\n\n## Overview\nClaude goal\n\n## Objective\nClaude objective\n", "utf8");
  fs.writeFileSync(path.join(dir, "progress.md"), "## Current Task\nClaude current\n\n## Next Steps\n- Claude next\n", "utf8");
  fs.mkdirSync(path.join(dir, ".codex"), { recursive: true });
  fs.writeFileSync(path.join(dir, "AGENT.md"), "# Codex\n\n## Overview\nCodex goal\n\n## Objective\nCodex objective\n", "utf8");
  fs.writeFileSync(path.join(dir, ".codex", "HANDOFF.md"), "## Current Task\nCodex current\n\n## Next Steps\n- Codex next\n", "utf8");
  return dir;
}

function makeClaudeOnlyWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "terminal-app-workspace-"));
  fs.writeFileSync(path.join(dir, "CLAUDE.md"), "# Claude\n\n## Overview\nClaude-only goal\n\n## Objective\nClaude-only objective\n", "utf8");
  fs.writeFileSync(path.join(dir, "progress.md"), "## Current Task\nClaude-only current\n\n## Next Steps\n- Claude-only next\n", "utf8");
  return dir;
}

function makeCodexOnlyWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "terminal-app-workspace-"));
  fs.mkdirSync(path.join(dir, ".codex"), { recursive: true });
  fs.writeFileSync(path.join(dir, "AGENT.md"), "# Codex\n\n## Overview\nCodex-only goal\n\n## Objective\nCodex-only objective\n", "utf8");
  fs.writeFileSync(path.join(dir, ".codex", "HANDOFF.md"), "## Current Task\nCodex-only current\n\n## Next Steps\n- Codex-only next\n", "utf8");
  return dir;
}

function makeCodexDualHandoffWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "terminal-app-workspace-"));
  fs.mkdirSync(path.join(dir, ".codex"), { recursive: true });
  fs.writeFileSync(path.join(dir, "AGENT.md"), "# Codex\n\n## Overview\nCodex dual goal\n\n## Objective\nCodex dual objective\n", "utf8");
  fs.writeFileSync(path.join(dir, ".codex", "HANDOFF.md"), "## Current Task\nOld codex current\n\n## Next Steps\n- Old codex next\n", "utf8");
  fs.writeFileSync(path.join(dir, "codex-handoff.md"), "## Current Task\nNew codex current\n\n## Next Steps\n- New codex next\n", "utf8");
  return dir;
}

async function main() {
  console.log("\n=== summarizeOverview (mtime selection) ===\n");

  await test("detectTool: chooses Claude when both sides exist but Claude is newer", async () => {
    const ws = makeWorkspace();
    const older = Date.now() - 24 * 60 * 60 * 1000;
    const newer = Date.now() - 10 * 1000;
    fs.utimesSync(path.join(ws, "CLAUDE.md"), new Date(newer), new Date(newer));
    fs.utimesSync(path.join(ws, "progress.md"), new Date(newer), new Date(newer));
    fs.utimesSync(path.join(ws, "AGENT.md"), new Date(older), new Date(older));
    fs.utimesSync(path.join(ws, ".codex", "HANDOFF.md"), new Date(older), new Date(older));

    assert.equal(detectTool(ws), "claude");
  });

  await test("detectTool: chooses Codex when both sides exist but Codex is newer", async () => {
    const ws = makeWorkspace();
    const older = Date.now() - 24 * 60 * 60 * 1000;
    const newer = Date.now() - 10 * 1000;
    fs.utimesSync(path.join(ws, "CLAUDE.md"), new Date(older), new Date(older));
    fs.utimesSync(path.join(ws, "progress.md"), new Date(older), new Date(older));
    fs.utimesSync(path.join(ws, "AGENT.md"), new Date(newer), new Date(newer));
    fs.utimesSync(path.join(ws, ".codex", "HANDOFF.md"), new Date(newer), new Date(newer));

    assert.equal(detectTool(ws), "codex");
  });

  await test("detectTool: tie breaks to Claude when modified times are equal", async () => {
    const ws = makeWorkspace();
    const same = Date.now() - 10 * 1000;
    fs.utimesSync(path.join(ws, "CLAUDE.md"), new Date(same), new Date(same));
    fs.utimesSync(path.join(ws, "progress.md"), new Date(same), new Date(same));
    fs.utimesSync(path.join(ws, "AGENT.md"), new Date(same), new Date(same));
    fs.utimesSync(path.join(ws, ".codex", "HANDOFF.md"), new Date(same), new Date(same));

    assert.equal(detectTool(ws), "claude");
  });

  await test("summarizeOverview: chooses the more recently updated tool as primary", async () => {
    const ws = makeWorkspace();
    const older = Date.now() - 24 * 60 * 60 * 1000;
    const newer = Date.now() - 10 * 1000;
    fs.utimesSync(path.join(ws, "CLAUDE.md"), new Date(older), new Date(older));
    fs.utimesSync(path.join(ws, "progress.md"), new Date(older), new Date(older));
    fs.utimesSync(path.join(ws, "AGENT.md"), new Date(newer), new Date(newer));
    fs.utimesSync(path.join(ws, ".codex", "HANDOFF.md"), new Date(newer), new Date(newer));

    const result = await summarizeOverview(ws);
    assert.equal("error" in result, false);
    if ("error" in result) return;

    assert.equal(result.tool, "codex");
    assert.equal(result.primaryTool, "codex");
    assert.equal(result.goal, "Codex goal");
    assert.equal(result.currentTask, "Codex current");
    assert.equal(result.nextSteps[0], "Codex next");
    assert.ok(result.claudeState);
    assert.ok(result.codexState);
    assert.equal(result.claudeState?.goal, "Claude goal");
    assert.equal(result.codexState?.goal, "Codex goal");
  });

  await test("falls back to Claude when only Claude files exist", async () => {
    const ws = makeClaudeOnlyWorkspace();

    const result = await summarizeOverview(ws);
    assert.equal("error" in result, false);
    if ("error" in result) return;

    assert.equal(result.tool, "claude");
    assert.equal(result.primaryTool, "claude");
    assert.equal(result.goal, "Claude-only goal");
    assert.equal(result.currentTask, "Claude-only current");
    assert.equal(result.codexState, null);
  });

  await test("summarizeOverview: reads Codex-only workspace from AGENT.md and handoff", async () => {
    const ws = makeCodexOnlyWorkspace();

    const result = await summarizeOverview(ws);
    assert.equal("error" in result, false);
    if ("error" in result) return;

    assert.equal(result.tool, "codex");
    assert.equal(result.primaryTool, "codex");
    assert.equal(result.goal, "Codex-only goal");
    assert.equal(result.currentTask, "Codex-only current");
    assert.ok(result.codexState);
    assert.equal(result.claudeState, null);
  });

  await test("summarizeOverview: prefers the newest Codex handoff file when multiple exist", async () => {
    const ws = makeCodexDualHandoffWorkspace();
    const older = Date.now() - 24 * 60 * 60 * 1000;
    const newer = Date.now() - 10 * 1000;
    fs.utimesSync(path.join(ws, ".codex", "HANDOFF.md"), new Date(older), new Date(older));
    fs.utimesSync(path.join(ws, "codex-handoff.md"), new Date(newer), new Date(newer));
    fs.utimesSync(path.join(ws, "AGENT.md"), new Date(older), new Date(older));

    const result = await summarizeOverview(ws);
    assert.equal("error" in result, false);
    if ("error" in result) return;

    assert.equal(result.tool, "codex");
    assert.equal(result.primaryTool, "codex");
    assert.equal(result.currentTask, "New codex current");
    assert.equal(result.nextSteps[0], "New codex next");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

await main();
