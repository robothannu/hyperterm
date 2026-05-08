/**
 * Unit tests for command-palette pure helpers.
 *   - scoreFuzzy: subsequence scoring
 *   - scoreEntry: combines title/subtitle/badge fuzzy scores
 *   - filterEntries: ranking + scope filter
 *
 * Run: node test/command-palette.test.mjs
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

// command-palette.ts compiles to commonjs. Provide the shim and require.
globalThis.module = { exports: {} };
globalThis.exports = globalThis.module.exports;

const distPath = new URL("../dist/renderer/command-palette.js", import.meta.url).pathname;
const require = createRequire(import.meta.url);
const mod = require(distPath);

const { scoreFuzzy, scoreEntry, filterEntries, formatExplainPrompt, pathBasename } = mod;
assert.equal(typeof scoreFuzzy, "function", "scoreFuzzy must be exported");
assert.equal(typeof scoreEntry, "function", "scoreEntry must be exported");
assert.equal(typeof filterEntries, "function", "filterEntries must be exported");
assert.equal(typeof formatExplainPrompt, "function", "formatExplainPrompt must be exported");
assert.equal(typeof pathBasename, "function", "pathBasename must be exported");

console.log("\n=== scoreFuzzy ===\n");

test("empty query returns 0", () => {
  assert.equal(scoreFuzzy("", "anything"), 0);
});

test("empty target returns null when query is non-empty", () => {
  assert.equal(scoreFuzzy("a", ""), null);
});

test("non-matching characters return null", () => {
  assert.equal(scoreFuzzy("xyz", "abc"), null);
});

test("exact prefix match wins", () => {
  const exact = scoreFuzzy("abc", "abcdef");
  const middle = scoreFuzzy("abc", "xabcdef");
  assert.notEqual(exact, null);
  assert.notEqual(middle, null);
  assert.ok(exact > middle, `prefix(${exact}) should beat middle(${middle})`);
});

test("consecutive matches outscore scattered", () => {
  const consecutive = scoreFuzzy("abc", "Mabc");
  const scattered = scoreFuzzy("abc", "MaXbXc");
  assert.notEqual(consecutive, null);
  assert.notEqual(scattered, null);
  assert.ok(
    consecutive > scattered,
    `consecutive(${consecutive}) should beat scattered(${scattered})`
  );
});

test("word boundary bonus applies after separator", () => {
  const boundary = scoreFuzzy("p", "my-project");
  const middle = scoreFuzzy("p", "myproject");
  assert.notEqual(boundary, null);
  assert.notEqual(middle, null);
  assert.ok(boundary >= middle, `boundary(${boundary}) >= middle(${middle})`);
});

test("case-insensitive", () => {
  assert.notEqual(scoreFuzzy("ABC", "abcdef"), null);
  assert.notEqual(scoreFuzzy("abc", "ABCDEF"), null);
});

test("subsequence works for non-contiguous chars", () => {
  // "log" matches "Activity Log" (l...o.g)
  assert.notEqual(scoreFuzzy("log", "Activity Log"), null);
});

test("query longer than match is rejected", () => {
  assert.equal(scoreFuzzy("abcd", "abc"), null);
});

console.log("\n=== scoreEntry ===\n");

test("empty query returns 0 (everything matches)", () => {
  const s = scoreEntry("", { title: "anything" });
  assert.equal(s, 0);
});

test("title match outweighs subtitle match for same string", () => {
  const titleHit = scoreEntry("foo", { title: "foo bar", subtitle: "xxx" });
  const subHit = scoreEntry("foo", { title: "xxx", subtitle: "foo bar" });
  assert.notEqual(titleHit, null);
  assert.notEqual(subHit, null);
  assert.ok(titleHit > subHit, `title(${titleHit}) should beat subtitle(${subHit})`);
});

test("returns null when no field matches", () => {
  const s = scoreEntry("zzz", { title: "abc", subtitle: "def", badge: "Tab" });
  assert.equal(s, null);
});

test("badge match counts when title/subtitle miss", () => {
  const s = scoreEntry("tab", { title: "xxx", subtitle: "yyy", badge: "Tab" });
  assert.notEqual(s, null);
});

console.log("\n=== filterEntries ===\n");

const sample = [
  { id: "tab:1", source: "tab", title: "backend-api", subtitle: "cluster: api", badge: "Tab", exec: () => {} },
  { id: "tab:2", source: "tab", title: "frontend-ui", subtitle: "cluster: web", badge: "Tab", exec: () => {} },
  { id: "ws:1", source: "workspace", title: "claude-app", subtitle: "/Users/u/claude-app", badge: "Claude", exec: () => {} },
  { id: "ws:2", source: "workspace", title: "ocr_app_ios", subtitle: "/Users/u/ocr_app_ios", badge: "Mixed", exec: () => {} },
  { id: "act:new", source: "action", title: "New Group", subtitle: "Cmd+N", badge: "Action", exec: () => {} },
];

test("empty query returns all in stable type order (tab → workspace → action)", () => {
  const out = filterEntries(sample, "", "all");
  assert.equal(out.length, 5);
  const sources = out.map((e) => e.source);
  // tabs first, then workspaces, then actions
  let seenWs = false, seenAct = false;
  for (const s of sources) {
    if (s === "workspace") seenWs = true;
    if (s === "action") seenAct = true;
    if (s === "tab") assert.ok(!seenWs && !seenAct, "tabs must come before ws/action");
    if (s === "workspace") assert.ok(!seenAct, "workspaces must come before actions");
  }
});

test("scope filter narrows to one source", () => {
  const tabsOnly = filterEntries(sample, "", "tab");
  assert.equal(tabsOnly.length, 2);
  assert.ok(tabsOnly.every((e) => e.source === "tab"));
  const wsOnly = filterEntries(sample, "", "workspace");
  assert.equal(wsOnly.length, 2);
  assert.ok(wsOnly.every((e) => e.source === "workspace"));
});

test("query ranks best match first", () => {
  const out = filterEntries(sample, "back", "all");
  assert.ok(out.length >= 1);
  assert.equal(out[0].id, "tab:1", `expected tab:1 first, got ${out[0].id}`);
});

test("query filters out non-matching entries", () => {
  const out = filterEntries(sample, "ocr", "all");
  assert.ok(out.some((e) => e.id === "ws:2"));
  // tabs without "ocr" subsequence should be filtered out
  assert.ok(!out.some((e) => e.id === "tab:1"));
});

test("query 'new' finds the action", () => {
  const out = filterEntries(sample, "new", "all");
  assert.ok(out.some((e) => e.id === "act:new"));
});

test("scope filter combined with query", () => {
  const out = filterEntries(sample, "a", "workspace");
  assert.ok(out.length >= 1);
  assert.ok(out.every((e) => e.source === "workspace"));
});

console.log("\n=== formatExplainPrompt ===\n");

test("returns null on empty string", () => {
  assert.equal(formatExplainPrompt(""), null);
});

test("returns null on whitespace-only string", () => {
  assert.equal(formatExplainPrompt("   \n\t  "), null);
});

test("returns null on null/undefined", () => {
  assert.equal(formatExplainPrompt(null), null);
  assert.equal(formatExplainPrompt(undefined), null);
});

test("wraps non-empty selection with korean instruction prefix", () => {
  const out = formatExplainPrompt("Error: file not found");
  assert.ok(typeof out === "string");
  assert.ok(out.includes("Error: file not found"));
  assert.ok(out.includes("분석") || out.includes("설명"));
});

test("trims selection before wrapping", () => {
  const out = formatExplainPrompt("   hello   ");
  assert.ok(out.includes("hello"));
  assert.ok(!out.includes("   hello   "));
});

test("preserves multi-line selection content", () => {
  const sel = "line1\nline2\nline3";
  const out = formatExplainPrompt(sel);
  assert.ok(out.includes(sel));
});

console.log("\n=== pathBasename ===\n");

test("returns last segment of /a/b/c", () => {
  assert.equal(pathBasename("/a/b/c"), "c");
});

test("strips trailing slash", () => {
  assert.equal(pathBasename("/a/b/c/"), "c");
});

test("strips multiple trailing slashes", () => {
  assert.equal(pathBasename("/a/b/c///"), "c");
});

test("returns input when no separator", () => {
  assert.equal(pathBasename("foo"), "foo");
});

test("returns empty for empty input", () => {
  assert.equal(pathBasename(""), "");
});

test("handles all-slash input by returning input", () => {
  assert.equal(pathBasename("///"), "///");
});

test("handles windows-style backslash separator", () => {
  assert.equal(pathBasename("C:\\Users\\me\\proj"), "proj");
});

test("returns last segment for nested path", () => {
  assert.equal(pathBasename("/Users/davidhan/claude_workspace/terminal_app"), "terminal_app");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
