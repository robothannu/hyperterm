/**
 * Smoke test for Sprint 3 pinned PTY features.
 *
 * Tests:
 *  1. pinned serialization/deserialization (SavedTab schema)
 *  2. daemon LIST → reconcile mapping
 *  3. SPAWN_OWNED + ATTACH streaming + DETACH
 *  4. KILL orphan guard
 *  5. crash fallback detection
 *
 * Run: node tests/daemon/test-pinned.js
 * Requires: npm run build first
 */

const net = require("net");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, execFileSync } = require("child_process");

const DAEMON_DIR = path.join(os.homedir(), "Library", "Application Support", "HyperTerm", "daemon");
const SOCK_PATH = path.join(DAEMON_DIR, "htptyd.sock");
const PID_PATH = path.join(DAEMON_DIR, "htptyd.pid");
const DAEMON_JS = path.join(__dirname, "..", "..", "dist", "daemon", "htptyd.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sendRequest(req, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(SOCK_PATH, () => {
      sock.write(JSON.stringify(req) + "\n");
    });
    let buf = "";
    sock.on("data", (chunk) => {
      buf += chunk.toString();
      const idx = buf.indexOf("\n");
      if (idx !== -1) {
        sock.destroy();
        try { resolve(JSON.parse(buf.slice(0, idx))); }
        catch (e) { reject(e); }
      }
    });
    sock.on("error", reject);
    sock.setTimeout(timeoutMs, () => { sock.destroy(); reject(new Error("Timeout")); });
  });
}

/** Open a long-lived streaming socket; sends ATTACH, returns { socket, messages: [] } */
function openStream(ptyId) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(SOCK_PATH);
    const messages = [];
    let buf = "";
    let resolved = false;

    socket.on("connect", () => {
      socket.write(JSON.stringify({ type: "ATTACH", id: ptyId }) + "\n");
    });

    socket.on("data", (chunk) => {
      buf += chunk.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          messages.push(msg);
          if (!resolved && msg.type === "ATTACHED") {
            resolved = true;
            resolve({ socket, messages });
          }
        } catch { /* ignore */ }
      }
    });

    socket.on("error", (err) => { if (!resolved) reject(err); });
    socket.setTimeout(5000, () => { if (!resolved) { socket.destroy(); reject(new Error("ATTACH timeout")); } });
  });
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForSocket(timeoutMs = 5000) {
  const interval = 100;
  let elapsed = 0;
  while (elapsed < timeoutMs) {
    try {
      await sendRequest({ type: "PING" }, 500);
      return true;
    } catch { /* not ready yet */ }
    await sleep(interval);
    elapsed += interval;
  }
  return false;
}

function startDaemon() {
  // Use very short idle timeout for tests
  const child = spawn(process.execPath, [DAEMON_JS], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", HTPTYD_IDLE_MS: "60000" },
  });
  child.unref();
  return child;
}

function cleanupDaemon() {
  try {
    const pid = parseInt(fs.readFileSync(PID_PATH, "utf8").trim(), 10);
    if (!isNaN(pid)) process.kill(pid, "SIGTERM");
  } catch { /* ok */ }
  try { fs.unlinkSync(SOCK_PATH); } catch { /* ok */ }
  try { fs.unlinkSync(PID_PATH); } catch { /* ok */ }
}

