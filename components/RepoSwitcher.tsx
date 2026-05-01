/**
 * Top-left chrome that names the repo currently being visualized and
 * lets the user arrow between repos that have at least one active
 * Claude Code session. Hidden arrow controls when there's only the
 * current repo (the empty-state default — keeps continuity with v0).
 *
 * Accepts a server-rendered initial repo list so the very first paint
 * reflects what the daemon already knew. After mount, subscribes to
 * the same SSE stream the agent overlay uses so the list stays live
 * as new sessions start and stop.
 */
"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import type { RepoSummary } from "@/lib/types";
import { useAgentStream } from "@/hooks/useAgentStream";

export function RepoSwitcher({
  current,
  repos: initialRepos,
}: {
  current: string;
  repos: RepoSummary[];
}) {
  const router = useRouter();
  const { repos: liveRepos } = useAgentStream();
  const repos = useMemo(
    () => mergeRepos(current, initialRepos, liveRepos),
    [current, initialRepos, liveRepos],
  );

  const currentIndex = repos.findIndex((r) => r.repoPath === current);
  const idx = currentIndex < 0 ? 0 : currentIndex;
  const currentName =
    repos[idx]?.repoName ?? basename(current) ?? "Constellation";
  const showArrows = repos.length > 1;

  const go = (offset: number) => {
    const next = repos[(idx + offset + repos.length) % repos.length];
    if (!next || next.repoPath === current) return;
    router.push(`/?repo=${encodeURIComponent(next.repoPath)}`);
  };

  return (
    <div className="flex items-center gap-3">
      <span className="text-zinc-700 normal-case tracking-normal text-sm font-medium">
        {currentName}
      </span>
      {showArrows && (
        <span className="flex items-center gap-1 text-zinc-400">
          <button
            type="button"
            onClick={() => go(-1)}
            className="rounded px-1 py-0.5 hover:bg-zinc-100 hover:text-zinc-700"
            aria-label="Previous repo"
          >
            ←
          </button>
          <span className="tabular-nums text-[10px] text-zinc-500">
            {idx + 1}/{repos.length}
          </span>
          <button
            type="button"
            onClick={() => go(1)}
            className="rounded px-1 py-0.5 hover:bg-zinc-100 hover:text-zinc-700"
            aria-label="Next repo"
          >
            →
          </button>
        </span>
      )}
    </div>
  );
}

// Live list always wins for repos the daemon knows about, but we always
// keep the current-viewing repo at index 0 so the user never gets
// "stranded" on a repo the daemon forgot about (e.g. all sessions ended).
function mergeRepos(
  current: string,
  initial: RepoSummary[],
  live: RepoSummary[],
): RepoSummary[] {
  const out: RepoSummary[] = [];
  const seen = new Set<string>();

  const currentInLive = live.find((r) => r.repoPath === current);
  const currentInInitial = initial.find((r) => r.repoPath === current);
  const currentRow: RepoSummary =
    currentInLive ??
    currentInInitial ?? {
      repoPath: current,
      repoName: basename(current) ?? current,
      sessionCount: 0,
      agentCount: 0,
      lastActiveAt: 0,
    };
  out.push(currentRow);
  seen.add(current);

  for (const r of live) {
    if (seen.has(r.repoPath)) continue;
    out.push(r);
    seen.add(r.repoPath);
  }
  return out;
}

function basename(p: string): string | null {
  if (!p) return null;
  // Tiny inlined basename — avoids pulling node:path into the client bundle.
  // Strip a trailing slash, then take everything after the last slash.
  const cleaned = p.endsWith("/") ? p.slice(0, -1) : p;
  const idx = cleaned.lastIndexOf("/");
  const out = idx < 0 ? cleaned : cleaned.slice(idx + 1);
  return out || null;
}
