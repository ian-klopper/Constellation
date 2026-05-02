#!/usr/bin/env node
/**
 * Dev supervisor — starts the constellation daemon (the bash-hook
 * replacement) alongside `next dev`. Both children spawn idempotently:
 * the daemon skips its spawn when the user-dir pidfile points to a live
 * process, and `next dev` skips when something is already serving on the
 * configured web port. That makes re-running `npm run dev` a safe no-op
 * once Constellation is already up.
 *
 * The supervisor is now Constellation-self-dev only: a packaged install
 * runs the daemon under launchd, not under this script. End users open
 * the visualizer separately.
 */
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const INSTALL_ROOT = process.cwd();

// Mirror lib/user-dirs.ts — kept inline because this file is .mjs and
// can't import from the TypeScript module without an extra build step.
const USER_DIR =
  process.env.CONSTELLATION_USER_DIR && process.env.CONSTELLATION_USER_DIR !== ""
    ? process.env.CONSTELLATION_USER_DIR
    : path.join(os.homedir(), ".constellation");
const PID_FILE = path.join(USER_DIR, "daemon.pid");

const config = JSON.parse(
  await readFile(path.join(INSTALL_ROOT, "constellation.config.json"), "utf8"),
);

function daemonAlreadyRunning() {
  if (!existsSync(PID_FILE)) return false;
  const pid = parseInt(readFileSync(PID_FILE, "utf8").trim(), 10);
  if (!Number.isFinite(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// TCP probe: returns true iff something is already accepting connections
// on 127.0.0.1:<port>. Short timeout so a missed answer doesn't stall
// the supervisor boot.
function portInUse(port) {
  return new Promise((resolve) => {
    const sock = createConnection({ host: "127.0.0.1", port, timeout: 250 });
    let settled = false;
    const finish = (used) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(used);
    };
    sock.once("connect", () => finish(true));
    sock.once("timeout", () => finish(false));
    sock.once("error", () => finish(false));
  });
}

const children = [];

function startDaemon() {
  if (daemonAlreadyRunning()) {
    console.log(`[supervisor] daemon already running, skipping spawn`);
    return null;
  }
  const env = { ...process.env, CONST_FRESH: "1" };
  const proc = spawn("npx", ["tsx", "daemon/index.ts"], {
    cwd: INSTALL_ROOT,
    env,
    stdio: ["ignore", "inherit", "inherit"],
  });
  children.push(proc);
  proc.on("exit", (code) => {
    console.log(`[supervisor] daemon exited (${code})`);
  });
  return proc;
}

function startNext() {
  const proc = spawn("npx", ["next", "dev", "-p", String(config.web.port)], {
    cwd: INSTALL_ROOT,
    stdio: "inherit",
  });
  children.push(proc);
  proc.on("exit", (code) => {
    console.log(`[supervisor] next exited (${code})`);
    shutdown();
  });
  return proc;
}

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    if (!c.killed) {
      try {
        c.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
  }
  // Give them a moment, then force-exit.
  setTimeout(() => process.exit(0), 500);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const webBusy = await portInUse(config.web.port);
if (webBusy) {
  // Another supervisor is already serving on this port — nothing to do.
  // We don't need to start the daemon either: the existing supervisor
  // already manages it (or the standalone daemon is fine on its own).
  console.log(
    `[supervisor] Constellation already running at http://localhost:${config.web.port} — nothing to start.`,
  );
  process.exit(0);
}

startDaemon();
startNext();
