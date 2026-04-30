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
      {agents.map((a) => (
        <span
          key={a.id}
          className="inline-flex items-center gap-2 rounded-sm border border-zinc-300 bg-white/60 px-2 py-1"
        >
          <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="uppercase tracking-wider text-zinc-500">
            {a.subagent_type}
          </span>
          <span className="truncate max-w-[28ch] text-zinc-700">
            {a.description}
          </span>
        </span>
      ))}
    </div>
  );
}
