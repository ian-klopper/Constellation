/**
 * The colored circle on top of a file tile. Sky for the main agent,
 * emerald for foreground subagents, amber for background. The "ping"
 * ring animates while the agent is active and disappears when idle.
 * Colors come from agentColor() — the single palette source.
 */
"use client";

import type { ActiveAgent } from "@/lib/types";
import { agentColor } from "@/lib/agent-colors";

export function AgentIcon({ agent, idle }: { agent: ActiveAgent; idle: boolean }) {
  const isMain = agent.id === "main";
  const isBg = agent.kind === "background";
  const glyph = isMain
    ? "●"
    : (agent.subagent_type || "?").charAt(0).toUpperCase();
  const activity =
    agent.currentActivity?.trim() ||
    agent.currentMessage?.trim() ||
    agent.description?.trim() ||
    agent.subagent_type;
  const tooltip = isMain
    ? `Claude · ${activity}`
    : isBg
      ? `${agent.subagent_type} (background) · ${activity}`
      : `${agent.subagent_type} · ${activity}`;
  const { ringClass: bg, pingClass: ping } = agentColor(agent);
  return (
    <div
      title={tooltip}
      className={`absolute inset-0 flex items-center justify-center rounded-full ${bg} text-[12px] font-semibold text-white shadow-lg ring-2 ring-white`}
    >
      {glyph}
      {!idle && (
        <span
          className={`absolute inset-0 -z-10 animate-ping rounded-full ${ping} opacity-60`}
        />
      )}
    </div>
  );
}
