/**
 * The floating Claude badges that sit on top of the map and slide between
 * files to show you what each AI is reading or editing right now. Idle
 * agents park in a row at the top of the page. Refreshes once a second.
 */
"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ActiveAgent } from "@/lib/types";

const ICON_SIZE = 28;
const PARK_TOP = 12;
const PARK_RIGHT = 16;
const STACK_OFFSET = 14;
const IDLE_DEBOUNCE_MS = 600;
const REMOVE_FADE_MS = 400;

type Pos = { x: number; y: number };

type DisplayAgent = ActiveAgent & {
  /** Wall-clock ms when this agent first showed up in the API. */
  mountedAt: number;
  /** Wall-clock ms when this agent disappeared from the API (still rendering for fade-out). */
  removingAt?: number;
};

export function AgentOverlay() {
  const [agents, setAgents] = useState<DisplayAgent[]>([]);
  const [positions, setPositions] = useState<Map<string, Pos>>(new Map());
  // Tracks when each agent first reported status:"idle" so we can debounce
  // brief active->idle->active flickers between back-to-back tool calls.
  const idleSinceRef = useRef<Map<string, number>>(new Map());
  const [, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/agents", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { agents: ActiveAgent[] };
        if (cancelled) return;
        setAgents((prev) => mergeAgents(prev, json.agents));
      } catch {
        // skip
      }
    }
    poll();
    const id = setInterval(poll, 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Drop fully-faded agents from local state once the fade window expires.
  useEffect(() => {
    const removing = agents.filter((a) => a.removingAt !== undefined);
    if (removing.length === 0) return;
    const id = setTimeout(() => {
      setAgents((prev) =>
        prev.filter(
          (a) =>
            a.removingAt === undefined ||
            Date.now() - a.removingAt < REMOVE_FADE_MS,
        ),
      );
    }, REMOVE_FADE_MS + 50);
    return () => clearTimeout(id);
  }, [agents]);

  useLayoutEffect(() => {
    setPositions(computePositions(agents));
  }, [agents]);

  useEffect(() => {
    const recompute = () => setPositions(computePositions(agents));
    window.addEventListener("resize", recompute);
    window.addEventListener("scroll", recompute, { passive: true });
    return () => {
      window.removeEventListener("resize", recompute);
      window.removeEventListener("scroll", recompute);
    };
  }, [agents]);

  // Re-render every 300ms so the idle debounce can re-evaluate even when the
  // poll didn't change the agent list. Cheap — just a counter bump.
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 300);
    return () => clearInterval(id);
  }, []);

  if (agents.length === 0) return null;

  const now = Date.now();

  return (
    <div className="pointer-events-none fixed inset-0 z-50">
      {agents.map((a) => {
        const pos = positions.get(a.id);
        if (!pos) return null;
        const isFading = a.removingAt !== undefined;
        const isMounting = now - a.mountedAt < 50;
        const isIdle = isAgentIdle(a, idleSinceRef);
        const opacity = isFading || isMounting || isIdle ? 0 : 1;
        return (
          <div
            key={a.id}
            className="absolute"
            style={{
              left: 0,
              top: 0,
              transform: `translate(${pos.x}px, ${pos.y}px)`,
              transition:
                "transform 450ms cubic-bezier(0.22, 1, 0.36, 1), opacity 350ms ease-out",
              opacity,
              willChange: "transform, opacity",
            }}
          >
            <div
              className="relative"
              style={{ width: ICON_SIZE, height: ICON_SIZE }}
            >
              <AgentIcon agent={a} idle={isIdle} />
              <AgentBubble agent={a} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AgentIcon({ agent, idle }: { agent: ActiveAgent; idle: boolean }) {
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
  const bg = isMain
    ? "bg-sky-500"
    : isBg
      ? "bg-amber-500"
      : "bg-emerald-500";
  const ping = isMain
    ? "bg-sky-400"
    : isBg
      ? "bg-amber-400"
      : "bg-emerald-400";
  return (
    <div
      title={tooltip}
      className={`pointer-events-auto absolute inset-0 flex items-center justify-center rounded-full ${bg} text-[12px] font-semibold text-white shadow-lg ring-2 ring-white`}
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

function AgentBubble({ agent }: { agent: ActiveAgent }) {
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
        style={{ transition: "opacity 200ms ease-out" }}
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

function isAgentIdle(
  agent: DisplayAgent,
  idleSinceRef: React.MutableRefObject<Map<string, number>>,
): boolean {
  const map = idleSinceRef.current;
  if (agent.status !== "idle") {
    if (map.has(agent.id)) map.delete(agent.id);
    return false;
  }
  const since = map.get(agent.id);
  const now = Date.now();
  if (since === undefined) {
    map.set(agent.id, now);
    return false;
  }
  return now - since >= IDLE_DEBOUNCE_MS;
}

/**
 * Reconcile the previous local agent list with a fresh snapshot from the API.
 * Preserves mountedAt for known agents, marks dropped ones as removing (so
 * they fade out instead of popping), and revives agents that returned during
 * the fade window.
 */
function mergeAgents(
  prev: DisplayAgent[],
  next: ActiveAgent[],
): DisplayAgent[] {
  const now = Date.now();
  const prevById = new Map(prev.map((a) => [a.id, a]));
  const nextIds = new Set(next.map((a) => a.id));

  const merged: DisplayAgent[] = next.map((a) => {
    const existing = prevById.get(a.id);
    return {
      ...a,
      mountedAt: existing?.mountedAt ?? now,
      removingAt: undefined,
    };
  });

  // Keep recently-removed agents around briefly so they can fade out.
  for (const a of prev) {
    if (nextIds.has(a.id)) continue;
    const removingAt = a.removingAt ?? now;
    if (now - removingAt >= REMOVE_FADE_MS) continue;
    merged.push({ ...a, removingAt });
  }

  // Sort to keep stack ordering deterministic across renders.
  merged.sort((x, y) => x.startedAt - y.startedAt);
  return merged;
}

function computePositions(agents: DisplayAgent[]): Map<string, Pos> {
  const map = new Map<string, Pos>();
  if (typeof window === "undefined") return map;

  const stackCount = new Map<string, number>();
  let parkIdx = 0;

  for (const a of agents) {
    const cardPos = a.currentPath ? cardPosition(a.currentPath, stackCount) : null;
    map.set(a.id, cardPos ?? parkPosition(parkIdx++));
  }
  return map;
}

function cardPosition(
  path: string,
  stackCount: Map<string, number>,
): Pos | null {
  const escaped = path.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const el = document.querySelector(
    `[data-path="${escaped}"]`,
  ) as HTMLElement | null;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const stack = stackCount.get(path) ?? 0;
  stackCount.set(path, stack + 1);
  return {
    x: rect.right - ICON_SIZE / 2 + stack * STACK_OFFSET,
    y: rect.top - ICON_SIZE / 2,
  };
}

function parkPosition(idx: number): Pos {
  return {
    x: window.innerWidth - PARK_RIGHT - ICON_SIZE - idx * (ICON_SIZE + 6),
    y: PARK_TOP,
  };
}
