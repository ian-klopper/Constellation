/**
 * Resolves Constellation's user-level directories — the single canonical
 * home for the daemon's config, state, registry, logs, and pidfile.
 * Replaces the old "per-target `.constellation/`" model: there is now one
 * machine-wide install instead of N target-rooted state dirs.
 *
 * Tests and local overrides can point Constellation at an alternate root
 * via `CONSTELLATION_USER_DIR=<absolute-path>`.
 */
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";

const DEFAULT_USER_DIR_NAME = ".constellation";

export function userDir(): string {
  const env = process.env.CONSTELLATION_USER_DIR;
  if (env !== undefined && env !== "") {
    if (!path.isAbsolute(env)) {
      throw new Error(
        `CONSTELLATION_USER_DIR must be absolute; got ${JSON.stringify(env)}`,
      );
    }
    return env;
  }
  return path.join(os.homedir(), DEFAULT_USER_DIR_NAME);
}

export function userConfigPath(): string {
  return path.join(userDir(), "config.json");
}

export function userStateDir(): string {
  return path.join(userDir(), "state", "agents");
}

export function userReposPath(): string {
  return path.join(userDir(), "repos.json");
}

export function userPidPath(): string {
  return path.join(userDir(), "daemon.pid");
}

export function userLogPath(): string {
  return path.join(userDir(), "logs", "daemon.log");
}

/**
 * Stable short hash of an absolute repo path. Used as a filename prefix
 * in `userStateDir()` so two repos can't collide on the same agent id,
 * and so an `ls ~/.constellation/state/agents/` makes the per-repo
 * grouping obvious at a glance.
 */
export function repoHash(absolutePath: string): string {
  return createHash("sha1").update(absolutePath).digest("hex").slice(0, 12);
}
