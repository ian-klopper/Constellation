/**
 * The permanent right-side activity panel. Shows one row per live or
 * recently-finished agent with a colored dot, current tool and file,
 * and up to three lines of the agent's latest thought. Overlap between
 * agents is structurally impossible because rows stack vertically inside
 * an overflow-y-auto container — there is no viewport edge for a bubble
 * to fall off. Collapses to a narrow strip with a vertical "ACTIVITY"
 * label when no agents are present so the visualizer canvas keeps its
 * full width during idle periods.
 */
"use client";

import { useEffect, useMemo, useRef } from "react";
import { RAIL, OVERLAY_TIMING } from "@/lib/constants";
import { useAgentStream } from "@/hooks/useAgentStream";
import { useAgentLifecycle } from "@/hooks/useAgentLifecycle";
import { useFossilizedAgents, type FossilAgent } from "@/hooks/useFossilizedAgents";
import { useIdleClock } from "@/hooks/useIdleClock";
import { AgentRailRow } from "./AgentRailRow";
import type { ActiveAgent } from "@/lib/types";

const { FOSSIL_LIFETIME_MS, WIDTH, COLLAPSED_WIDTH, EXPAND_MS } = RAIL;
const { IDLE_DEBOUNCE_MS } = OVERLAY_TIMING;

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
  const liveAgents = useAgentLifecycle(filtered);

  // useFossilizedAgents keeps finished agents around for FOSSIL_LIFETIME_MS
  // so recently-finished rows linger briefly before disappearing.
  const fossilAgents = useFossilizedAgents(filtered, FOSSIL_LIFETIME_MS);

  const now = useIdleClock();

  // Build a unified display list: live agents first (sorted by startedAt
  // desc so newest is at the top), then fossils not already in live.
  const liveKeys = useMemo(
    () => new Set(liveAgents.map((a) => a.key)),
    [liveAgents],
  );

  const displayAgents = useMemo(() => {
    const live = [...liveAgents].sort((a, b) => b.startedAt - a.startedAt);
    const fossils = fossilAgents.filter(
      (a) => !liveKeys.has(a.key) && a.fossilStart !== undefined,
    );
    return { live, fossils };
  }, [liveAgents, fossilAgents, liveKeys]);

  const isEmpty =
    displayAgents.live.length === 0 && displayAgents.fossils.length === 0;

  // ---- Auto-scroll to most-recently-mutated agent ----
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const prevLastActiveRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    // Find the agent whose lastActiveAt changed most recently.
    let mostRecentKey: string | null = null;
    let mostRecentTs = -Infinity;

    for (const a of displayAgents.live) {
      const ts = a.lastActiveAt ?? a.startedAt;
      const prev = prevLastActiveRef.current.get(a.key) ?? -1;
      if (ts > prev && ts > mostRecentTs) {
        mostRecentTs = ts;
        mostRecentKey = a.key;
      }
    }

    // Update the ref map for next comparison.
    prevLastActiveRef.current = new Map(
      displayAgents.live.map((a) => [a.key, a.lastActiveAt ?? a.startedAt]),
    );

    if (!mostRecentKey) return;
    const el = container.querySelector<HTMLElement>(
      `[data-agent-key="${mostRecentKey}"]`,
    );
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [displayAgents.live]);

  // ---- Fossil opacity helper ----
  function fossilOpacity(a: FossilAgent): number {
    if (a.fossilStart === undefined) return 1;
    const elapsed = now - a.fossilStart;
    if (elapsed >= FOSSIL_LIFETIME_MS) return 0;
    return 1 - elapsed / FOSSIL_LIFETIME_MS;
  }

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
              {displayAgents.live.length + displayAgents.fossils.length}
            </span>
          </div>

          {/* Scrollable row list */}
          <div
            ref={scrollContainerRef}
            className="flex-1 divide-y divide-zinc-100 overflow-y-auto"
          >
            {displayAgents.live.map((a) => (
              <div key={a.key} data-agent-key={a.key}>
                <AgentRailRow agent={a} now={now} />
              </div>
            ))}
            {displayAgents.fossils.map((a) => (
              <div key={a.key} data-agent-key={a.key}>
                <AgentRailRow
                  agent={a}
                  now={now}
                  fossilOpacity={fossilOpacity(a)}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}
