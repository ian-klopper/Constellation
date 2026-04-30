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
            <div
              className="relative"
              style={{ width: ICON_SIZE, height: ICON_SIZE }}
            >
              <AgentIcon agent={a} />
              {a.id !== "main" && a.kind !== "background" && (
                <AgentBubble agent={a} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AgentIcon({ agent }: { agent: ActiveAgent }) {
  const isMain = agent.id === "main";
  const isBg = agent.kind === "background";
  const glyph = isMain
    ? "●"
    : (agent.subagent_type || "?").charAt(0).toUpperCase();
  const tooltip = isMain
    ? `Claude · ${agent.currentPath ?? "idle"}`
    : isBg
      ? `${agent.subagent_type} (background) · ${agent.description}`
      : agent.currentPath
        ? `${agent.subagent_type} · ${agent.currentPath}`
        : `${agent.subagent_type} · ${agent.description}`;
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
      <span className={`absolute inset-0 -z-10 animate-ping rounded-full ${ping} opacity-60`} />
    </div>
  );
}

function AgentBubble({ agent }: { agent: ActiveAgent }) {
  const text = agent.description?.trim() || agent.subagent_type;
  if (!text) return null;
  return (
    <div className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2">
      <div className="relative whitespace-nowrap rounded-sm border border-zinc-300 bg-white px-2 py-1 text-[11px] leading-none text-zinc-800 shadow-sm">
        <span className="block max-w-[24ch] truncate">{text}</span>
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
