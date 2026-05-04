/**
 * The home page — the only page in the app. Reads the whole project on
 * the server, then hands the result to the map and the live-agent
 * display. Accepts ?repo=<absolute-path> to switch which repo is being
 * visualized; falls back to `process.cwd()` (the install root, under
 * self-dev) when the param is missing or invalid.
 */
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";

const BUILD_ID = (() => {
  try {
    return readFileSync(
      path.join(process.cwd(), ".next", "BUILD_ID"),
      "utf8",
    )
      .trim()
      .slice(0, 6);
  } catch {
    return "dev";
  }
})();
import { scanProject, countTree } from "@/lib/scan";
import { Visualizer } from "@/components/Visualizer";
import { RepoSwitcher } from "@/components/RepoSwitcher";
import { DetailSlider } from "@/components/DetailSlider";
import { LiveDescriptionsBridge } from "@/components/LiveDescriptionsContext";
import { RoadmapToggle } from "@/components/RoadmapToggle";
import { fetchRepos, fetchAgents } from "@/lib/daemon-client";
import { AgentRail } from "@/components/AgentRail";
import { TileActivityProvider } from "@/hooks/useTileActivity";
import { readRoadmap } from "@/lib/roadmap";
import { listWorktrees } from "@/lib/worktrees";
import type { RepoSummary } from "@/lib/types";

type SearchParams = Promise<{ repo?: string | string[] }>;

export default async function HomePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const requested = Array.isArray(params.repo) ? params.repo[0] : params.repo;
  const root = resolveRequestedRoot(requested, process.cwd());

  const [tree, daemonRepos, roadmap, initialAgents] = await Promise.all([
    scanProject(root),
    fetchRepos(),
    readRoadmap(root),
    fetchAgents(),
  ]);
  const stats = countTree(tree.tree);
  const worktreePaths = listWorktrees(root);
  const repos = mergeRepos(root, daemonRepos, worktreePaths);

  return (
    <main className="flex h-screen flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-zinc-200 px-6 py-3 text-[11px] uppercase tracking-wider text-zinc-500">
        <RepoSwitcher current={root} repos={repos} />
        <div className="flex items-center gap-6">
          <DetailSlider />
          {roadmap && <RoadmapToggle data={roadmap} />}
          <span className="text-right">
            {BUILD_ID} · {initialAgents.length} agents · {stats.dirs} directories · {stats.files} files · {stats.lines} lines
          </span>
        </div>
      </header>
      <TileActivityProvider root={root} initialAgents={initialAgents}>
        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <LiveDescriptionsBridge root={root}>
              <Visualizer tree={tree} root={root} />
            </LiveDescriptionsBridge>
          </div>
          <AgentRail root={root} initialAgents={initialAgents} />
        </div>
      </TileActivityProvider>
    </main>
  );
}

// Trust the searchParam only if it's an absolute path that exists. Anything
// else falls back to the cwd default. This keeps the URL surface safe (no
// path traversal) and recovers gracefully when a session whose repo just
// got removed is bookmarked.
function resolveRequestedRoot(
  requested: string | undefined,
  fallback: string,
): string {
  if (!requested) return fallback;
  if (!path.isAbsolute(requested)) return fallback;
  if (!existsSync(requested)) return fallback;
  return requested;
}

// The viewing repo always shows up first in the switcher even if the
// daemon doesn't yet know about it — that's the empty-state path
// (no active sessions ⇒ daemon returns []), and we still want the
// top-left to render the current repo's name. Worktrees of the
// viewing repo are folded in too so the user can arrow into idle
// scratch branches the daemon has never seen.
function mergeRepos(
  current: string,
  daemonRepos: RepoSummary[],
  worktreePaths: string[],
): RepoSummary[] {
  const out: RepoSummary[] = [];
  const seen = new Set<string>();
  if (!daemonRepos.some((r) => r.repoPath === current)) {
    out.push(stubRepo(current));
    seen.add(current);
  }
  for (const r of daemonRepos) {
    if (seen.has(r.repoPath)) continue;
    out.push(r);
    seen.add(r.repoPath);
  }
  for (const p of worktreePaths) {
    if (seen.has(p)) continue;
    out.push(stubRepo(p));
    seen.add(p);
  }
  return out;
}

function stubRepo(p: string): RepoSummary {
  return {
    repoPath: p,
    repoName: path.basename(p) || p,
    sessionCount: 0,
    agentCount: 0,
    lastActiveAt: 0,
  };
}
