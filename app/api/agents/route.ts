/**
 * Tells the page which Claude agents are working right now and which
 * repos they live in. Tries the daemon first (in-memory, always
 * fresh), falls back to reading the lifecycle JSON files from disk if
 * the daemon is down. On the disk fallback, repo summaries are derived
 * from the agents' own cwd/sessionId fields. Validates each record
 * against the shared zod schema so a malformed write surfaces as a
 * console warning instead of corrupting the UI silently.
 */
import { NextResponse } from "next/server";
import path from "node:path";
import { promises as fs } from "node:fs";
import { loadConfig, resolveStateDir, resolveTargetRoot } from "@/lib/config";
import {
  ActiveAgentSchema,
  type ActiveAgent,
  type AgentsPayload,
  type RepoSummary,
} from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  // Config is install-rooted (loadConfig reads from process.cwd(), which is
  // the install dir under the supervisor). State files live in the target.
  const config = loadConfig();

  // Try the daemon first — it's the authoritative source.
  try {
    const res = await fetch(
      `http://127.0.0.1:${config.daemon.port}/agents`,
      { cache: "no-store", signal: AbortSignal.timeout(500) },
    );
    if (res.ok) {
      const json = (await res.json()) as Partial<AgentsPayload>;
      return NextResponse.json({
        agents: Array.isArray(json.agents) ? json.agents : [],
        repos: Array.isArray(json.repos) ? json.repos : [],
      } satisfies AgentsPayload);
    }
  } catch {
    // daemon unavailable; fall through to disk
  }

  // Fallback: read the on-disk lifecycle files.
  const stateDir = resolveStateDir(resolveTargetRoot());
  let entries: string[];
  try {
    entries = await fs.readdir(stateDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({
        agents: [],
        repos: [],
      } satisfies AgentsPayload);
    }
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
    if (!result.success) {
      console.warn(
        `[/api/agents] ${name}: invalid lifecycle shape — ${result.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`,
      );
      continue;
    }
    const a = result.data;
    const ts = typeof a.lastActiveAt === "number" ? a.lastActiveAt : a.startedAt;
    if (now - ts > config.agentTtlSeconds) continue;
    agents.push(a);
  }

  agents.sort((a, b) => a.startedAt - b.startedAt);
  return NextResponse.json({
    agents,
    repos: deriveRepos(agents),
  } satisfies AgentsPayload);
}

// Disk-fallback path can't ask the daemon for repo summaries, so we
// roll the same shape from the agents we just loaded. Mirrors the
// daemon's lifecycle.repos() implementation so the client sees a
// consistent shape across modes.
function deriveRepos(agents: ActiveAgent[]): RepoSummary[] {
  const byRepo = new Map<
    string,
    RepoSummary & { sessions: Set<string> }
  >();
  for (const a of agents) {
    if (!a.cwd) continue;
    const last = a.lastActiveAt ?? a.startedAt;
    const cur = byRepo.get(a.cwd);
    if (!cur) {
      byRepo.set(a.cwd, {
        repoPath: a.cwd,
        repoName: path.basename(a.cwd) || a.cwd,
        sessionCount: 1,
        agentCount: 1,
        lastActiveAt: last,
        sessions: new Set([a.sessionId]),
      });
    } else {
      cur.agentCount += 1;
      cur.sessions.add(a.sessionId);
      cur.sessionCount = cur.sessions.size;
      cur.lastActiveAt = Math.max(cur.lastActiveAt, last);
    }
  }
  return Array.from(byRepo.values())
    .map(({ sessions: _sessions, ...rest }) => rest)
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
}
