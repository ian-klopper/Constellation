/**
 * The home page — the only page in the app. Reads the whole project on
 * the server, then hands the result to the map and the live-agent
 * display. Accepts ?repo=<absolute-path> to switch which repo is being
 * visualized; falls back to `process.cwd()` (the install root, under
 * self-dev) when the param is missing or invalid.
 */
import path from "node:path";
import { existsSync } from "node:fs";
import { scanProject, countTree } from "@/lib/scan";
import { Visualizer } from "@/components/Visualizer";
import { RepoSwitcher } from "@/components/RepoSwitcher";
import { DetailSlider } from "@/components/DetailSlider";
import { RoadmapToggle } from "@/components/RoadmapToggle";
import { fetchRepos } from "@/lib/daemon-client";
import { readRoadmap } from "@/lib/roadmap";
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

  const [tree, daemonRepos, roadmap] = await Promise.all([
    scanProject(root),
    fetchRepos(),
    readRoadmap(root),
  ]);
  const stats = countTree(tree.tree);
  const repos = mergeRepos(root, daemonRepos);

  return (
    <main className="flex h-screen flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-zinc-200 px-6 py-3 text-[11px] uppercase tracking-wider text-zinc-500">
        <RepoSwitcher current={root} repos={repos} />
        <div className="flex items-center gap-6">
          <DetailSlider />
          {roadmap && <RoadmapToggle data={roadmap} />}
          <span className="text-right">
            {stats.dirs} directories · {stats.files} files · {stats.lines} lines
          </span>
        </div>
      </header>
      <div className="min-h-0 flex-1">
        <Visualizer tree={tree} root={root} />
      </div>
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
// top-left to render the current repo's name.
function mergeRepos(
  current: string,
  daemonRepos: RepoSummary[],
): RepoSummary[] {
  const out: RepoSummary[] = [];
  const seen = new Set<string>();
  if (!daemonRepos.some((r) => r.repoPath === current)) {
    out.push({
      repoPath: current,
      repoName: path.basename(current) || current,
      sessionCount: 0,
      agentCount: 0,
      lastActiveAt: 0,
    });
    seen.add(current);
  }
  for (const r of daemonRepos) {
    if (seen.has(r.repoPath)) continue;
    out.push(r);
    seen.add(r.repoPath);
  }
  return out;
}
