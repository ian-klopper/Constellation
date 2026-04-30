/**
 * Top-of-page badge bar listing every currently-running Claude Code agent —
 * the main agent, foreground subagents, and background subagents — with a
 * one-line description. Polls /api/agents once a second.
 */
"use client";

import { useEffect, useState } from "react";
import type { ActiveAgent } from "@/lib/types";

export function ActiveAgents() {
  const [agents, setAgents] = useState<ActiveAgent[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        const res = await fetch("/api/agents", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { agents: ActiveAgent[] };
        if (!cancelled) setAgents(json.agents);
      } catch {
        // network blip — try again next tick
      }
    }

    tick();
    const id = setInterval(tick, 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (agents.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 border-b border-zinc-200 px-6 py-2 text-[11px] text-zinc-700">
      {agents.map((a) => {
        const isMain = a.id === "main";
        const isBg = a.kind === "background";
        const dot = isMain
          ? "bg-sky-500"
          : isBg
            ? "bg-amber-500"
            : "bg-emerald-500";
        const label = isMain
          ? "claude"
          : isBg
            ? `${a.subagent_type} (bg)`
            : a.subagent_type;
        const detail = isMain ? (a.currentPath ?? "idle") : a.description;
        return (
          <span
            key={a.id}
            className="inline-flex items-center gap-2 rounded-sm border border-zinc-300 bg-white/60 px-2 py-1"
          >
            <span className={`size-1.5 rounded-full ${dot} animate-pulse`} />
            <span className="uppercase tracking-wider text-zinc-500">
              {label}
            </span>
            <span className="truncate max-w-[28ch] text-zinc-700">
              {detail}
            </span>
          </span>
        );
      })}
    </div>
  );
}
