/**
 * Unit tests for workflows module — pure CRUD + validation.
 * Run: node test/workflows.test.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const distPath = new URL("../dist/main/workflows.js", import.meta.url).pathname;
const {
  initWorkflows,
  loadWorkflows,
  saveWorkflows,
  addWorkflow,
  removeWorkflow,
  findWorkflow,
  makeWorkflow,
  _setWorkflowsPathForTesting,
} = await import(distPath);

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

// ----------------------------------------------------------------
// makeWorkflow validation
// ----------------------------------------------------------------

console.log("\n=== makeWorkflow validation ===\n");

test("rejects empty label", () => {
  const r = makeWorkflow({ label: "  ", command: "ls" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "label_empty");
});

test("rejects empty command", () => {
  const r = makeWorkflow({ label: "ls", command: " " });
  assert.equal(r.ok, false);
  assert.equal(r.error, "command_empty");
});

test("rejects label longer than 80 chars", () => {
  const r = makeWorkflow({ label: "x".repeat(81), command: "ls" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "label_too_long");
});

test("rejects relative cwd", () => {
  const r = makeWorkflow({ label: "ls", command: "ls", cwd: "rel/path" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "cwd_must_be_absolute");
});

test("accepts valid input and trims", () => {
  const r = makeWorkflow({ label: "  Run tests  ", command: "  npm test  " });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.workflow.label, "Run tests");
  assert.equal(r.workflow.command, "npm test");
  assert.equal(r.workflow.cwd, undefined);
  assert.ok(r.workflow.id.startsWith("wf-"), "id should start with wf-");
  assert.ok(typeof r.workflow.createdAt === "string");
});

test("accepts absolute cwd", () => {
  const r = makeWorkflow({ label: "ls", command: "ls", cwd: "/tmp" });
  assert.equal(r.ok, true);
  assert.equal(r.workflow.cwd, "/tmp");
});

test("treats empty cwd string as undefined", () => {
  const r = makeWorkflow({ label: "ls", command: "ls", cwd: "  " });
  assert.equal(r.ok, true);
  assert.equal(r.workflow.cwd, undefined);
});

// ----------------------------------------------------------------
// addWorkflow / removeWorkflow / findWorkflow
// ----------------------------------------------------------------

console.log("\n=== add / remove / find ===\n");

const sample = (overrides = {}) => ({
  id: "wf-static-1",
  label: "Run tests",
  command: "npm test",
  cwd: undefined,
  createdAt: "2026-05-08T00:00:00.000Z",
  ...overrides,
});

test("addWorkflow appends to empty list", () => {
  const wf = sample();
  const r = addWorkflow([], wf);
  assert.equal(r.duplicate, false);
  assert.equal(r.workflows.length, 1);
  assert.equal(r.workflows[0].id, wf.id);
});

test("addWorkflow detects exact duplicate (label+command+cwd)", () => {
  const wf = sample();
  const list = [wf];
  const r = addWorkflow(list, sample({ id: "wf-different-id" }));
  assert.equal(r.duplicate, true);
  assert.equal(r.workflows.length, 1, "duplicate should not append");
});

test("addWorkflow allows same label with different cwd", () => {
  const wf1 = sample({ id: "a", cwd: "/tmp" });
  const wf2 = sample({ id: "b", cwd: "/var" });
  const r = addWorkflow([wf1], wf2);
  assert.equal(r.duplicate, false);
  assert.equal(r.workflows.length, 2);
});

test("removeWorkflow filters by id", () => {
  const a = sample({ id: "a" });
  const b = sample({ id: "b" });
  const next = removeWorkflow([a, b], "a");
  assert.equal(next.length, 1);
  assert.equal(next[0].id, "b");
});

test("removeWorkflow no-op for missing id", () => {
  const a = sample({ id: "a" });
  const next = removeWorkflow([a], "missing");
  assert.equal(next.length, 1);
});

test("findWorkflow returns the entry", () => {
  const a = sample({ id: "a" });
  const b = sample({ id: "b", label: "other" });
  assert.equal(findWorkflow([a, b], "b").label, "other");
  assert.equal(findWorkflow([a, b], "missing"), undefined);
});

// ----------------------------------------------------------------
// Persistence: load / save round-trip
// ----------------------------------------------------------------

console.log("\n=== persistence ===\n");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hyperterm-wf-test-"));
const tmpFile = path.join(tmpDir, "workflows.json");
_setWorkflowsPathForTesting(tmpFile);

await testAsync("load returns [] when file missing", () => {
  if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  assert.deepEqual(loadWorkflows(), []);
});

await testAsync("save then load round-trips", () => {
  const a = sample({ id: "wf-1", label: "build" });
  const b = sample({ id: "wf-2", label: "test", cwd: "/tmp" });
  saveWorkflows([a, b]);
  const loaded = loadWorkflows();
  assert.equal(loaded.length, 2);
  assert.equal(loaded[0].id, "wf-1");
  assert.equal(loaded[1].cwd, "/tmp");
});

await testAsync("load handles corrupt JSON by returning []", () => {
  fs.writeFileSync(tmpFile, "{not json}", "utf8");
  assert.deepEqual(loadWorkflows(), []);
});

await testAsync("load drops invalid entries silently", () => {
  fs.writeFileSync(
    tmpFile,
    JSON.stringify({
      version: 1,
      workflows: [
        sample({ id: "good" }),
        { id: "bad" /* missing required fields */ },
        sample({ id: "good2" }),
      ],
    }),
    "utf8"
  );
  const loaded = loadWorkflows();
  assert.equal(loaded.length, 2);
  assert.equal(loaded[0].id, "good");
  assert.equal(loaded[1].id, "good2");
});

// Cleanup
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
