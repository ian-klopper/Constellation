/**
 * One row in the activity rail — a colored dot, the current tool and
 * file path, and up to three lines of the agent's latest thought.
 * Agents that have been silent for STALE_VISUAL_THRESHOLD_S seconds
 * dim and show a small "silent Xs" hint, warning the user that the
 * row will be reaped by the daemon's stale sweep shortly. Idle agents
 * dim the same amount — same UX intent, "not actively doing work".
 */
"use client";

import { memo } from "react";
import { OVERLAY, OVERLAY_TIMING, OVERLAY_MOTION } from "@/lib/constants";
import { agentColor } from "@/lib/agent-colors";
import type { DisplayAgent } from "@/hooks/useAgentLifecycle";
import type { ActiveAgent } from "@/lib/types";

const { ICON_SIZE } = OVERLAY;
const { IDLE_DEBOUNCE_MS, STALE_VISUAL_THRESHOLD_S } = OVERLAY_TIMING;
const { OPACITY_MS } = OVERLAY_MOTION;

type Props = {
  agent: DisplayAgent;
  now: number;
};

export const AgentRailRow = memo(function AgentRailRow({
  agent,
  now,
}: Props) {
  const idle = isIdle(agent, now);
  const silent = Math.max(
    0,
    now / 1000 - (agent.lastActiveAt ?? agent.startedAt),
  );
  const isStale = silent > STALE_VISUAL_THRESHOLD_S;
  const opacity = idle || isStale ? 0.55 : 1;

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

        {/* Going-stale warning */}
        {isStale && (
          <div className="mt-0.5 text-[10px] text-zinc-400">
            silent {Math.floor(silent)}s
          </div>
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
