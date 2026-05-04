// `constellation status` — daemon health + brief stats.
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getDaemon,
  loadConfig,
  probePort,
  userLogPath,
  userPidPath,
  userWebLogPath,
} from "./util.mjs";

// Mirrors cli/service.mjs:SERVICES. Two short lines duplicated is cheaper
// than refactoring service.mjs to export them; promote if a third caller
// ever needs them.
const PLIST_LABELS = ["com.constellation.daemon", "com.constellation.web"];
function plistPathFor(label) {
  return path.join(os.homedir(), "Library/LaunchAgents", `${label}.plist`);
}

export default async function status({ installRoot }) {
  const config = loadConfig(installRoot);
  const pidPath = userPidPath();
  const logPath = userLogPath();
  const webLogPath = userWebLogPath();

  let pid = null;
  if (existsSync(pidPath)) {
    const raw = readFileSync(pidPath, "utf8").trim();
    pid = parseInt(raw, 10);
    if (!Number.isFinite(pid)) pid = null;
  }

  let health = null;
  try {
    health = await getDaemon(installRoot, "/health", { timeoutMs: 750 });
  } catch {
    /* daemon down */
  }

  const webUp = await probePort(config.web.port);
  const webUrl = `http://localhost:${config.web.port}`;

  if (health) {
    const m = Math.floor(health.uptime / 60);
    const h = Math.floor(m / 60);
    const uptimeStr = h ? `${h}h ${m % 60}m` : `${m}m ${health.uptime % 60}s`;
    console.log(`Daemon:     running (pid ${pid ?? "?"}, port ${health.port}, uptime ${uptimeStr})`);
  } else {
    console.log(`Daemon:     not responding on port ${config.daemon.port}`);
  }

  if (webUp) {
    console.log(`Visualizer: running (${webUrl})`);
  } else {
    console.log(`Visualizer: not responding on port ${config.web.port}`);
  }

  if (health) {
    let repos;
    try {
      repos = await getDaemon(installRoot, "/repos");
    } catch {
      /* ignore */
    }
    if (repos?.repos) {
      const total = repos.repos.length;
      const active = repos.repos.filter((r) => r.agentCount > 0).length;
      console.log(`Repos:      ${total} registered, ${active} active`);
    }
  }

  console.log(`Daemon log: ${logPath}`);
  console.log(`Web log:    ${webLogPath}`);

  // Mac-only: surface launchd plist presence so a stale install (e.g.
  // one that predates the web-tier plist) is visible at a glance, even
  // when the daemon happens to be running anyway.
  let macPlistsMissing = false;
  if (process.platform === "darwin") {
    const states = PLIST_LABELS.map((label) => ({
      label,
      installed: existsSync(plistPathFor(label)),
    }));
    const missing = states.filter((s) => !s.installed);
    macPlistsMissing = missing.length > 0;
    const summary = states
      .map(
        (s) =>
          `${s.label.replace("com.constellation.", "")} ${s.installed ? "✓" : "✗"}`,
      )
      .join(", ");
    console.log(`Launchd:    ${summary}`);
    if (macPlistsMissing) {
      console.log("");
      console.log(
        `! ${missing.length === 2 ? "Both" : "One"} launchd plist${missing.length === 1 ? "" : "s"} missing — ` +
          "Constellation won't auto-start on next reboot.",
      );
      console.log(
        "  Run `constellation service install` to register " +
          (missing.length === 2 ? "them" : "it") +
          ".",
      );
    }
  }

  if (!health || !webUp || macPlistsMissing) {
    if (!health && pid) {
      console.log("");
      console.log(`Pidfile:    ${pidPath} (pid ${pid} — process may be dead)`);
    }
    console.log("");
    console.log(
      "Start everything with `constellation start` (Mac), or run " +
        "`npm run dev` from the install dir for self-dev.",
    );
    return 1;
  }
  return 0;
}
