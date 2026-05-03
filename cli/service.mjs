// `constellation service install` / `service uninstall` — manages the
// launchd agents that keep Constellation running in the background.
//
// Constellation has two long-running pieces and they get one launchd
// agent each:
//
//   com.constellation.daemon → dist/daemon/index.js   (events + SSE on 47317)
//   com.constellation.web    → scripts/web-server.mjs (next start on 47318)
//
// Two plists, two log files, both KeepAlive + RunAtLoad. Either one can
// die and restart without taking the other down. Install/uninstall/start
// /stop iterate over both so the user only ever has one button.
//
// install: substitutes paths into each plist template, writes them to
// ~/Library/LaunchAgents/, runs `launchctl load -w` so they start now
// and at every login. Idempotent: if a plist already exists, it's
// rewritten (paths may have changed) and reloaded.
//
// uninstall: launchctl unload -w + rm for each plist. Stops both tiers
// and disables RunAtLoad — Constellation won't come back at next login.
//
// `start` and `stop` are thin wrappers around launchctl load/unload for
// users who want Constellation paused without uninstalling.
//
// Mac-only. Linux users run the daemon manually (`npm run daemon`) and
// the web tier manually (`npm run start`) — systemd integration can come
// later if there's demand.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { userDir, userLogPath, userWebLogPath } from "./util.mjs";

// Order matters: start daemon first (web SSR fetches /api/agents which
// proxies the daemon), stop in reverse so the web tier doesn't briefly
// thrash trying to reach a daemon that's already gone.
const SERVICES = [
  {
    label: "com.constellation.daemon",
    template: "service/com.constellation.daemon.plist.template",
    buildArtifact: "dist/daemon/index.js",
    buildHint: "npm run build:daemon",
    logFile: () => userLogPath(),
  },
  {
    label: "com.constellation.web",
    template: "service/com.constellation.web.plist.template",
    buildArtifact: ".next/BUILD_ID",
    buildHint: "npm run build:web",
    logFile: () => userWebLogPath(),
  },
];

function plistPathFor(label) {
  return path.join(os.homedir(), "Library/LaunchAgents", `${label}.plist`);
}

function macOnly(action) {
  if (process.platform !== "darwin") {
    console.error(
      `service ${action} is Mac-only. ` +
        "On Linux, run the daemon directly: `node dist/daemon/index.js`, " +
        "and the web tier with `npm run start` (after `npm run build:web`).",
    );
    return false;
  }
  return true;
}

export default async function service({ installRoot, args }) {
  const cmd = args[0];
  if (cmd === "service") {
    const sub = args[1];
    if (sub === "install") return install(installRoot);
    if (sub === "uninstall") return uninstall();
    console.error("Usage: constellation service install | uninstall");
    return 64;
  }
  if (cmd === "start") return start();
  if (cmd === "stop") return stop();
  console.error(`Internal: unknown service entry "${cmd}"`);
  return 1;
}

async function install(installRoot) {
  if (!macOnly("install")) return 1;

  // Verify every build artifact up front so we don't half-install.
  for (const svc of SERVICES) {
    const artifact = path.join(installRoot, svc.buildArtifact);
    if (!existsSync(artifact)) {
      console.error(
        `Missing build artifact for ${svc.label}: ${artifact}\n` +
          `Build it first: cd ${installRoot} && ${svc.buildHint}`,
      );
      return 1;
    }
    const tplPath = path.join(installRoot, svc.template);
    if (!existsSync(tplPath)) {
      console.error(`Missing plist template at ${tplPath}`);
      return 1;
    }
  }

  const ud = userDir();
  await mkdir(path.dirname(userLogPath()), { recursive: true });

  for (const svc of SERVICES) {
    const tplPath = path.join(installRoot, svc.template);
    const content = readFileSync(tplPath, "utf8")
      .replaceAll("__NODE__", process.execPath)
      .replaceAll("__INSTALL_DIR__", installRoot)
      .replaceAll("__USER_DIR__", ud)
      .replaceAll("__PATH__", process.env.PATH ?? "/usr/bin:/bin");

    const dest = plistPathFor(svc.label);
    await mkdir(path.dirname(dest), { recursive: true });

    // If a plist is already loaded, unload before rewriting — launchctl
    // caches the previous version's config in memory until reload.
    if (existsSync(dest)) {
      spawnSync("launchctl", ["unload", dest], { stdio: "ignore" });
    }

    writeFileSync(dest, content, "utf8");
    console.log(`✓ Wrote ${dest}`);

    const loadResult = spawnSync("launchctl", ["load", "-w", dest], {
      stdio: ["ignore", "inherit", "inherit"],
    });
    if (loadResult.status !== 0) {
      console.error(
        `! launchctl load ${svc.label} exited ${loadResult.status}`,
      );
      return loadResult.status ?? 1;
    }
    console.log(`✓ launchctl load ${svc.label} (RunAtLoad + KeepAlive)`);
  }

  console.log("");
  console.log(
    "Constellation is now running. Daemon log: " +
      userLogPath() +
      ". Web log: " +
      userWebLogPath() +
      ". Stop with `constellation stop`, fully remove with " +
      "`constellation service uninstall`.",
  );
  return 0;
}

async function uninstall() {
  if (!macOnly("uninstall")) return 1;
  let removed = 0;
  // Reverse order: stop the web tier first so it doesn't keep retrying
  // the daemon as the daemon is going down.
  for (const svc of [...SERVICES].reverse()) {
    const dest = plistPathFor(svc.label);
    if (!existsSync(dest)) continue;
    spawnSync("launchctl", ["unload", "-w", dest], { stdio: "ignore" });
    await rm(dest, { force: true });
    console.log(`✓ Unloaded ${svc.label} and removed ${dest}`);
    removed++;
  }
  if (removed === 0) {
    console.log("No Constellation plists found — nothing to do.");
  }
  return 0;
}

function start() {
  if (!macOnly("start")) return 1;
  let anyMissing = false;
  for (const svc of SERVICES) {
    const dest = plistPathFor(svc.label);
    if (!existsSync(dest)) {
      console.error(
        `No plist at ${dest}. Run \`constellation service install\` first.`,
      );
      anyMissing = true;
      continue;
    }
    const r = spawnSync("launchctl", ["load", "-w", dest], {
      stdio: ["ignore", "inherit", "inherit"],
    });
    if (r.status !== 0) return r.status ?? 1;
  }
  return anyMissing ? 1 : 0;
}

function stop() {
  if (!macOnly("stop")) return 1;
  // Reverse order — see uninstall().
  for (const svc of [...SERVICES].reverse()) {
    const dest = plistPathFor(svc.label);
    if (!existsSync(dest)) {
      console.error(`No plist at ${dest}.`);
      continue;
    }
    spawnSync("launchctl", ["unload", "-w", dest], {
      stdio: ["ignore", "inherit", "inherit"],
    });
  }
  return 0;
}
