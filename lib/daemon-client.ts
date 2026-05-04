/**
 * Tiny server-side helpers for hitting the local daemon. Both calls
 * have a short timeout and silently degrade to an empty list when the
 * daemon is down — the visualizer keeps rendering the current repo's
 * tree either way, just without live agent visibility.
 */
import "server-only";
import path from "node:path";
import { promises as fs } from "node:fs";
import { loadConfig } from "./config";
import { userStateDir } from "./user-dirs";
import { ActiveAgentSchema, type ActiveAgent, type RepoSummary } from "./types";

const TIMEOUT_MS = 500;

export async function fetchRepos(): Promise<RepoSummary[]> {
  const config = loadConfig();
  try {
    const res = await fetch(`http://127.0.0.1:${config.daemon.port}/repos`, {
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { repos: RepoSummary[] };
    return Array.isArray(json.repos) ? json.repos : [];
  } catch {
    return [];
  }
}

/**
 * Returns the current agent list for SSR seeding of the AgentDock.
 * Hits the daemon first; on failure reads the on-disk lifecycle files
 * the same way /api/agents does — so the initial render shows live
 * agents rather than flashing an empty dock.
 */
export async function fetchAgents(): Promise<ActiveAgent[]> {
  const config = loadConfig();

  // Try the daemon first — it is the authoritative source.
  try {
    const res = await fetch(`http://127.0.0.1:${config.daemon.port}/agents`, {
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) {
      const json = (await res.json()) as { agents?: unknown };
      if (Array.isArray(json.agents)) return json.agents as ActiveAgent[];
    }
  } catch {
    // fall through to disk
  }

  // Disk fallback: mirrors /api/agents/route.ts so the two paths stay
  // in sync. Validates each file so a malformed write surfaces as a
  // warning rather than corrupting the SSR payload.
  const stateDir = userStateDir();
  let entries: string[];
  try {
    entries = await fs.readdir(stateDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const now = Math.floor(Date.now() / 1000);
  const agents: ActiveAgent[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    let raw: string;
    try {
      raw = await fs.readFile(path.join(stateDir, name), "utf8");
    } catch {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const result = ActiveAgentSchema.safeParse(parsed);
    if (!result.success) continue;
    const a = result.data;
    const ts = typeof a.lastActiveAt === "number" ? a.lastActiveAt : a.startedAt;
    if (now - ts > config.staleAgentSeconds) continue;
    agents.push(a);
  }
  agents.sort((a, b) => a.startedAt - b.startedAt);
  return agents;
}
