/**
 * The permanent right-side activity panel. Shows one row per live
 * agent with a colored dot, current tool and file, and up to three
 * lines of the agent's latest thought. The count in the header
 * reflects only what is actually running right now — when the daemon
 * removes an agent (clean Stop or stale-sweep), the row fades out via
 * useAgentLifecycle's 400ms removingAt window and the count drops.
 * Fossil-trail rendering belongs to ConstellationOverlay, not here.
 *
 * Collapses to a narrow strip with a vertical "ACTIVITY" label when
 * no agents are present so the visualizer canvas keeps its full
 * width during idle periods.
 */
"use client";

import { useEffect, useMemo, useRef } from "react";
import { RAIL } from "@/lib/constants";
import { useAgentStream } from "@/hooks/useAgentStream";
import { useAgentLifecycle } from "@/hooks/useAgentLifecycle";
import { useIdleClock } from "@/hooks/useIdleClock";
import { AgentRailRow } from "./AgentRailRow";
import type { ActiveAgent } from "@/lib/types";

const { WIDTH, COLLAPSED_WIDTH, EXPAND_MS } = RAIL;

export function AgentRail({
  root,
  initialAgents,
}: {
  root: string;
  initialAgents?: ActiveAgent[];
}) {
  const { agents: allAgents } = useAgentStream(initialAgents);

  const filtered = useMemo(
    () => allAgents.filter((a) => a.cwd === root),
    [allAgents, root],
  );

  // useAgentLifecycle gives us mountedAt / removingAt for fade tracking.
  // Its 400ms removingAt window is the only fade-out the rail needs —
  // fossils belong to the trail overlay, not the rail.
  const lifecycleAgents = useAgentLifecycle(filtered);

  const now = useIdleClock();

  const liveAgents = useMemo(
    () => [...lifecycleAgents].sort((a, b) => b.startedAt - a.startedAt),
    [lifecycleAgents],
  );

  const isEmpty = liveAgents.length === 0;

  // ---- Auto-scroll to most-recently-mutated agent ----
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const prevLastActiveRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    // Find the agent whose lastActiveAt changed most recently.
    let mostRecentKey: string | null = null;
    let mostRecentTs = -Infinity;

    for (const a of liveAgents) {
      const ts = a.lastActiveAt ?? a.startedAt;
      const prev = prevLastActiveRef.current.get(a.key) ?? -1;
      if (ts > prev && ts > mostRecentTs) {
        mostRecentTs = ts;
        mostRecentKey = a.key;
      }
    }

    // Update the ref map for next comparison.
    prevLastActiveRef.current = new Map(
      liveAgents.map((a) => [a.key, a.lastActiveAt ?? a.startedAt]),
    );

    if (!mostRecentKey) return;
    const el = container.querySelector<HTMLElement>(
      `[data-agent-key="${mostRecentKey}"]`,
    );
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [liveAgents]);

  return (
    <aside
      data-agent-rail
      className="flex shrink-0 flex-col border-l border-zinc-200 bg-white"
      style={{
        width: isEmpty ? COLLAPSED_WIDTH : WIDTH,
        transition: `width ${EXPAND_MS}ms ease-out`,
        // Rail sits as a flex sibling of the visualizer column — overflow
        // must be hidden at this level so the collapsing animation clips
        // content cleanly rather than leaving text hanging outside.
        overflow: "hidden",
      }}
    >
      {isEmpty ? (
        // Collapsed empty state: vertical "ACTIVITY" label centered in the strip.
        <div className="flex flex-1 items-center justify-center">
          <span
            className="select-none text-[10px] font-medium uppercase tracking-widest text-zinc-400"
            style={{ writingMode: "vertical-lr", transform: "rotate(180deg)" }}
          >
            Activity
          </span>
        </div>
      ) : (
        <>
          {/* Rail header */}
          <div
            className="flex shrink-0 items-center border-b border-zinc-100 px-3"
            style={{ height: RAIL.HEADER_HEIGHT }}
          >
            <span className="text-[10px] font-medium uppercase tracking-widest text-zinc-400">
              Activity
            </span>
            <span className="ml-auto tabular-nums text-[10px] text-zinc-400">
              {liveAgents.length}
            </span>
          </div>

          {/* Scrollable row list */}
          <div
            ref={scrollContainerRef}
            className="flex-1 divide-y divide-zinc-100 overflow-y-auto"
          >
            {liveAgents.map((a) => (
              <div key={a.key} data-agent-key={a.key}>
                <AgentRailRow agent={a} now={now} />
              </div>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}
