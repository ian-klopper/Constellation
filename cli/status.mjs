// `constellation status` — daemon health + brief stats.
import { existsSync, readFileSync } from "node:fs";
import { createConnection } from "node:net";
import {
  getDaemon,
  loadConfig,
  userLogPath,
  userPidPath,
  userWebLogPath,
} from "./util.mjs";

// TCP probe — returns true iff something is listening on 127.0.0.1:<port>.
// Cheap signal that the web tier is up without doing a full HTTP roundtrip
// (Next.js can take a beat to answer the very first request after boot).
function probePort(port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const sock = createConnection({ host: "127.0.0.1", port, timeout: timeoutMs });
    let settled = false;
    const finish = (up) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(up);
    };
    sock.once("connect", () => finish(true));
    sock.once("timeout", () => finish(false));
    sock.once("error", () => finish(false));
  });
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

  if (!health || !webUp) {
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
