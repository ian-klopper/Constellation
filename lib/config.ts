/**
 * Reads Constellation's runtime config from `~/.constellation/config.json`.
 * One file, one source of truth for the daemon port, the visualizer port,
 * the watched-tools list, and the staleness TTL — shared across every
 * repo the daemon watches.
 *
 * On first run the user-config file won't exist yet. We seed it from the
 * bundled defaults at `<cwd>/constellation.config.json` (the repo's own
 * file under self-dev, the install's file under the future global setup).
 * After that, the bundled file is irrelevant — edits go to the user file.
 */
// Intentionally not "server-only": this module is also imported by the
// daemon (plain Node, not a Next.js bundle), where the server-only sentinel
// throws at import time. The Next.js callers (lib/scan, /api/agents) are
// already server-only by their own context.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import path from "node:path";
import { userConfigPath, userDir } from "./user-dirs";

export type Config = {
  watchedTools: string[];
  daemon: { port: number };
  web: { port: number };
  staleAgentSeconds: number;
};

let cached: Config | null = null;

export function loadConfig(): Config {
  if (cached) return cached;
  ensureUserConfig();
  const raw = readFileSync(userConfigPath(), "utf8");
  const parsed = JSON.parse(raw) as Partial<Config> & {
    agentTtlSeconds?: number;
  };
  // Default-on-miss handles users who already have a pre-rename
  // ~/.constellation/config.json with `agentTtlSeconds`. We do NOT
  // honor that legacy value: it usually came from the bundled 1800s
  // default, not a deliberate setting, and honoring it would suppress
  // the very fix this rename ships.
  if (typeof parsed.staleAgentSeconds !== "number") {
    if (typeof parsed.agentTtlSeconds === "number") {
      console.warn(
        "[config] migrating to staleAgentSeconds=60 (legacy agentTtlSeconds ignored)",
      );
    }
    parsed.staleAgentSeconds = 60;
  }
  cached = parsed as Config;
  return cached;
}

function ensureUserConfig(): void {
  const target = userConfigPath();
  if (existsSync(target)) return;
  mkdirSync(userDir(), { recursive: true });
  const bundled = path.join(process.cwd(), "constellation.config.json");
  if (!existsSync(bundled)) {
    throw new Error(
      `User config missing at ${target} and no bundled defaults at ${bundled}. ` +
        `Run the installer or copy a config manually.`,
    );
  }
  copyFileSync(bundled, target);
}

// For tests — clears the in-process cache so a freshly written user config
// is picked up on the next loadConfig() call.
export function _resetConfigCache(): void {
  cached = null;
}
