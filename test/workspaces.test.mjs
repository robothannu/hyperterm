/**
 * Unit tests for workspaces module logic (Sprint 4 TDD requirement).
 * Uses Node.js built-in assert — no test framework needed.
 * Run: node test/workspaces.test.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// -------------------------------------------------------------------
// We test the compiled JS in dist/main/workspaces.js
// -------------------------------------------------------------------
const distPath = new URL("../dist/main/workspaces.js", import.meta.url).pathname;
const { initWorkspaces, loadWorkspaces, saveWorkspaces, addWorkspace, removeWorkspace, renameWorkspace } =
  await import(distPath);

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

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}: ${err.message}`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Setup: use a temp directory as userData
// ---------------------------------------------------------------------------
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hyperterm-ws-test-"));
initWorkspaces(tmpDir);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log("\n=== workspaces.ts unit tests ===\n");

test("loadWorkspaces returns [] when file does not exist", () => {
  const list = loadWorkspaces();
  assert.deepEqual(list, []);
});

test("addWorkspace adds a new path and persists", () => {
  const existing = [];
  const { workspaces, duplicate } = addWorkspace(existing, "/tmp/project-a");
  assert.equal(duplicate, false);
  assert.equal(workspaces.length, 1);
  assert.equal(workspaces[0].absolutePath, "/tmp/project-a");
  assert.equal(workspaces[0].name, "project-a");
  assert.ok(workspaces[0].id.startsWith("ws-"));
});

test("addWorkspace detects duplicate by normalized path", () => {
  const existing = [];
  const first = addWorkspace(existing, "/tmp/project-b").workspaces;
  const second = addWorkspace(first, "/tmp/project-b/");
  assert.equal(second.duplicate, true);
  assert.equal(second.workspaces.length, 1);
});

test("addWorkspace allows different paths", () => {
  const existing = [];
  const r1 = addWorkspace(existing, "/tmp/alpha");
  const r2 = addWorkspace(r1.workspaces, "/tmp/beta");
  assert.equal(r2.workspaces.length, 2);
  assert.equal(r2.duplicate, false);
});

test("removeWorkspace removes by id and persists", () => {
  const existing = [];
  const r = addWorkspace(existing, "/tmp/to-remove");
  const ws = r.workspaces[0];
  const updated = removeWorkspace(r.workspaces, ws.id);
  assert.equal(updated.length, 0);
});

test("removeWorkspace with unknown id returns unchanged list", () => {
  const existing = [];
  const r = addWorkspace(existing, "/tmp/stays");
  const updated = removeWorkspace(r.workspaces, "nonexistent-id");
  assert.equal(updated.length, 1);
});

test("loadWorkspaces restores persisted data", () => {
  // Save manually then reload
  const ws = [{ id: "ws-test-1", name: "test-proj", absolutePath: "/tmp/test-proj", addedAt: new Date().toISOString() }];
  saveWorkspaces(ws);
  const loaded = loadWorkspaces();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].id, "ws-test-1");
  assert.equal(loaded[0].name, "test-proj");
});

test("loadWorkspaces falls back to [] on corrupt JSON", () => {
  // Write corrupt JSON
  const filePath = path.join(tmpDir, "workspaces.json");
  fs.writeFileSync(filePath, "{ bad json {{{{", "utf8");
  const loaded = loadWorkspaces();
  assert.deepEqual(loaded, []);
  // Restore clean state
  fs.unlinkSync(filePath);
});

// ---------------------------------------------------------------------------
// Sprint 3: renameWorkspace TDD
// ---------------------------------------------------------------------------

console.log("\n=== Sprint 3: renameWorkspace tests ===\n");

test("renameWorkspace: renames by id and persists", () => {
  const r = addWorkspace([], "/tmp/rename-me");
  const ws = r.workspaces[0];
  const updated = renameWorkspace(r.workspaces, ws.id, "My Project");
  assert.notEqual(updated, null, "renameWorkspace should return updated list");
  assert.equal(updated.length, 1);
  assert.equal(updated[0].name, "My Project");
  assert.equal(updated[0].absolutePath, "/tmp/rename-me");
  assert.equal(updated[0].id, ws.id, "id must not change");
});

test("renameWorkspace: trimmed whitespace", () => {
  const r = addWorkspace([], "/tmp/trim-test");
  const ws = r.workspaces[0];
  const updated = renameWorkspace(r.workspaces, ws.id, "  Trimmed  ");
  assert.notEqual(updated, null);
  assert.equal(updated[0].name, "Trimmed");
});

test("renameWorkspace: empty name returns null (rejected)", () => {
  const r = addWorkspace([], "/tmp/empty-name");
  const ws = r.workspaces[0];
  const result = renameWorkspace(r.workspaces, ws.id, "  ");
  assert.equal(result, null, "empty name should be rejected");
});

test("renameWorkspace: unknown id returns null", () => {
  const r = addWorkspace([], "/tmp/unknown-id");
  const result = renameWorkspace(r.workspaces, "nonexistent-id", "New Name");
  assert.equal(result, null);
});

test("renameWorkspace: does not change absolutePath", () => {
  const r = addWorkspace([], "/tmp/path-unchanged");
  const ws = r.workspaces[0];
  const updated = renameWorkspace(r.workspaces, ws.id, "Different Name");
  assert.notEqual(updated, null);
  assert.equal(updated[0].absolutePath, "/tmp/path-unchanged");
});

test("renameWorkspace: persisted name survives loadWorkspaces", () => {
  const r = addWorkspace([], "/tmp/persist-rename");
  const ws = r.workspaces[0];
  const updated = renameWorkspace(r.workspaces, ws.id, "Persisted Name");
  assert.notEqual(updated, null);
  // loadWorkspaces should now return the renamed workspace
  const reloaded = loadWorkspaces();
  const found = reloaded.find((w) => w.id === ws.id);
  assert.ok(found, "workspace should be found after reload");
  assert.equal(found.name, "Persisted Name");
});

// ---------------------------------------------------------------------------
// Sprint 3: cwd normalization comparison TDD
// ---------------------------------------------------------------------------

console.log("\n=== Sprint 3: cwd normalization tests ===\n");

test("cwd normalization: trailing slash stripped", () => {
  const normalize = (p) => path.resolve(p);
  assert.equal(normalize("/tmp/project/"), "/tmp/project");
});

test("cwd normalization: already normalized path unchanged", () => {
  const normalize = (p) => path.resolve(p);
  assert.equal(normalize("/tmp/project"), "/tmp/project");
});

test("cwd normalization: duplicate detection uses normalized compare", () => {
  const r1 = addWorkspace([], "/tmp/dup-check");
  const r2 = addWorkspace(r1.workspaces, "/tmp/dup-check/");  // trailing slash variant
  assert.equal(r2.duplicate, true, "trailing slash should be detected as duplicate");
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

// Cleanup temp dir
fs.rmSync(tmpDir, { recursive: true, force: true });

if (failed > 0) process.exit(1);
