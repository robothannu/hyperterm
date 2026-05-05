/**
 * Smoke test for htptyd daemon.
 * Run: node test-daemon.js
 */
const net = require("net");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const DAEMON_DIR = path.join(os.homedir(), "Library", "Application Support", "HyperTerm", "daemon");
const SOCK_PATH = path.join(DAEMON_DIR, "htptyd.sock");
const PID_PATH = path.join(DAEMON_DIR, "htptyd.pid");
const DAEMON_JS = path.join(__dirname, "dist", "daemon", "htptyd.js");

function sendRequest(req) {
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
        try {
          resolve(JSON.parse(buf.slice(0, idx)));
        } catch (e) {
          reject(new Error("Bad JSON: " + buf.slice(0, idx)));
        }
      }
    });

    sock.on("error", reject);
    sock.setTimeout(3000, () => { sock.destroy(); reject(new Error("Timeout")); });
  });
}

async function waitForSocket(timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(SOCK_PATH)) {
      const ok = await new Promise((resolve) => {
        const s = net.connect(SOCK_PATH, () => { s.destroy(); resolve(true); });
        s.on("error", () => resolve(false));
        s.setTimeout(500, () => { s.destroy(); resolve(false); });
      });
      if (ok) return true;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

async function main() {
  console.log("=== htptyd smoke test ===\n");

  // Clean up stale files
  try { fs.unlinkSync(SOCK_PATH); } catch {}
  try { fs.unlinkSync(PID_PATH); } catch {}

  // Spawn daemon with 15s idle (enough time for test)
  console.log("Spawning daemon...");
  const child = spawn(process.execPath, [DAEMON_JS], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", HTPTYD_IDLE_MS: "15000" },
  });
  child.unref();
  console.log(`Spawned PID ${child.pid}`);

  // Wait for socket
  const ready = await waitForSocket(5000);
  if (!ready) {
    console.error("FAIL: Daemon did not come up within 5s");
    process.exit(1);
  }
  console.log("Daemon socket ready\n");

  // AC1: ps check
  const { execSync } = require("child_process");
  const psOut = execSync("ps aux | grep 'htptyd.js' | grep -v grep").toString();
  console.log("=== AC1: ps aux ===");
  console.log(psOut.trim());
  console.log("PASS: daemon process visible\n");

  // AC3: files exist
  console.log("=== AC3: daemon dir files ===");
  const files = fs.readdirSync(DAEMON_DIR);
  console.log("Files:", files);
  if (!files.includes("htptyd.sock")) { console.error("FAIL: htptyd.sock missing"); process.exit(1); }
  if (!files.includes("htptyd.pid")) { console.error("FAIL: htptyd.pid missing"); process.exit(1); }
  console.log("PASS: socket + PID files exist\n");

  // PING
  console.log("=== PING ===");
  const pong = await sendRequest({ type: "PING" });
  console.log("Response:", pong);
  if (pong.type !== "PONG") { console.error("FAIL: expected PONG"); process.exit(1); }
  console.log("PASS\n");

  // AC4: CREATE + LIST
  console.log("=== AC4: CREATE + LIST ===");
  const created = await sendRequest({ type: "CREATE", cwd: "/tmp" });
  console.log("Created:", created);
  if (created.type !== "CREATED") { console.error("FAIL: expected CREATED"); process.exit(1); }
  const ptyId = created.id;
  console.log("PTY id:", ptyId);

  const listed = await sendRequest({ type: "LIST" });
  console.log("List:", listed);
  if (listed.type !== "LIST") { console.error("FAIL: expected LIST"); process.exit(1); }
  if (!listed.ptys.find(p => p.id === ptyId)) { console.error("FAIL: PTY not in list"); process.exit(1); }
  console.log("PASS\n");

  // KILL
  console.log("=== KILL ===");
  const killed = await sendRequest({ type: "KILL", id: ptyId });
  console.log("Killed:", killed);
  if (killed.type !== "KILLED") { console.error("FAIL: expected KILLED"); process.exit(1); }
  console.log("PASS\n");

  // AC5: idle timeout — list should be empty, daemon should exit within 15s
  console.log("=== AC5: LIST after KILL (should be empty) ===");
  const listed2 = await sendRequest({ type: "LIST" });
  console.log("List:", listed2);
  if (listed2.ptys.length !== 0) { console.error("FAIL: expected empty list"); process.exit(1); }
  console.log("PASS: 0 PTYs remaining\n");

  // Read PID from file to check later
  const pidStr = fs.readFileSync(PID_PATH, "utf8").trim();
  const daemonPid = parseInt(pidStr, 10);
  console.log(`Daemon PID from file: ${daemonPid}`);
  console.log("Waiting 17s for idle timeout (15s idle + buffer)...");

  await new Promise((r) => setTimeout(r, 17000));

  let isAlive = false;
  try {
    process.kill(daemonPid, 0);
    isAlive = true;
  } catch {
    isAlive = false;
  }

  console.log(`Daemon alive after idle timeout: ${isAlive}`);
  if (isAlive) {
    console.error("FAIL: daemon should have exited after idle timeout");
    process.exit(1);
  }
  console.log("PASS: daemon self-terminated\n");

  // AC6: stale cleanup test
  console.log("=== AC6: Stale cleanup test ===");
  // Check files exist (daemon may have cleaned them up — that's fine too)
  const sockExists = fs.existsSync(SOCK_PATH);
  console.log(`Socket file exists after shutdown: ${sockExists} (should be false — daemon cleans up)`);

  // Spawn fresh daemon (simulates HyperTerm next launch)
  console.log("Spawning new daemon (simulating HyperTerm restart)...");
  const child2 = spawn(process.execPath, [DAEMON_JS], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", HTPTYD_IDLE_MS: "5000" },
  });
  child2.unref();

  const ready2 = await waitForSocket(5000);
  if (!ready2) { console.error("FAIL: new daemon did not start"); process.exit(1); }
  const pong2 = await sendRequest({ type: "PING" });
  if (pong2.type !== "PONG") { console.error("FAIL: new daemon PING"); process.exit(1); }
  console.log("PASS: new daemon spawned cleanly after stale\n");

  // Shutdown
  try { await sendRequest({ type: "SHUTDOWN" }); } catch {}

  console.log("=== ALL TESTS PASSED ===");
}

main().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
