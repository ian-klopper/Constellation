/**
 * One avatar in the agent dock — a small colored circle with a glyph.
 * Hover/focus opens a popover below showing type label, tool·path,
 * up to 3 lines of thought, and a "silent Xs" warning if stale.
 * State machine: single `open` boolean plus `closeTimerRef` for
 * debounced close-on-leave. Popover itself also calls openNow/scheduleClose
 * on its own pointer events so cursor travel from avatar → popover keeps
 * the popover open.
 */
"use client";

import { memo, useEffect, useRef, useState } from "react";
import { DOCK, OVERLAY_TIMING, OVERLAY_MOTION } from "@/lib/constants";
import { agentColor } from "@/lib/agent-colors";
import type { DisplayAgent } from "@/hooks/useAgentLifecycle";

const { IDLE_DEBOUNCE_MS, STALE_VISUAL_THRESHOLD_S } = OVERLAY_TIMING;
const { OPACITY_MS } = OVERLAY_MOTION;

type Props = {
  agent: DisplayAgent;
  now: number;
};

export const AgentDockEntry = memo(function AgentDockEntry({
  agent,
  now,
}: Props) {
  const [open, setOpen] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  const openNow = () => {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setOpen(true);
  };

  const scheduleClose = () => {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
      closeTimerRef.current = null;
    }, DOCK.POPOVER_DELAY_MS);
  };

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  const idle = isIdle(agent, now);
  const silent = Math.max(
    0,
    now / 1000 - (agent.lastActiveAt ?? agent.startedAt),
  );
  const isStale = silent > STALE_VISUAL_THRESHOLD_S;
  const opacity = idle || isStale ? 0.55 : 1;

  const { ringClass } = agentColor(agent);

  const isMain = agent.id === "main";
  const glyph = isMain ? "●" : (agent.subagent_type || "?").charAt(0).toUpperCase();

  const typeLabel = agent.subagent_type || (isMain ? "main" : agent.id);

  const bubbleText =
    agent.currentThought?.trim() ||
    agent.currentActivity?.trim() ||
    agent.currentMessage?.trim() ||
    agent.description?.trim() ||
    agent.subagent_type ||
    "";

  const toolPath = formatToolPath(agent);

  return (
    <div className="relative">
      {/* Avatar button */}
      <button
        onPointerEnter={openNow}
        onPointerLeave={scheduleClose}
        onFocus={openNow}
        onBlur={scheduleClose}
        onClick={() => {
          if (open) {
            scheduleClose();
          } else {
            openNow();
          }
        }}
        className={`inline-flex items-center justify-center rounded-full font-semibold text-white shadow-lg ring-2 ring-white transition-opacity ${ringClass}`}
        style={{
          width: DOCK.AVATAR_SIZE,
          height: DOCK.AVATAR_SIZE,
          fontSize: "11px",
          opacity,
          transition: `opacity ${OPACITY_MS}ms ease-out`,
          cursor: "pointer",
        }}
        title={`${typeLabel} agent`}
        aria-label={`${typeLabel} agent`}
      >
        {glyph}
      </button>

      {/* Popover */}
      {open && (
        <div
          onPointerEnter={openNow}
          onPointerLeave={scheduleClose}
          className="absolute top-full left-1/2 z-50 mt-2 -translate-x-1/2 rounded-lg bg-white shadow-lg border border-zinc-200"
          style={{
            width: DOCK.POPOVER_WIDTH,
            minWidth: "fit-content",
          }}
        >
          <div className="px-3 py-2">
            {/* Type label */}
            <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">
              {typeLabel}
            </div>

            {/* Tool · Path or (no file) */}
            {toolPath ? (
              <div className="mt-1 truncate text-[12px] font-medium text-zinc-800">
                {toolPath}
              </div>
            ) : (
              <div className="mt-1 text-[12px] text-zinc-500 italic">
                (no file)
              </div>
            )}

            {/* Thought / activity (up to 3 lines) */}
            {bubbleText && (
              <p
                className="mt-1 line-clamp-3 text-[12px] leading-snug text-zinc-600"
                title={bubbleText}
              >
                {bubbleText}
              </p>
            )}

            {/* Stale warning */}
            {isStale && (
              <div className="mt-1 text-[10px] text-zinc-400">
                silent {Math.floor(silent)}s
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

function isIdle(a: DisplayAgent, now: number): boolean {
  if (a.status !== "idle") return false;
  const since = a.lastActiveAt ?? a.startedAt;
  return now - since * 1000 >= IDLE_DEBOUNCE_MS;
}

function formatToolPath(a: DisplayAgent): string {
  const tool = a.currentTool?.trim();
  const p = a.currentPath?.trim();
  if (tool && p) return `${tool} · ${p}`;
  if (tool) return tool;
  if (p) return p;
  return "";
}
