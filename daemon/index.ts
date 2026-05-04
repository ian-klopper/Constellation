/**
 * Daemon entry point. Boots the HTTP server, in-memory lifecycle,
 * disk-sync, SSE broker, and transcript watchers; re-hydrates from any
 * lifecycle JSON files left over from a previous run; writes a pid file
 * for the dev supervisor's idempotent re-spawn check.
 *
 * The hook shims fire-and-forget POST events at us. Daemon down ⇒ silent
 * no-op in the shim ⇒ Claude Code session keeps working. That invariant
 * is the whole reason the bash hooks could be replaced safely.
 *
 * The daemon is a system-wide singleton: one process watches every repo
 * whose hooks point at this port, and all state lives under
 * `~/.constellation/`. There is no per-target binding — events arrive
 * tagged with `cwd`, the lifecycle namespaces by it, and the on-disk
 * filenames carry a repo hash so two repos can't collide.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { loadConfig } from "../lib/config";
import { userPidPath, userStateDir } from "../lib/user-dirs";
import { Lifecycle } from "./lifecycle";
import { TranscriptWatcher } from "./transcripts";
import { DiskSync } from "./disk-sync";
import { DescriptionsBroker, SseBroker } from "./sse";
import { startServer } from "./server";
import { RepoRegistry } from "./registry";
import { clearAgentFiles } from "./atomic-write";

async function main() {
  const config = loadConfig();
  const stateDir = userStateDir();
  const pidFile = userPidPath();

  if (process.env.CONST_FRESH === "1") {
    await clearAgentFiles(stateDir);
  }

  await fs.mkdir(path.dirname(pidFile), { recursive: true });
  await fs.writeFile(pidFile, String(process.pid), "utf8");

  const sse = new SseBroker();
  const descriptions = new DescriptionsBroker();
  const disk = new DiskSync(stateDir);
  const registry = new RepoRegistry();
  await registry.load();
  const lifecycle = new Lifecycle(disk, sse, registry);
  const watchers = new TranscriptWatcher(lifecycle);

  lifecycle.setHooks({
    onBackgroundTranscript: (key, p, cwd) => watchers.watchBackground(key, p, cwd),
    onMainTranscript: (sessionId, p) => watchers.watchMain(sessionId, p),
    stopWatchersFor: (key) => watchers.stopFor(key),
  });

  await lifecycle.loadFromDisk(stateDir, config.staleAgentSeconds);

  const server = startServer(config.daemon.port, lifecycle, sse, registry, descriptions);

  // Sweep stale entries every 10s. One unified rule: any agent whose
  // lastActiveAt is older than `staleAgentSeconds` is reaped — kind /
  // status / id don't matter. Pairs with handleTouch's lazy resurrection
  // so an over-eager reap is harmless: the moment the user does anything
  // again, the entry comes back. Worst-case bound for "agent crashed,
  // rail still shows it" = staleAgentSeconds + sweep interval.
  const ZOMBIE_SWEEP_INTERVAL_MS = 10_000;
  const sweepTimer = setInterval(
    () => lifecycle.sweepZombies(config.staleAgentSeconds),
    ZOMBIE_SWEEP_INTERVAL_MS,
  );
  sweepTimer.unref();

  console.log(
    `[daemon] listening on 127.0.0.1:${config.daemon.port}, stateDir=${stateDir}`,
  );

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[daemon] ${signal} — shutting down`);
    clearInterval(sweepTimer);
    watchers.closeAll();
    await disk.flushAll();
    await registry.flush();
    sse.close();
    descriptions.close();
    server.close();
    await fs.rm(pidFile, { force: true });
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[daemon] fatal:", err);
  process.exit(1);
});
