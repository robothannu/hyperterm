/**
 * Unit tests for dashboard status helpers.
 *   - classifyGroup: active / archived definitions
 *   - parseGitRelTimeMs: relative git age parsing
 *
 * Run: npm run build && node test/dashboard-status.test.mjs
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}: ${err.message}`);
    failed++;
  }
}

globalThis.module = { exports: {} };
globalThis.exports = globalThis.module.exports;

const distPath = new URL("../dist/renderer/dashboard.js", import.meta.url).pathname;
const require = createRequire(import.meta.url);
const mod = require(distPath);

const { classifyGroup, parseGitRelTimeMs } = mod;
assert.equal(typeof classifyGroup, "function", "classifyGroup must be exported");
assert.equal(typeof parseGitRelTimeMs, "function", "parseGitRelTimeMs must be exported");

console.log("\n=== parseGitRelTimeMs ===\n");

test("parses common relative time strings", () => {
  assert.equal(parseGitRelTimeMs("3 seconds ago"), 3000);
  assert.equal(parseGitRelTimeMs("2 minutes ago"), 120000);
  assert.equal(parseGitRelTimeMs("4 hours ago"), 14400000);
  assert.equal(parseGitRelTimeMs("5 days ago"), 432000000);
});

test("returns null for unparseable strings", () => {
  assert.equal(parseGitRelTimeMs("yesterday"), null);
  assert.equal(parseGitRelTimeMs(""), null);
});

console.log("\n=== classifyGroup ===\n");

const baseWs = (overrides = {}) => ({
  id: "ws-1",
  name: "demo",
  absolutePath: "/Users/demo/work/demo",
  addedAt: "2026-01-01T00:00:00.000Z",
  archived: false,
  tags: [],
  ...overrides,
});

test("archived flag wins", () => {
  const ws = baseWs({ archived: true });
  assert.equal(classifyGroup(ws, false, false, false, 0, null), "archived");
});

test("open session is active", () => {
  const ws = baseWs();
  assert.equal(classifyGroup(ws, true, false, false, 0, null), "active");
});

test("running harness is active", () => {
  const ws = baseWs();
  assert.equal(classifyGroup(ws, false, true, false, 0, null), "active");
});

test("recent git activity is active", () => {
  const ws = baseWs();
  assert.equal(classifyGroup(ws, false, false, false, 0, "3 days ago"), "active");
});

test("dirty workspace is active", () => {
  const ws = baseWs();
  assert.equal(classifyGroup(ws, false, false, true, 1, null), "active");
});

test("stale git activity is still active unless manually archived", () => {
  const ws = baseWs();
  assert.equal(classifyGroup(ws, false, false, false, 0, "2 months ago"), "active");
});

test("workspace without git activity is active unless manually archived", () => {
  const ws = baseWs({ addedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() });
  assert.equal(classifyGroup(ws, false, false, false, 0, null), "active");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
