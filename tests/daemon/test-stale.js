/**
 * AC6 stale test: kill -9 daemon → client detects stale → new daemon spawns
 */
const net = require("net");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, execSync } = require("child_process");

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
        try { resolve(JSON.parse(buf.slice(0, idx))); }
        catch (e) { reject(new Error("Bad JSON")); }
      }
    });
    sock.on("error", reject);
    sock.setTimeout(3000, () => { sock.destroy(); reject(new Error("Timeout")); });
  });
}

async function canConnect() {
  return new Promise((resolve) => {
    if (!fs.existsSync(SOCK_PATH)) { resolve(false); return; }
    const s = net.connect(SOCK_PATH, () => { s.destroy(); resolve(true); });
    s.on("error", () => resolve(false));
    s.setTimeout(500, () => { s.destroy(); resolve(false); });
  });
}

async function waitForSocket(ms = 5000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await canConnect()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

// Mirrors htptyd-client stale detection logic
async function ensureDaemon(idleMs = 5000) {
  if (await canConnect()) {
    console.log("[client] Already connected");
    return;
  }

  const pidExists = fs.existsSync(PID_PATH);
  const sockExists = fs.existsSync(SOCK_PATH);

  if (pidExists || sockExists) {
    // Check if PID alive
    let alive = false;
    try {
      const raw = fs.readFileSync(PID_PATH, "utf8").trim();
      const pid = parseInt(raw, 10);
      if (!isNaN(pid) && pid > 0) {
        process.kill(pid, 0);
        alive = true;
      }
    } catch { alive = false; }

    if (!alive) {
      console.log("[client] Stale files detected — cleaning up");
      try { fs.unlinkSync(SOCK_PATH); } catch {}
      try { fs.unlinkSync(PID_PATH); } catch {}
    }
  }

  console.log("[client] Spawning new daemon...");
  const child = spawn(process.execPath, [DAEMON_JS], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", HTPTYD_IDLE_MS: String(idleMs) },
  });
  child.unref();

  const ready = await waitForSocket(5000);
  if (!ready) throw new Error("Daemon did not come up");
  console.log("[client] Daemon ready\n");
}

async function main() {
  console.log("=== AC6: stale detection + respawn test ===\n");

  // Clean up
  try { fs.unlinkSync(SOCK_PATH); } catch {}
  try { fs.unlinkSync(PID_PATH); } catch {}

  // Step 1: Start initial daemon
  await ensureDaemon(30000); // long idle so it doesn't die during test

  const pong = await sendRequest({ type: "PING" });
  console.log("PING:", pong);
  if (pong.type !== "PONG") { console.error("FAIL: initial PING"); process.exit(1); }

  // Read daemon PID
  const daemonPid = parseInt(fs.readFileSync(PID_PATH, "utf8").trim(), 10);
  console.log(`Daemon PID: ${daemonPid}`);

  // Step 2: kill -9
  console.log("\nkill -9 daemon...");
  process.kill(daemonPid, 9);
  await new Promise((r) => setTimeout(r, 500));

  // Verify it's dead
  let alive = false;
  try { process.kill(daemonPid, 0); alive = true; } catch {}
  console.log(`Daemon alive after kill -9: ${alive}`);
  if (alive) { console.error("FAIL: daemon still alive"); process.exit(1); }
  console.log("PASS: daemon killed");

  // Stale files should still exist (kill -9 = no cleanup)
  console.log(`Stale sock exists: ${fs.existsSync(SOCK_PATH)}`);
  console.log(`Stale pid exists: ${fs.existsSync(PID_PATH)}`);

  // Step 3: simulate "HyperTerm next launch" — call ensureDaemon
  console.log("\nSimulating HyperTerm restart (ensureDaemon)...");
  await ensureDaemon(5000);

  // Should be connectable with new daemon
  const pong2 = await sendRequest({ type: "PING" });
  console.log("New daemon PING:", pong2);
  if (pong2.type !== "PONG") { console.error("FAIL: new daemon PING"); process.exit(1); }
  console.log("PASS: new daemon spawned after kill -9 stale\n");

  // Read new PID
  const newPid = parseInt(fs.readFileSync(PID_PATH, "utf8").trim(), 10);
  console.log(`New daemon PID: ${newPid} (old: ${daemonPid})`);
  if (newPid === daemonPid) { console.error("FAIL: same PID?"); process.exit(1); }
  console.log("PASS: different PID confirmed");

  // Cleanup
  try { await sendRequest({ type: "SHUTDOWN" }); } catch {}

  console.log("\n=== AC6 PASS ===");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
