"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import type { ActiveAgent } from "@/lib/types";

const ICON_SIZE = 28;
const PARK_TOP = 56;
const PARK_RIGHT = 16;
const STACK_OFFSET = 14;

type Pos = { x: number; y: number };

export function AgentOverlay() {
  const [agents, setAgents] = useState<ActiveAgent[]>([]);
  const [positions, setPositions] = useState<Map<string, Pos>>(new Map());

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/agents", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { agents: ActiveAgent[] };
        if (!cancelled) setAgents(json.agents);
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

  if (agents.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-50">
      {agents.map((a) => {
        const pos = positions.get(a.id);
        if (!pos) return null;
        return (
          <div
            key={a.id}
            className="absolute"
            style={{
              left: 0,
              top: 0,
              transform: `translate(${pos.x}px, ${pos.y}px)`,
              transition: "transform 450ms cubic-bezier(0.4, 0, 0.2, 1)",
              willChange: "transform",
            }}
          >
            <AgentIcon agent={a} />
          </div>
        );
      })}
    </div>
  );
}

function AgentIcon({ agent }: { agent: ActiveAgent }) {
  const letter = (agent.subagent_type || "?").charAt(0).toUpperCase();
  const tooltip = agent.currentPath
    ? `${agent.subagent_type} · ${agent.currentPath}`
    : `${agent.subagent_type} · ${agent.description}`;
  return (
    <div
      title={tooltip}
      className="pointer-events-auto relative flex items-center justify-center rounded-full bg-emerald-500 text-[12px] font-semibold text-white shadow-lg ring-2 ring-white"
      style={{ width: ICON_SIZE, height: ICON_SIZE }}
    >
      {letter}
      <span className="absolute inset-0 -z-10 animate-ping rounded-full bg-emerald-400 opacity-60" />
    </div>
  );
}

function computePositions(agents: ActiveAgent[]): Map<string, Pos> {
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
