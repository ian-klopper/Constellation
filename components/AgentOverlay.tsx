/**
 * The floating Claude badges that sit on top of the map and slide between
 * files to show you what each AI is reading or editing right now. Idle
 * agents park in a row at the top of the page. Composed of small hooks
 * (polling/lifecycle/positions/idle-clock) plus presentation components
 * (AgentIcon/AgentBubble) — this file is just the orchestrator.
 */
"use client";

import { useMemo } from "react";
import { OVERLAY, OVERLAY_TIMING, OVERLAY_MOTION } from "@/lib/constants";
import { AgentIcon } from "./AgentIcon";
import { AgentBubble } from "./AgentBubble";
import { useAgentStream } from "@/hooks/useAgentStream";
import {
  useAgentLifecycle,
  type DisplayAgent,
} from "@/hooks/useAgentLifecycle";
import { useAgentPositions } from "@/hooks/useAgentPositions";
import { useIdleClock } from "@/hooks/useIdleClock";

const { ICON_SIZE } = OVERLAY;
const { IDLE_DEBOUNCE_MS, MOUNT_FADE_MS } = OVERLAY_TIMING;
const { TRANSFORM_MS, OPACITY_MS, EASING } = OVERLAY_MOTION;

export function AgentOverlay({ root }: { root: string }) {
  const { agents: allAgents } = useAgentStream();
  // Only show agents whose owning repo is the one currently being
  // visualized — agents from a different repo would have currentPaths
  // relative to a tree we aren't rendering, so they'd land at (0,0)
  // anyway. Filtering here keeps the React tree clean.
  const filtered = useMemo(
    () => allAgents.filter((a) => a.cwd === root),
    [allAgents, root],
  );
  const agents = useAgentLifecycle(filtered);
  const positions = useAgentPositions(agents);
  const now = useIdleClock();

  if (agents.length === 0) return null;

  return (
    <div
      data-agent-overlay
      className="pointer-events-none fixed inset-0 z-50"
    >
      {agents.map((a) => {
        const pos = positions.get(a.key);
        if (!pos) return null;
        const isFading = a.removingAt !== undefined;
        const isMounting = now - a.mountedAt < MOUNT_FADE_MS;
        const idle = isIdle(a, now);
        const opacity = isFading || isMounting || idle ? 0 : 1;
        return (
          <div
            key={a.key}
            className="absolute"
            style={{
              left: 0,
              top: 0,
              transform: `translate(${pos.x}px, ${pos.y}px)`,
              transition: `transform ${TRANSFORM_MS}ms ${EASING}, opacity ${OPACITY_MS}ms ease-out`,
              opacity,
              willChange: "transform, opacity",
            }}
          >
            <div
              className="relative"
              style={{ width: ICON_SIZE, height: ICON_SIZE }}
            >
              <AgentIcon agent={a} idle={idle} />
              <AgentBubble agent={a} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function isIdle(a: DisplayAgent, now: number): boolean {
  if (a.status !== "idle") return false;
  const since = a.lastActiveAt ?? a.startedAt;
  // lastActiveAt is server-stamped in seconds; bring it into ms for the compare.
  return now - since * 1000 >= IDLE_DEBOUNCE_MS;
}
