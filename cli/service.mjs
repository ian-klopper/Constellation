// `constellation service install` / `service uninstall` — manages the
// launchd agent that keeps the daemon running in the background.
//
// install: substitutes paths into the plist template, writes it to
// ~/Library/LaunchAgents/, runs `launchctl load -w` so it starts now and
// at every login. Idempotent: if the plist already exists, the file is
// rewritten (paths may have changed) and reloaded.
//
// uninstall: launchctl unload -w + rm. Stops the daemon for now and
// disables RunAtLoad — the daemon won't come back at next login.
//
// `start` and `stop` are thin wrappers around launchctl load/unload for
// users who want the daemon paused without uninstalling.
//
// Mac-only. Linux users run the daemon manually (`npm run daemon` or
// the equivalent) — systemd integration can come later if there's
// demand.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { userDir, userLogPath } from "./util.mjs";

const LABEL = "com.constellation.daemon";

function plistPath() {
  return path.join(os.homedir(), "Library/LaunchAgents", `${LABEL}.plist`);
}

function macOnly() {
  if (process.platform !== "darwin") {
    console.error(
      `service ${process.argv[3] ?? ""} is Mac-only. ` +
        "On Linux, run the daemon directly: `node dist/daemon/index.js`.",
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
  if (!macOnly()) return 1;

  const distEntry = path.join(installRoot, "dist/daemon/index.js");
  if (!existsSync(distEntry)) {
    console.error(
      `Compiled daemon not found at ${distEntry}.\n` +
        `Build it first: cd ${installRoot} && npm run build:daemon`,
    );
    return 1;
  }

  const tplPath = path.join(
    installRoot,
    "service/com.constellation.daemon.plist.template",
  );
  if (!existsSync(tplPath)) {
    console.error(`Missing plist template at ${tplPath}`);
    return 1;
  }

  const ud = userDir();
  await mkdir(path.dirname(userLogPath()), { recursive: true });

  const content = readFileSync(tplPath, "utf8")
    .replaceAll("__NODE__", process.execPath)
    .replaceAll("__INSTALL_DIR__", installRoot)
    .replaceAll("__USER_DIR__", ud)
    .replaceAll("__PATH__", process.env.PATH ?? "/usr/bin:/bin");

  const dest = plistPath();
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
    console.error(`! launchctl load exited ${loadResult.status}`);
    return loadResult.status ?? 1;
  }
  console.log(`✓ launchctl load (RunAtLoad + KeepAlive)`);
  console.log("");
  console.log(
    "The daemon is now running. Logs: " +
      userLogPath() +
      ". Stop with `constellation stop`, fully remove with `constellation service uninstall`.",
  );
  return 0;
}

async function uninstall() {
  if (!macOnly()) return 1;
  const dest = plistPath();
  if (!existsSync(dest)) {
    console.log(`No plist at ${dest} — nothing to do.`);
    return 0;
  }
  spawnSync("launchctl", ["unload", "-w", dest], { stdio: "ignore" });
  const { rmSync } = await import("node:fs");
  rmSync(dest, { force: true });
  console.log(`✓ Unloaded launchd agent and removed ${dest}`);
  return 0;
}

function start() {
  if (!macOnly()) return 1;
  const dest = plistPath();
  if (!existsSync(dest)) {
    console.error(
      `No plist at ${dest}. Run \`constellation service install\` first.`,
    );
    return 1;
  }
  const r = spawnSync("launchctl", ["load", "-w", dest], {
    stdio: ["ignore", "inherit", "inherit"],
  });
  return r.status ?? 1;
}

function stop() {
  if (!macOnly()) return 1;
  const dest = plistPath();
  if (!existsSync(dest)) {
    console.error(`No plist at ${dest}.`);
    return 1;
  }
  const r = spawnSync("launchctl", ["unload", "-w", dest], {
    stdio: ["ignore", "inherit", "inherit"],
  });
  return r.status ?? 1;
}
