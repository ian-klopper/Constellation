#!/usr/bin/env node
/**
 * Production launcher for the Constellation visualizer (Next.js).
 * launchd runs this script via the com.constellation.web plist.
 *
 * Reads ~/.constellation/config.json for the web port (falling back to
 * the bundled defaults when the user file hasn't been seeded yet), then
 * execs `next start -p <port>` from the install dir. Reading the port
 * at process start means port changes don't require re-running
 * `constellation service install` — same pattern as the daemon.
 *
 * Forwards SIGTERM/SIGINT to the child so launchd's stop signal lands
 * cleanly on the Next.js server.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INSTALL_ROOT = path.resolve(HERE, "..");

const USER_DIR =
  process.env.CONSTELLATION_USER_DIR && process.env.CONSTELLATION_USER_DIR !== ""
    ? process.env.CONSTELLATION_USER_DIR
    : path.join(os.homedir(), ".constellation");

const userConfig = path.join(USER_DIR, "config.json");
const bundled = path.join(INSTALL_ROOT, "constellation.config.json");
const configPath = existsSync(userConfig) ? userConfig : bundled;

let config;
try {
  config = JSON.parse(readFileSync(configPath, "utf8"));
} catch (err) {
  console.error(`[web] failed to read config at ${configPath}: ${err?.message ?? err}`);
  process.exit(1);
}

const port = Number(config?.web?.port);
if (!Number.isFinite(port) || port <= 0) {
  console.error(`[web] invalid web.port in ${configPath}: ${JSON.stringify(config?.web?.port)}`);
  process.exit(1);
}

const buildId = path.join(INSTALL_ROOT, ".next", "BUILD_ID");
if (!existsSync(buildId)) {
  console.error(
    `[web] no production build at ${path.join(INSTALL_ROOT, ".next")}.\n` +
      `      Run: cd ${INSTALL_ROOT} && npm run build:web`,
  );
  process.exit(1);
}

const nextBin = path.join(INSTALL_ROOT, "node_modules", ".bin", "next");
if (!existsSync(nextBin)) {
  console.error(
    `[web] next CLI not found at ${nextBin}.\n` +
      `      Run: cd ${INSTALL_ROOT} && npm ci`,
  );
  process.exit(1);
}

console.log(`[web] starting next start -p ${port} (cwd ${INSTALL_ROOT})`);

// detached:true puts the child in its own process group so we can signal
// the whole tree on shutdown. `next start` spawns a `next-server` grandchild
// that doesn't propagate SIGTERM from its parent, so signaling only the
// direct child orphans next-server and leaves the port bound after launchctl
// unload — exactly the "stop says success but visualizer still listening"
// failure mode. process.kill(-pid, sig) signals the whole group.
const child = spawn(nextBin, ["start", "-p", String(port)], {
  cwd: INSTALL_ROOT,
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "production" },
  detached: true,
});

const forward = (sig) => {
  try {
    process.kill(-child.pid, sig);
  } catch {
    /* group may already be gone */
  }
};
process.on("SIGTERM", () => forward("SIGTERM"));
process.on("SIGINT", () => forward("SIGINT"));

child.on("exit", (code, signal) => {
  if (signal) {
    console.log(`[web] next exited via ${signal}`);
    process.exit(0);
  }
  process.exit(code ?? 0);
});
