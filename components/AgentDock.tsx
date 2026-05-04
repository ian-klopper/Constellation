/**
 * Compact top-right indicator for agents with no tile to anchor to.
 * Hidden when empty. Shows up to MAX_VISIBLE overlapping avatars in
 * a single row; beyond that, a +N pill. Detail comes from hover/focus
 * popover. Agents that land on visible tiles are handled by AgentOverlay
 * instead (they render directly on the tile via icons + thought bubbles).
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { DOCK } from "@/lib/constants";
import { useAgentStream } from "@/hooks/useAgentStream";
import { useAgentLifecycle } from "@/hooks/useAgentLifecycle";
import { useIdleClock } from "@/hooks/useIdleClock";
import { useTileRegistry } from "@/components/TileRegistry";
import { AgentDockEntry } from "./AgentDockEntry";
import type { ActiveAgent } from "@/lib/types";

export function AgentDock({
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

  const lifecycleAgents = useAgentLifecycle(filtered);

  const now = useIdleClock();

  const registry = useTileRegistry();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const unsub = registry.subscribe(() => setTick((t) => t + 1));
    return unsub;
  }, [registry]);

  const unanchored = useMemo(() => {
    // An agent is un-anchored if it has no currentPath OR the currentPath
    // doesn't resolve to a visible tile in the registry.
    return lifecycleAgents.filter((a) => {
      if (!a.currentPath) return true;
      const tile = registry.get(a.currentPath);
      return tile === null;
    });
  }, [lifecycleAgents, registry, tick]);

  const sorted = useMemo(
    () => [...unanchored].sort((a, b) => b.startedAt - a.startedAt),
    [unanchored],
  );

  if (sorted.length === 0) return null;

  const visible = sorted.slice(0, DOCK.MAX_VISIBLE);
  const hidden = sorted.length - DOCK.MAX_VISIBLE;

  return (
    <div data-agent-dock className="flex items-center gap-0">
      {/* Avatars with negative margin for overlap effect */}
      <div className="flex" style={{ marginRight: -DOCK.AVATAR_OVERLAP }}>
        {visible.map((agent, idx) => (
          <div
            key={agent.key}
            style={{
              marginLeft: idx === 0 ? 0 : -DOCK.AVATAR_OVERLAP,
              zIndex: visible.length - idx,
            }}
          >
            <AgentDockEntry agent={agent} now={now} />
          </div>
        ))}
      </div>

      {/* +N pill if there are hidden agents */}
      {hidden > 0 && (
        <span
          className="ml-0.5 inline-flex items-center justify-center rounded-full bg-zinc-200 text-[9px] font-semibold text-zinc-600"
          style={{
            width: DOCK.AVATAR_SIZE,
            height: DOCK.AVATAR_SIZE,
          }}
        >
          +{hidden}
        </span>
      )}
    </div>
  );
}
