/**
 * Minimal pinpoint layer for live agent icons. Renders one colored dot
 * per anchored agent (those whose currentPath resolves to a visible tile).
 * Agents with no tile position appear only in the AgentRail — this overlay
 * no longer renders a dock or bubbles. Icon positions are viewport-clamped
 * via useAgentPositions so agents on edge tiles never clip outside the
 * visualizer container.
 */
"use client";

import { useMemo } from "react";
import { OVERLAY, OVERLAY_TIMING, OVERLAY_MOTION } from "@/lib/constants";
import { AgentIcon } from "./AgentIcon";
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

export function AgentOverlay({
  root,
  container,
}: {
  root: string;
  container: HTMLElement | null;
}) {
  const { agents: allAgents } = useAgentStream();
  const filtered = useMemo(
    () => allAgents.filter((a) => a.cwd === root),
    [allAgents, root],
  );
  const agents = useAgentLifecycle(filtered);
  const positions = useAgentPositions(agents, container);
  const now = useIdleClock();

  if (agents.length === 0) return null;

  const anchored = agents.filter((a) => positions.has(a.key));

  return (
    <div
      data-agent-overlay
      className="pointer-events-none fixed inset-0 z-50"
    >
      {anchored.map((a) => {
        const pos = positions.get(a.key)!;
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
  return now - since * 1000 >= IDLE_DEBOUNCE_MS;
}
