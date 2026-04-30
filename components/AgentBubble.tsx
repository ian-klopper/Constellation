/**
 * The thought-bubble above each agent icon — narrates whatever the
 * agent is currently doing (currentActivity), or its latest text
 * (currentMessage), or falls back to its subagent_type.
 */
"use client";

import { OVERLAY_MOTION } from "@/lib/constants";
import type { ActiveAgent } from "@/lib/types";

export function AgentBubble({ agent }: { agent: ActiveAgent }) {
  const text =
    agent.currentActivity?.trim() ||
    agent.currentMessage?.trim() ||
    agent.description?.trim() ||
    agent.subagent_type;
  if (!text) return null;
  return (
    <div className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2">
      <div
        className="relative whitespace-nowrap rounded-sm border border-zinc-300 bg-white px-2 py-1 text-[11px] leading-none text-zinc-800 shadow-sm"
        style={{ transition: `opacity ${OVERLAY_MOTION.BUBBLE_OPACITY_MS}ms ease-out` }}
      >
        <span className="block max-w-[28ch] truncate">{text}</span>
        <span
          aria-hidden
          className="absolute left-1/2 top-full -translate-x-1/2"
          style={{
            width: 0,
            height: 0,
            borderLeft: "5px solid transparent",
            borderRight: "5px solid transparent",
            borderTop: "5px solid rgb(212 212 216)",
          }}
        />
        <span
          aria-hidden
          className="absolute left-1/2 top-full -translate-x-1/2"
          style={{
            marginTop: -1,
            width: 0,
            height: 0,
            borderLeft: "4px solid transparent",
            borderRight: "4px solid transparent",
            borderTop: "4px solid white",
          }}
        />
      </div>
    </div>
  );
}
