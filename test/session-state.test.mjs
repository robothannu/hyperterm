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

const require = createRequire(import.meta.url);
const distPath = new URL("../dist/main/session-state.js", import.meta.url).pathname;
const mod = require(distPath);

const { isActiveHarnessPhase, isPathInsideWorkspace, isWorkspaceOpenFromCwds } = mod;
assert.equal(typeof isActiveHarnessPhase, "function", "isActiveHarnessPhase must be exported");
assert.equal(typeof isPathInsideWorkspace, "function", "isPathInsideWorkspace must be exported");
assert.equal(typeof isWorkspaceOpenFromCwds, "function", "isWorkspaceOpenFromCwds must be exported");

console.log("\n=== isActiveHarnessPhase ===\n");

test("planning is not active", () => {
  assert.equal(isActiveHarnessPhase("planning"), false);
});

test("building is active", () => {
  assert.equal(isActiveHarnessPhase("building"), true);
});

test("evaluating is active", () => {
  assert.equal(isActiveHarnessPhase("evaluating"), true);
});

test("complete is not active", () => {
  assert.equal(isActiveHarnessPhase("complete"), false);
});

test("null is not active", () => {
  assert.equal(isActiveHarnessPhase(null), false);
});

console.log("\n=== workspace open path matching ===\n");

test("workspace root cwd is open", () => {
  assert.equal(isWorkspaceOpenFromCwds(["/Users/demo/project"], "/Users/demo/project"), true);
});

test("workspace descendant cwd is open", () => {
  assert.equal(isWorkspaceOpenFromCwds(["/Users/demo/project/src/app"], "/Users/demo/project"), true);
});

test("sibling prefix cwd is not open", () => {
  assert.equal(isWorkspaceOpenFromCwds(["/Users/demo/project-other"], "/Users/demo/project"), false);
});

test("path helper matches root and descendant only", () => {
  assert.equal(isPathInsideWorkspace("/Users/demo/project", "/Users/demo/project"), true);
  assert.equal(isPathInsideWorkspace("/Users/demo/project/packages/ui", "/Users/demo/project"), true);
  assert.equal(isPathInsideWorkspace("/Users/demo/project2", "/Users/demo/project"), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
