#!/usr/bin/env node
/**
 * Dev supervisor — starts the constellation daemon (the bash-hook
 * replacement) alongside `next dev`. Both children spawn idempotently:
 * the daemon skips its spawn when its pid file points to a live process,
 * and `next dev` skips when something is already serving on the
 * configured web port. That makes re-running `npm run dev` (or
 * re-running `install.sh` from a second repo) a safe no-op once
 * Constellation is already up.
 */
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

// INSTALL_ROOT = where Constellation's code lives (this script's cwd).
// TARGET_ROOT  = the repo being visualized. Equal to INSTALL_ROOT in
// single-repo dev; set via CONSTELLATION_TARGET_ROOT under sibling-clone.
const INSTALL_ROOT = process.cwd();
const TARGET_ROOT = process.env.CONSTELLATION_TARGET_ROOT ?? INSTALL_ROOT;

if (
  process.env.CONSTELLATION_TARGET_ROOT !== undefined &&
  !path.isAbsolute(process.env.CONSTELLATION_TARGET_ROOT)
) {
  console.error(
    `[supervisor] CONSTELLATION_TARGET_ROOT must be an absolute path; got ${JSON.stringify(
      process.env.CONSTELLATION_TARGET_ROOT,
    )}`,
  );
  process.exit(1);
}

const config = JSON.parse(
  await readFile(path.join(INSTALL_ROOT, "constellation.config.json"), "utf8"),
);
// Pidfile lives next to the lifecycle state — both target-rooted, so
// stopping the supervisor in repo A and starting it in repo B doesn't
// trip the "daemon already running" check on a stale file from A.
const PID_FILE = path.join(TARGET_ROOT, config.daemon.pidFile);

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

if (TARGET_ROOT !== INSTALL_ROOT) {
  console.log(`[supervisor] target = ${TARGET_ROOT}`);
}

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
