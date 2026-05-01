/**
 * Tiny server-side helpers for hitting the local daemon. Both calls
 * have a short timeout and silently degrade to an empty list when the
 * daemon is down — the visualizer keeps rendering the current repo's
 * tree either way, just without live agent visibility.
 */
import "server-only";
import { loadConfig } from "./config";
import type { ActiveAgent, AgentsPayload, RepoSummary } from "./types";

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

export async function fetchAgents(): Promise<AgentsPayload | null> {
  const config = loadConfig();
  try {
    const res = await fetch(`http://127.0.0.1:${config.daemon.port}/agents`, {
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as Partial<AgentsPayload>;
    if (!Array.isArray(json.agents)) return null;
    return {
      agents: json.agents as ActiveAgent[],
      repos: Array.isArray(json.repos) ? json.repos : [],
    };
  } catch {
    return null;
  }
}
