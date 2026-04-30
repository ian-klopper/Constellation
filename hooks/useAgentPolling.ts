/**
 * Polls /api/agents at a fixed interval and returns the latest snapshot.
 * Phase 7 swaps this for useAgentStream (SSE), at which point the only
 * difference will be how the snapshot arrives — the shape stays identical.
 */
"use client";

import { useEffect, useState } from "react";
import type { ActiveAgent } from "@/lib/types";

export function useAgentPolling(intervalMs: number): ActiveAgent[] {
  const [snapshot, setSnapshot] = useState<ActiveAgent[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/agents", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { agents: ActiveAgent[] };
        if (cancelled) return;
        setSnapshot(json.agents);
      } catch {
        // network blip — try again on the next interval
      }
    }
    poll();
    const id = setInterval(poll, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [intervalMs]);

  return snapshot;
}
