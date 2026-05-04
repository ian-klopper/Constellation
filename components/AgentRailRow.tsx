/**
 * One row in the activity rail — a colored dot, the current tool and
 * file path, and up to three lines of the agent's latest thought. Idle
 * agents dim; fossil agents (recently finished) fade out.
 */
"use client";

import { memo } from "react";
import { OVERLAY, OVERLAY_TIMING, OVERLAY_MOTION } from "@/lib/constants";
import { agentColor } from "@/lib/agent-colors";
import type { DisplayAgent } from "@/hooks/useAgentLifecycle";
import type { FossilAgent } from "@/hooks/useFossilizedAgents";
import type { ActiveAgent } from "@/lib/types";

const { ICON_SIZE } = OVERLAY;
const { IDLE_DEBOUNCE_MS } = OVERLAY_TIMING;
const { OPACITY_MS } = OVERLAY_MOTION;

type Props = {
  agent: DisplayAgent | FossilAgent;
  now: number;
  fossilOpacity?: number;
};

export const AgentRailRow = memo(function AgentRailRow({
  agent,
  now,
  fossilOpacity,
}: Props) {
  const isFossil = fossilOpacity !== undefined;
  const idle = isIdle(agent, now);
  const opacity = isFossil
    ? fossilOpacity
    : idle
      ? 0.55
      : 1;

  const { ringClass } = agentColor(agent);

  const bubbleText =
    agent.currentThought?.trim() ||
    agent.currentActivity?.trim() ||
    agent.currentMessage?.trim() ||
    agent.description?.trim() ||
    agent.subagent_type ||
    "";

  const toolPath = formatToolPath(agent);

  return (
    <div
      className="flex gap-2 px-3 py-2"
      style={{
        opacity,
        transition: `opacity ${OPACITY_MS}ms ease-out`,
      }}
    >
      {/* Colored dot */}
      <div
        className={`mt-0.5 shrink-0 rounded-full ${ringClass} ring-2 ring-white`}
        style={{ width: ICON_SIZE, height: ICON_SIZE }}
        aria-hidden
      />

      {/* Text stack */}
      <div className="min-w-0 flex-1">
        {/* Agent type label */}
        <div className="truncate text-[10px] font-medium uppercase tracking-wide text-zinc-400">
          {agent.subagent_type || (agent.id === "main" ? "main" : agent.id)}
        </div>

        {/* Current tool · path */}
        {toolPath && (
          <div className="truncate text-[12px] font-medium text-zinc-800">
            {toolPath}
          </div>
        )}

        {/* Thought / activity (up to 3 lines) */}
        {bubbleText && (
          <p
            className="mt-0.5 line-clamp-3 text-[12px] leading-snug text-zinc-600"
            title={bubbleText}
          >
            {bubbleText}
          </p>
        )}
      </div>
    </div>
  );
});

function isIdle(a: ActiveAgent, now: number): boolean {
  if (a.status !== "idle") return false;
  const since = a.lastActiveAt ?? a.startedAt;
  return now - since * 1000 >= IDLE_DEBOUNCE_MS;
}

function formatToolPath(a: ActiveAgent): string {
  const tool = a.currentTool?.trim();
  const p = a.currentPath?.trim();
  if (tool && p) return `${tool} · ${p}`;
  if (tool) return tool;
  if (p) return p;
  return "";
}
