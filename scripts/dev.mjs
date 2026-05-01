#!/usr/bin/env node
/**
 * Dev supervisor — starts the constellation daemon (the bash-hook
 * replacement) alongside `next dev`. Handles idempotent re-spawn (skips
 * the daemon if its pid file points to a live process), forwards stdio,
 * and shuts both children down cleanly on Ctrl-C.
 */
import { spawn } from "node:child_process";
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

startDaemon();
startNext();