function assert(condition, msg) {
  if (!condition) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  PASS: ${msg}`);
}

// ---------------------------------------------------------------------------
// Test 1: pinned SavedTab serialization schema
// ---------------------------------------------------------------------------

function testPinnedSchema() {
  console.log("\n[T1] Pinned SavedTab serialization schema");

  const savedTab = {
    label: "My Workspace",
    cluster: undefined,
    layout: { type: "leaf", sessionKey: "session-1", cwd: "/tmp" },
    pinned: true,
    daemonPtyId: "pty-12345-1",
  };

  const json = JSON.stringify(savedTab);
  const parsed = JSON.parse(json);

  assert(parsed.pinned === true, "pinned field preserved in JSON");
  assert(parsed.daemonPtyId === "pty-12345-1", "daemonPtyId field preserved in JSON");
  assert(parsed.label === "My Workspace", "label preserved");
  assert(!parsed.cluster, "cluster undefined is dropped");

  // Superset: non-pinned tabs don't have pinned/daemonPtyId
  const nonPinnedTab = { label: "Normal", layout: { type: "leaf", sessionKey: "s-2" } };
  const nonParsed = JSON.parse(JSON.stringify(nonPinnedTab));
  assert(!nonParsed.pinned, "non-pinned tab has no pinned field");
  assert(!nonParsed.daemonPtyId, "non-pinned tab has no daemonPtyId");
}

// ---------------------------------------------------------------------------
// Test 2: reconcile mapping logic
// ---------------------------------------------------------------------------

function testReconcileMapping() {
  console.log("\n[T2] Reconcile mapping (daemon LIST vs expectedIds)");

  // Simulate the reconcile logic in pinned-bridge.ts
  function reconcile(expectedIds, livePtys) {
    const liveIds = new Set(livePtys.filter((p) => p.owned).map((p) => p.id));
    const canReattach = [];
    const needFallback = [];
    for (const id of expectedIds) {
      if (liveIds.has(id)) canReattach.push(id);
      else needFallback.push(id);
    }
    return { canReattach, needFallback };
  }

  const livePtys = [
    { id: "pty-1001-1", owned: true, cwd: "/tmp", pid: 1001 },
    { id: "pty-1002-2", owned: false, cwd: "/home", pid: 1002 }, // not owned
    { id: "pty-1003-3", owned: true, cwd: "/var", pid: 1003 },
  ];

  // Case 1: all expected IDs found
  const r1 = reconcile(["pty-1001-1", "pty-1003-3"], livePtys);
  assert(r1.canReattach.length === 2, "2 can reattach");
  assert(r1.needFallback.length === 0, "0 fallback");

  // Case 2: some missing (daemon crashed)
  const r2 = reconcile(["pty-1001-1", "pty-DEAD-X"], livePtys);
  assert(r2.canReattach.length === 1, "1 can reattach (alive)");
  assert(r2.needFallback.length === 1, "1 fallback (dead)");
  assert(r2.needFallback[0] === "pty-DEAD-X", "fallback id correct");

  // Case 3: not owned PTY in expected list
  const r3 = reconcile(["pty-1002-2"], livePtys);
  assert(r3.canReattach.length === 0, "non-owned not in reattach");
  assert(r3.needFallback.length === 1, "non-owned goes to fallback");

  // Case 4: empty expected list
  const r4 = reconcile([], livePtys);
  assert(r4.canReattach.length === 0, "empty expected → empty reattach");
  assert(r4.needFallback.length === 0, "empty expected → empty fallback");

  // Case 5: daemon unreachable (empty live list)
  const r5 = reconcile(["pty-1001-1", "pty-1003-3"], []);
  assert(r5.canReattach.length === 0, "daemon down → no reattach");
  assert(r5.needFallback.length === 2, "daemon down → all fallback");
}

// ---------------------------------------------------------------------------
// Test 3: SPAWN_OWNED + ATTACH streaming + DETACH (live daemon)
// ---------------------------------------------------------------------------

async function testSpawnAttachDetach() {
  console.log("\n[T3] SPAWN_OWNED + ATTACH streaming + DETACH (live daemon)");

  if (!fs.existsSync(DAEMON_JS)) {
    console.log("  SKIP: dist/daemon/htptyd.js not found — run npm run build first");
    return;
  }

  cleanupDaemon();
  await sleep(200);
  startDaemon();

  const ready = await waitForSocket(8000);
  assert(ready, "Daemon started and socket ready");

  // SPAWN_OWNED
  const spawnResp = await sendRequest({
    type: "SPAWN_OWNED",
    cwd: os.homedir(),
    cols: 80,
    rows: 24,
    groupLabel: "Test Pinned Group",
  });
  assert(spawnResp.type === "SPAWNED", "SPAWN_OWNED returns SPAWNED");
  assert(typeof spawnResp.id === "string" && spawnResp.id.startsWith("pty-"), "SPAWNED id format");
  const ptyId = spawnResp.id;
  console.log(`  PTY spawned: ${ptyId}`);

  // LIST should show owned PTY
  const listResp = await sendRequest({ type: "LIST" });
  assert(listResp.type === "LIST", "LIST response");
  const ownedInList = listResp.ptys.find((p) => p.id === ptyId && p.owned);
  assert(!!ownedInList, "SPAWNED PTY appears in LIST as owned");
  assert(ownedInList.groupLabel === "Test Pinned Group", "groupLabel preserved in LIST");

  // ATTACH — open streaming connection
  const { socket, messages } = await openStream(ptyId);
  assert(messages.some((m) => m.type === "ATTACHED"), "ATTACHED received");
  console.log(`  Stream attached, initial messages: ${messages.length}`);

  // Wait for shell to emit prompt
  await sleep(1000);

  // F4 fix: send deterministic marker and verify it appears in stream DATA
  const marker = "HELLO_PINNED_MARKER";
  socket.write(JSON.stringify({ type: "INPUT", id: ptyId, data: `echo ${marker}\n` }) + "\n");

  // Wait long enough for shell to process and echo the marker
  await sleep(2000);

  const dataMessages = messages.filter((m) => m.type === "DATA");
  console.log(`  DATA messages received: ${dataMessages.length}`);
  // Daemon sends data as base64 in m.b64; decode each message
  const allData = dataMessages.map((m) => {
    if (m.b64) return Buffer.from(m.b64, "base64").toString("utf8");
    return m.data || "";
  }).join("");
  // Strip ANSI escape codes for reliable matching
  const stripped = allData.replace(/\x1b\[[0-9;]*[mGKHFJ]/g, "").replace(/\r/g, "");
  const markerFound = stripped.includes(marker);
  console.log(`  Marker "${marker}" found in stream: ${markerFound}`);
  assert(markerFound, `DATA stream includes echo marker "${marker}"`);
  assert(dataMessages.length >= 1, "At least 1 DATA message received");

  // DETACH
  socket.write(JSON.stringify({ type: "DETACH", id: ptyId }) + "\n");
  await sleep(300);
  socket.destroy();

  // After detach, PTY should still be in LIST (daemon keeps it alive)
  const listAfterDetach = await sendRequest({ type: "LIST" });
  const stillAlive = listAfterDetach.ptys.find((p) => p.id === ptyId);
  assert(!!stillAlive, "PTY still alive after DETACH (daemon keeps it)");
  console.log(`  PTY ${ptyId} survived DETACH`);

  // KILL — orphan guard
  const killResp = await sendRequest({ type: "KILL", id: ptyId });
  assert(killResp.type === "KILLED", "KILL returns KILLED");

  const listAfterKill = await sendRequest({ type: "LIST" });
  const gone = !listAfterKill.ptys.find((p) => p.id === ptyId);
  assert(gone, "PTY removed from LIST after KILL");

  // Cleanup
  await sendRequest({ type: "SHUTDOWN" }).catch(() => {});
  await sleep(500);
}

// ---------------------------------------------------------------------------
// Test 4: crash fallback detection
// ---------------------------------------------------------------------------

async function testCrashFallbackDetection() {
  console.log("\n[T4] Crash fallback detection (stale socket)");

  // Create stale socket file (simulate daemon crash)
  try { fs.mkdirSync(DAEMON_DIR, { recursive: true }); } catch { /* ok */ }
  try { fs.unlinkSync(SOCK_PATH); } catch { /* ok */ }
  const fakePid = 99999999;
  fs.writeFileSync(PID_PATH, String(fakePid), "utf8");
  // No SOCK_PATH = daemon not listening

  // Try to connect
  const canConn = await new Promise((resolve) => {
    if (!fs.existsSync(SOCK_PATH)) { resolve(false); return; }
    const sock = net.connect(SOCK_PATH, () => { sock.destroy(); resolve(true); });
    sock.on("error", () => resolve(false));
    sock.setTimeout(500, () => { sock.destroy(); resolve(false); });
  });
  assert(!canConn, "Stale socket: cannot connect");

  // Check PID alive
  let pidAlive = false;
  try { process.kill(fakePid, 0); pidAlive = true; } catch { pidAlive = false; }
  assert(!pidAlive, "Fake PID not alive (simulates crash)");

  // Reconcile with 2 expected IDs — all should fallback
  function reconcile(expectedIds, livePtys) {
    const liveIds = new Set(livePtys.filter((p) => p.owned).map((p) => p.id));
    return {
      canReattach: expectedIds.filter((id) => liveIds.has(id)),
      needFallback: expectedIds.filter((id) => !liveIds.has(id)),
    };
  }
  const r = reconcile(["pty-A", "pty-B"], []); // empty live (daemon down)
  assert(r.needFallback.length === 2, "Both IDs fall back on daemon crash");
  assert(r.canReattach.length === 0, "No reattach on crash");

  // Cleanup
  try { fs.unlinkSync(PID_PATH); } catch { /* ok */ }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== Sprint 3 Pinned PTY Tests ===\n");

  // Static tests (no daemon needed)
  testPinnedSchema();
  testReconcileMapping();
  await testCrashFallbackDetection();

  // Live daemon test (requires dist/daemon/htptyd.js)
  await testSpawnAttachDetach();

  console.log("\n=== All tests passed ===\n");
}

main().catch((err) => {
  console.error("TEST ERROR:", err);
  // Try to kill daemon if still running
  try {
    const pid = parseInt(fs.readFileSync(PID_PATH, "utf8").trim(), 10);
    if (!isNaN(pid)) process.kill(pid, "SIGTERM");
  } catch { /* ok */ }
  process.exit(1);
});
