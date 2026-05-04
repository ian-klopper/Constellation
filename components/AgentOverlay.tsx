/**
 * Minimal pinpoint layer for live agent icons. Renders one colored dot
 * per anchored agent (those whose currentPath resolves to a visible tile).
 * Agents with no tile position appear only in the AgentDock — this overlay
 * no longer renders a dock or bubbles. Icon positions are viewport-clamped
 * via useAgentPositions so agents on edge tiles never clip outside the
 * visualizer container.
 */
"use client";

import { useMemo } from "react";
import { OVERLAY, OVERLAY_TIMING, OVERLAY_MOTION } from "@/lib/constants";
import { AgentIcon } from "./AgentIcon";
import { ThoughtBubble } from "./ThoughtBubble";
import { agentColor } from "@/lib/agent-colors";
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

  // Group anchored agents by their (rounded) screen position so two or more
  // agents on the same tile get vertically-stacked bubbles instead of fully
  // overlapping text. Sorted by startedAt within each group so a freshly-spawned
  // agent always lands on top of the stack rather than swapping older bubbles.
  const stackIndexByKey = new Map<string, number>();
  {
    const groups = new Map<string, DisplayAgent[]>();
    for (const a of anchored) {
      const pos = positions.get(a.key)!;
      const k = `${Math.round(pos.x)}__${Math.round(pos.y)}`;
      const arr = groups.get(k);
      if (arr) arr.push(a);
      else groups.set(k, [a]);
    }
    for (const arr of groups.values()) {
      arr.sort((x, y) => x.startedAt - y.startedAt);
      arr.forEach((a, i) => stackIndexByKey.set(a.key, i));
    }
  }

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
        const bubbleText =
          a.currentThought?.trim() ||
          a.currentActivity?.trim() ||
          a.currentMessage?.trim() ||
          a.description?.trim() ||
          a.subagent_type ||
          "";
        const { borderClass } = agentColor(a);
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
              <ThoughtBubble
                text={bubbleText}
                colorClass={borderClass}
                stackIndex={stackIndexByKey.get(a.key) ?? 0}
              />
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
