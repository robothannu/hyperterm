/**
 * Unit tests for dashboard card rendering logic.
 * Tests:
 *   1. project state display ordering
 *   2. git log parsing logic (via workspace-reader)
 *   3. markdown/XSS behavior sanity checks
 *
 * Run: node test/dashboard.test.mjs
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// ============================================================
// Test runner helpers
// ============================================================

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result
        .then(() => {
          console.log(`  [PASS] ${name}`);
          passed++;
        })
        .catch((err) => {
          console.error(`  [FAIL] ${name}: ${err.message}`);
          failed++;
        });
    }
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}: ${err.message}`);
    failed++;
  }
  return Promise.resolve();
}

// ============================================================
// Load compiled modules
// ============================================================

const dashboardPath = new URL("../dist/renderer/dashboard.js", import.meta.url).pathname;
const workspaceReaderPath = new URL("../dist/main/workspace-reader.js", import.meta.url).pathname;

// dashboard.ts is compiled as CommonJS (tsconfig: module=commonjs)
const require = createRequire(import.meta.url);
let getProjectStateDisplays;
try {
  const dashboardModule = require(dashboardPath);
  getProjectStateDisplays = dashboardModule.getProjectStateDisplays;
} catch (e) {
  console.error("Could not load dashboard.js:", e.message);
  process.exit(1);
}
assert.equal(typeof getProjectStateDisplays, "function", "getProjectStateDisplays must be exported");

let getCardData;
try {
  const readerModule = require(workspaceReaderPath);
  getCardData = readerModule.getCardData;
} catch (e) {
  console.error("Could not load workspace-reader.js:", e.message);
  process.exit(1);
}

// ============================================================
// Section: project state rendering helper
// ============================================================

console.log("\n=== getProjectStateDisplays tests ===\n");

const makeToolState = (overrides = {}) => ({
  objective: "Refactor dashboard",
  goal: "Make rendering easier to reason about",
  currentTask: "Split mixed-state rendering",
  nextSteps: ["Add helper", "Add tests"],
  updatedAt: "2026-05-13T00:00:00.000Z",
  ...overrides,
});

await test("getProjectStateDisplays: shows only Codex when Codex is primary", () => {
  const displays = getProjectStateDisplays(
    "codex",
    makeToolState({ goal: "Claude goal" }),
    makeToolState({ goal: "Codex goal" })
  );
  assert.equal(displays.length, 1);
  assert.equal(displays[0].label, "Codex");
  assert.equal(displays[0].primary, true);
  assert.equal(displays[0].state.goal, "Codex goal");
});

await test("getProjectStateDisplays: returns only Claude state when Codex is absent", () => {
  const displays = getProjectStateDisplays("claude", makeToolState(), null);
  assert.equal(displays.length, 1);
  assert.equal(displays[0].label, "Claude");
  assert.equal(displays[0].primary, true);
});

await test("getProjectStateDisplays: returns empty array when no state exists", () => {
  const displays = getProjectStateDisplays(null, null, null);
  assert.deepEqual(displays, []);
});

await test("getProjectStateDisplays: shows only Claude when Claude is primary", () => {
  const displays = getProjectStateDisplays(
    "claude",
    makeToolState({ goal: "Claude goal" }),
    makeToolState({ goal: "Codex goal" })
  );
  assert.equal(displays.length, 1);
  assert.equal(displays[0].label, "Claude");
  assert.equal(displays[0].primary, true);
});

// ============================================================
// Section: workspace-reader getCardData invalid path
// ============================================================

console.log("\n=== workspace-reader: input validation ===\n");

await test("getCardData: rejects non-string path", async () => {
  const result = await getCardData(null);
  assert.ok("error" in result, `Expected error property. Got: ${JSON.stringify(result)}`);
  assert.equal(result.error, "invalid_path");
});

await test("getCardData: rejects relative path", async () => {
  const result = await getCardData("relative/path");
  assert.ok("error" in result, `Expected error. Got: ${JSON.stringify(result)}`);
});

await test("getCardData: returns notAGitRepo for non-git directory", async () => {
  const result = await getCardData("/tmp");
  assert.ok(!("error" in result), `Unexpected error: ${JSON.stringify(result)}`);
  // /tmp is typically not a git repo
  assert.equal(result.notAGitRepo, true);
});

await test("getCardData: returns null claude/progress for path without those files", async () => {
  const result = await getCardData("/tmp");
  assert.ok(!("error" in result));
  assert.equal(result.claude, null);
  assert.equal(result.progress, null);
});

// ============================================================
// Section: markdown behavior sanity checks
// ============================================================

console.log("\n=== markdown behavior sanity checks ===\n");

// Load marked CJS (Node-compatible; browser uses UMD via <script> tag)
const markedPath = new URL("../node_modules/marked/lib/marked.cjs", import.meta.url).pathname;

let markedLib;
try {
  markedLib = require(markedPath);
} catch (e) {
  console.error("Could not load marked:", e.message);
  process.exit(1);
}

// DOMPurify requires a DOM. In Node, we use a mock window.
// Strategy: check that the output of marked does NOT contain executable <script> tags
// after DOMPurify sanitization. We simulate with string analysis since we're in Node.

await test("marked.parse: raw script HTML remains present before sanitization", () => {
  const xssPayload = `# Title\n\n<script>alert(1)<\/script>\n\nNormal text.`;
  // marked.parse is the top-level function in marked v9 CJS
  const parseFn = markedLib.parse || (markedLib.marked && markedLib.marked.parse);
  assert.ok(typeof parseFn === "function", `marked.parse should be a function. Got: ${typeof parseFn}`);
  const html = parseFn(xssPayload, { gfm: true });
  assert.ok(typeof html === "string", "Should return a string");
  assert.ok(html.includes("Normal text"), `Should contain normal text. Got: ${html}`);
  assert.ok(html.includes("<script>alert(1)</script>"), `Marked should pass raw script HTML through. Got: ${html}`);
  // DOMPurify removes <script> in browser renderer.
  console.log(`    [info] marked raw output for script payload: ${html.replace(/\n/g, "\\n").slice(0, 120)}`);
});

await test("marked.parse: javascript href remains present before sanitization", () => {
  const payload = `[Click me](javascript:alert(1))`;
  const parseFn = markedLib.parse || (markedLib.marked && markedLib.marked.parse);
  const html = parseFn(payload, { gfm: true });
  assert.ok(typeof html === "string");
  assert.ok(html.includes('href="javascript:alert(1)"'), `Marked should pass javascript href through. Got: ${html}`);
  console.log(`    [info] marked output for href payload: ${html.replace(/\n/g, "\\n")}`);
});

await test("marked.parse: img onerror remains present before sanitization", () => {
  const payload = `<img src="x" onerror="alert(1)">`;
  const parseFn = markedLib.parse || (markedLib.marked && markedLib.marked.parse);
  const html = parseFn(payload, { gfm: true });
  assert.ok(typeof html === "string");
  assert.ok(html.includes('onerror="alert(1)"'), `Marked should keep raw onerror attribute. Got: ${html}`);
  console.log(`    [info] marked output for img onerror: ${html.replace(/\n/g, "\\n")}`);
});

// ============================================================
// Section: git log parsing (workspace-reader integration)
// ============================================================

console.log("\n=== git log: terminal_app repo (integration) ===\n");

await test("getCardData: reads terminal_app repo correctly", async () => {
  const repoPath = "/Users/davidhan/claude_workspace/terminal_app";
  const result = await getCardData(repoPath);
  assert.ok(!("error" in result), `Unexpected error: ${JSON.stringify(result)}`);
  assert.equal(result.notAGitRepo, false, "terminal_app should be a git repo");
  assert.ok(Array.isArray(result.gitLog), "gitLog should be an array");
  assert.ok(result.gitLog.length >= 1, `Should have at least 1 git entry. Got: ${result.gitLog.length}`);
  const entry = result.gitLog[0];
  assert.ok(typeof entry.hash === "string" && entry.hash.length > 0, "hash should be non-empty string");
  assert.ok(typeof entry.msg === "string", "msg should be string");
  assert.ok(typeof entry.relTime === "string" && entry.relTime.length > 0, "relTime should be non-empty");
  console.log(`    [info] first git entry: ${entry.hash} | ${entry.msg} | ${entry.relTime}`);
});

await test("getCardData: reads CLAUDE.md from terminal_app", async () => {
  const repoPath = "/Users/davidhan/claude_workspace/terminal_app";
  const result = await getCardData(repoPath);
  assert.ok(!("error" in result));
  assert.ok(result.claude !== null, "CLAUDE.md should exist");
  assert.ok(result.claude.includes("HyperTerm"), `Should contain HyperTerm. Got: ${result.claude?.slice(0, 100)}`);
});

// ============================================================
// Summary
// ============================================================

// Wait a tick to let all async tests resolve
await new Promise((r) => setTimeout(r, 100));

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

if (failed > 0) process.exit(1);
