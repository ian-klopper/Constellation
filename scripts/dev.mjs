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

const ROOT = process.cwd();
const config = JSON.parse(
  await readFile(path.join(ROOT, "constellation.config.json"), "utf8"),
);
const PID_FILE = path.join(ROOT, config.daemon.pidFile);

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
    cwd: ROOT,
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
  const proc = spawn("npx", ["next", "dev"], {
    cwd: ROOT,
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

startDaemon();
startNext();
