/**
 * Daemon entry point. Boots the HTTP server, in-memory lifecycle,
 * disk-sync, SSE broker, and transcript watchers; re-hydrates from any
 * lifecycle JSON files left over from a previous run; writes a pid file
 * for the dev supervisor's idempotent re-spawn check.
 *
 * The hook shims fire-and-forget POST events at us. Daemon down ⇒ silent
 * no-op in the shim ⇒ Claude Code session keeps working. That invariant
 * is the whole reason the bash hooks could be replaced safely.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { loadConfig, resolveTargetRoot } from "../lib/config";
import { Lifecycle } from "./lifecycle";
import { TranscriptWatcher } from "./transcripts";
import { DiskSync } from "./disk-sync";
import { SseBroker } from "./sse";
import { startServer } from "./server";
import { clearAgentFiles } from "./atomic-write";

async function main() {
  // Config (port, watchedTools, ttl) is install-rooted — we read it from the
  // supervisor's cwd. State (lifecycle JSON, pidfile) is target-rooted —
  // it lives next to the repo being visualized.
  const config = loadConfig();
  const targetRoot = resolveTargetRoot();
  const stateDir = path.join(targetRoot, config.stateDir);
  const pidFile = path.join(targetRoot, config.daemon.pidFile);

  if (process.env.CONST_FRESH === "1") {
    await clearAgentFiles(stateDir);
  }

  await fs.mkdir(path.dirname(pidFile), { recursive: true });
  await fs.writeFile(pidFile, String(process.pid), "utf8");

  const sse = new SseBroker();
  const disk = new DiskSync(stateDir);
  const lifecycle = new Lifecycle(disk, sse);
  const watchers = new TranscriptWatcher(lifecycle);

  lifecycle.setHooks({
    onBackgroundTranscript: (key, p, cwd) => watchers.watchBackground(key, p, cwd),
    onMainTranscript: (sessionId, p) => watchers.watchMain(sessionId, p),
    stopWatchersFor: (key) => watchers.stopFor(key),
  });

  await lifecycle.loadFromDisk(stateDir);

  const server = startServer(config.daemon.port, lifecycle, sse);

  console.log(
    `[daemon] listening on 127.0.0.1:${config.daemon.port}, stateDir=${stateDir}`,
  );

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[daemon] ${signal} — shutting down`);
    watchers.closeAll();
    await disk.flushAll();
    sse.close();
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
