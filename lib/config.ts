/**
 * Reads constellation.config.json once per process and hands the parsed
 * shape to every server-side caller (the API route, the daemon, hook
 * shims). The file is the single source of truth for the lifecycle-state
 * directory, the watched-tools list, and the daemon's local port — kept
 * out of code so adding a tool or moving the state dir is a one-file
 * change.
 */
import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";

export type Config = {
  stateDir: string;
  watchedTools: string[];
  daemon: {
    port: number;
    pidFile: string;
  };
  agentTtlSeconds: number;
};

let cached: Config | null = null;

export function loadConfig(root: string = process.cwd()): Config {
  if (cached) return cached;
  const raw = readFileSync(
    path.join(root, "constellation.config.json"),
    "utf8",
  );
  const parsed = JSON.parse(raw) as Config;
  cached = parsed;
  return parsed;
}

export function resolveStateDir(root: string = process.cwd()): string {
  return path.join(root, loadConfig(root).stateDir);
}
