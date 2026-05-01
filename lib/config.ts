/**
 * Reads constellation.config.json once per process and hands the parsed
 * shape to every server-side caller (the API route, the daemon, hook
 * shims). The file is the single source of truth for the lifecycle-state
 * directory, the watched-tools list, and the daemon's local port — kept
 * out of code so adding a tool or moving the state dir is a one-file
 * change.
 *
 * Two-root architecture: `loadConfig(installRoot)` always reads from the
 * install dir (port + watchedTools + ttl are install-level). `resolveStateDir`
 * and `resolveTargetRoot` deal with the target dir (where the visualized
 * repo lives, and where lifecycle state files get written). Under the
 * sibling-clone install model these are different directories; under
 * single-repo dev they're the same and `CONSTELLATION_TARGET_ROOT` is
 * unset, which falls through to `process.cwd()`.
 */
// Intentionally not "server-only": this module is also imported by the
// daemon (plain Node, not a Next.js bundle), where the server-only sentinel
// throws at import time. The Next.js callers (lib/scan, /api/agents) are
// already server-only by their own context.
import { readFileSync } from "node:fs";
import path from "node:path";

export type Config = {
  stateDir: string;
  watchedTools: string[];
  daemon: {
    port: number;
    pidFile: string;
  };
  web: {
    port: number;
  };
  agentTtlSeconds: number;
};

let cached: Config | null = null;

export function loadConfig(installRoot: string = process.cwd()): Config {
  if (cached) return cached;
  const raw = readFileSync(
    path.join(installRoot, "constellation.config.json"),
    "utf8",
  );
  const parsed = JSON.parse(raw) as Config;
  cached = parsed;
  return parsed;
}

export function resolveStateDir(targetRoot: string): string {
  // No default arg — callers must be intentional about which root holds state.
  // The Config is install-rooted, but stateDir is a relative path joined onto
  // the target.
  return path.join(targetRoot, loadConfig().stateDir);
}

let warnedMissingTargetRoot = false;

/**
 * Resolves the target repo (the one being visualized) from the
 * `CONSTELLATION_TARGET_ROOT` env var. Falls back to `process.cwd()` with a
 * one-time stderr warning when unset — that's the single-repo-dev path.
 * Throws on empty or relative env values to keep malformed input from
 * propagating into filesystem joins.
 */
export function resolveTargetRoot(): string {
  const env = process.env.CONSTELLATION_TARGET_ROOT;
  if (env === undefined) {
    if (!warnedMissingTargetRoot) {
      warnedMissingTargetRoot = true;
      console.warn(
        "[constellation] CONSTELLATION_TARGET_ROOT unset; defaulting to cwd",
      );
    }
    return process.cwd();
  }
  if (env === "" || !path.isAbsolute(env)) {
    throw new Error(
      `CONSTELLATION_TARGET_ROOT must be a non-empty absolute path; got ${JSON.stringify(env)}`,
    );
  }
  return env;
}
