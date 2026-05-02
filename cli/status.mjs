// `constellation status` — daemon health + brief stats.
import { existsSync, readFileSync } from "node:fs";
import {
  getDaemon,
  loadConfig,
  userLogPath,
  userPidPath,
} from "./util.mjs";

export default async function status({ installRoot }) {
  const config = loadConfig(installRoot);
  const pidPath = userPidPath();
  const logPath = userLogPath();

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

  if (health) {
    const m = Math.floor(health.uptime / 60);
    const h = Math.floor(m / 60);
    const uptimeStr = h ? `${h}h ${m % 60}m` : `${m}m ${health.uptime % 60}s`;
    console.log(`Daemon:     running (pid ${pid ?? "?"}, port ${health.port}, uptime ${uptimeStr})`);
    console.log(`Visualizer: http://localhost:${config.web.port}`);
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
    console.log(`Logs:       ${logPath}`);
  } else {
    console.log(`Daemon:     not responding on port ${config.daemon.port}`);
    if (pid) {
      console.log(`Pidfile:    ${pidPath} (pid ${pid} — process may be dead)`);
    } else {
      console.log(`Pidfile:    ${pidPath} (missing)`);
    }
    console.log(`Logs:       ${logPath}`);
    console.log("");
    console.log(
      "Start it with `constellation start` (Mac) or " +
        "`npm run dev` from the install dir (self-dev).",
    );
    return 1;
  }
  return 0;
}
