#!/usr/bin/env node
/**
 * Post-build helper. `tsc -p tsconfig.daemon.json` rewrites
 * `dist/daemon/index.js` on disk, but the launchd-managed daemon goes
 * on running the old code it loaded into memory at boot. Symptoms are
 * subtle: lifecycle behavior changes (Stop semantics, sweep windows,
 * config field names) silently don't take effect until something
 * external bounces the service.
 *
 * If the launchd Constellation daemon is currently running this repo's
 * compiled output and the pid file is older than the freshly-built JS,
 * bounce it via `launchctl kickstart` so the new code takes over.
 * No-op if launchctl isn't available, the service isn't loaded, it's
 * pointed at a different repo, or the build isn't actually newer.
 *
 * Mirror of bounce-web-if-stale.mjs for the daemon tier.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

if (process.platform !== "darwin") process.exit(0);

const uid = process.getuid?.();
if (uid == null) process.exit(0);

const SERVICE = `gui/${uid}/com.constellation.daemon`;

const print = spawnSync("launchctl", ["print", SERVICE], { encoding: "utf8" });
if (print.status !== 0) process.exit(0);

// `launchctl print` includes a `working directory = …` line. Same lsof
// foot-gun applies as in bounce-web-if-stale.mjs — read it from
// launchctl directly.
const cwdMatch = print.stdout.match(/working directory\s*=\s*(.+)/);
if (!cwdMatch) process.exit(0);

let serviceCwd, myCwd;
try {
  serviceCwd = realpathSync(cwdMatch[1].trim());
  myCwd = realpathSync(process.cwd());
} catch {
  process.exit(0);
}

if (serviceCwd !== myCwd) process.exit(0);

// Decide whether the running daemon is actually stale relative to the
// freshly-built JS. The daemon writes its pid file at the top of main(),
// so its mtime is a reliable proxy for "when this daemon process
// started". If the build is older than the process, no bounce needed —
// nothing changed.
const distPath = path.join(myCwd, "dist", "daemon", "index.js");
const pidPath = userPidPath();
let distMtime, pidMtime;
try {
  distMtime = statSync(distPath).mtimeMs;
} catch {
  // No compiled output to bounce to. Either the build hasn't happened
  // yet or someone deleted it. Either way, refusing to bounce is the
  // safe move — kicking the daemon would just respawn into the same
  // running file.
  process.exit(0);
}
try {
  pidMtime = statSync(pidPath).mtimeMs;
} catch {
  // No pid file means nothing's running, which contradicts launchctl
  // print succeeding — corner case worth bouncing through to fix.
  pidMtime = 0;
}

if (pidMtime >= distMtime) process.exit(0);

console.log("[bounce] launchd daemon is running stale code — restarting…");
const kick = spawnSync("launchctl", ["kickstart", "-k", SERVICE], {
  stdio: "inherit",
});
if (kick.status !== 0) {
  console.warn("[bounce] launchctl kickstart failed; restart manually");
  process.exit(0);
}

const port = readDaemonPort();
const TIMEOUT_MS = 10_000;
const start = Date.now();

while (Date.now() - start < TIMEOUT_MS) {
  if (await tcpProbe(port)) {
    console.log(`[bounce] daemon ready on :${port}`);
    process.exit(0);
  }
  await sleep(200);
}
console.warn(`[bounce] timed out waiting for daemon on :${port}`);

function tcpProbe(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: "127.0.0.1", port }, () => {
      sock.end();
      resolve(true);
    });
    sock.on("error", () => resolve(false));
    setTimeout(() => {
      sock.destroy();
      resolve(false);
    }, 500);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function userDir() {
  return process.env.CONSTELLATION_USER_DIR
    ? process.env.CONSTELLATION_USER_DIR
    : path.join(os.homedir(), ".constellation");
}

function userPidPath() {
  return path.join(userDir(), "daemon.pid");
}

function readDaemonPort() {
  const cfgPath = path.join(userDir(), "config.json");
  if (!existsSync(cfgPath)) return 47317;
  try {
    return JSON.parse(readFileSync(cfgPath, "utf8")).daemon?.port ?? 47317;
  } catch {
    return 47317;
  }
}
