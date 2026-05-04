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
import { setTimeout as sleep } from "node:timers/promises";
import {
  getDaemon,
  loadConfig,
  probePort,
  userDir,
  userLogPath,
  userWebLogPath,
} from "./util.mjs";

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
  if (cmd === "start") return start(installRoot);
  if (cmd === "stop") return stop(installRoot);
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

// Poll `check` every intervalMs until it resolves truthy or timeoutMs
// elapses. Used by start/stop to confirm services actually came up or
// went down — `launchctl load` returning 0 only means the plist was
// registered, not that the process is listening.
async function waitFor(check, { timeoutMs, intervalMs }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await sleep(intervalMs);
  }
  return false;
}

async function start(installRoot) {
  if (!macOnly("start")) return 1;

  // First-run convenience: if any plist is missing, run `service install`
  // for the user instead of erroring out. install() is idempotent and
  // already runs `launchctl load -w` itself, so we skip the load loop
  // below and go straight to verification.
  const anyMissing = SERVICES.some((svc) => !existsSync(plistPathFor(svc.label)));
  let autoInstalled = false;
  if (anyMissing) {
    console.log("! Launchd plists missing — running `service install` first…");
    const code = await install(installRoot);
    if (code !== 0) return code;
    autoInstalled = true;
  } else {
    for (const svc of SERVICES) {
      const dest = plistPathFor(svc.label);
      // Pre-unload so re-loading an already-loaded plist doesn't print
      // `Load failed: 5: Input/output error` to stderr (which reads as
      // a hard failure even though launchctl exits 0). Same pattern as
      // install() — see the comment in that function.
      spawnSync("launchctl", ["unload", dest], { stdio: "ignore" });
      const r = spawnSync("launchctl", ["load", "-w", dest], {
        stdio: ["ignore", "inherit", "inherit"],
      });
      if (r.status !== 0) {
        console.error(`! launchctl load ${svc.label} exited ${r.status}`);
        return r.status ?? 1;
      }
      console.log(`✓ Loaded ${svc.label}`);
    }
  }

  // launchctl load returned 0, but that only means the plist registered —
  // the actual process may still be booting (or crash-looping under
  // KeepAlive). Poll each port until it answers, so the immediate-next
  // `constellation open` reaches a live web tier.
  const config = loadConfig(installRoot);

  const daemonUp = await waitFor(
    async () => {
      try {
        await getDaemon(installRoot, "/health", { timeoutMs: 500 });
        return true;
      } catch {
        return false;
      }
    },
    { timeoutMs: 10_000, intervalMs: 250 },
  );
  if (!daemonUp) {
    console.error(
      `! Daemon did not respond on :${config.daemon.port} within 10s. ` +
        `Check ${userLogPath()}.`,
    );
    return 1;
  }
  console.log(`✓ Daemon listening on :${config.daemon.port}`);

  const webUp = await waitFor(() => probePort(config.web.port), {
    timeoutMs: 15_000,
    intervalMs: 250,
  });
  if (!webUp) {
    console.error(
      `! Visualizer did not come up on :${config.web.port} within 15s. ` +
        `Check ${userWebLogPath()}.`,
    );
    return 1;
  }
  console.log(`✓ Visualizer listening on :${config.web.port}`);

  // install() already prints its own "Constellation is now running"
  // summary, so skip ours on the auto-install path to avoid two summaries.
  if (!autoInstalled) {
    console.log("");
    console.log(
      "Constellation is running. Open the visualizer with `constellation open`.",
    );
  }
  return 0;
}

async function stop(installRoot) {
  if (!macOnly("stop")) return 1;
  // Reverse order — see uninstall().
  for (const svc of [...SERVICES].reverse()) {
    const dest = plistPathFor(svc.label);
    if (!existsSync(dest)) {
      console.log(`· No plist at ${dest}, skipping.`);
      continue;
    }
    spawnSync("launchctl", ["unload", "-w", dest], {
      stdio: ["ignore", "inherit", "inherit"],
    });
    console.log(`✓ Unloaded ${svc.label}`);
  }

  // Confirm both ports actually released. KeepAlive is off after `unload
  // -w`, so this should resolve fast — we mostly want a clear "stopped"
  // signal so the user knows the next `start` is safe.
  const config = loadConfig(installRoot);
  const webDown = await waitFor(
    async () => !(await probePort(config.web.port)),
    { timeoutMs: 5_000, intervalMs: 250 },
  );
  if (webDown) {
    console.log("✓ Visualizer stopped.");
  } else {
    console.error(`! Visualizer still listening on :${config.web.port} after 5s.`);
  }

  const daemonDown = await waitFor(
    async () => !(await probePort(config.daemon.port)),
    { timeoutMs: 5_000, intervalMs: 250 },
  );
  if (daemonDown) {
    console.log("✓ Daemon stopped.");
  } else {
    console.error(`! Daemon still listening on :${config.daemon.port} after 5s.`);
  }

  console.log("");
  console.log("Constellation stopped.");
  return webDown && daemonDown ? 0 : 1;
}
