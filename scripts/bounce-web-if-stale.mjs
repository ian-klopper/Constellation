#!/usr/bin/env node
/**
 * Post-build helper. `next build` rewrites .next/ chunk filenames with
 * new content hashes, but a `next start` process running against the
 * same directory keeps serving HTML that references the old hashes (or
 * its new HTML asks for chunks it never actually mapped). The browser
 * gets HTTP 500 on the first chunk fetch and the page fails to load.
 *
 * If the launchd-managed Constellation web tier is currently serving
 * from this directory, bounce it via `launchctl kickstart` so the
 * fresh build is picked up. No-op if launchctl isn't available, the
 * service isn't loaded, or it's serving from a different directory.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

if (process.platform !== "darwin") process.exit(0);

const uid = process.getuid?.();
if (uid == null) process.exit(0);

const SERVICE = `gui/${uid}/com.constellation.web`;

const print = spawnSync("launchctl", ["print", SERVICE], { encoding: "utf8" });
if (print.status !== 0) process.exit(0);

// `launchctl print` includes a `working directory = …` line. Use it
// directly instead of going through lsof — `lsof -p PID -d cwd` without
// `-a` ORs the flags together and returns cwd for every process on the
// machine, silently producing the wrong answer.
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

console.log("[bounce] launchd web is serving from this dir — restarting…");
const kick = spawnSync("launchctl", ["kickstart", "-k", SERVICE], {
  stdio: "inherit",
});
if (kick.status !== 0) {
  console.warn("[bounce] launchctl kickstart failed; restart manually");
  process.exit(0);
}

const port = readWebPort();
const TIMEOUT_MS = 10_000;
const start = Date.now();

while (Date.now() - start < TIMEOUT_MS) {
  if (await tcpProbe(port)) {
    console.log(`[bounce] web tier ready on :${port}`);
    process.exit(0);
  }
  await sleep(200);
}
console.warn(`[bounce] timed out waiting for web tier on :${port}`);

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

function readWebPort() {
  const cfgPath =
    process.env.CONSTELLATION_USER_DIR
      ? path.join(process.env.CONSTELLATION_USER_DIR, "config.json")
      : path.join(os.homedir(), ".constellation", "config.json");
  if (!existsSync(cfgPath)) return 47318;
  try {
    return JSON.parse(readFileSync(cfgPath, "utf8")).web?.port ?? 47318;
  } catch {
    return 47318;
  }
}
