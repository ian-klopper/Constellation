/**
 * Like useAgentLifecycle, but with a much longer drop window — agents
 * stay in the returned list for CONSTELLATION.FOSSIL_LIFETIME_MS after
 * they disappear from the snapshot, with a `fossilStart` timestamp set.
 *
 * This powers ConstellationOverlay, which keeps drawing a finished
 * agent's trail (fading out) for ~30 s so you can see what it just did
 * after the icon itself has vanished. The agent icon overlay continues
 * to use useAgentLifecycle (400 ms fade) — fossil lifetime is a
 * trail-only concern, the two timelines are independent.
 */
"use client";

import { useEffect, useState } from "react";
import { CONSTELLATION } from "@/lib/constants";
import type { ActiveAgent } from "@/lib/types";

export type FossilAgent = ActiveAgent & {
  /** Stable per-agent client key, mirrors useAgentLifecycle. */
  key: string;
  /**
   * Wall-clock ms when this agent left the live snapshot. Undefined for
   * live agents — set the moment a snapshot stops listing them.
   */
  fossilStart?: number;
};

export function useFossilizedAgents(snapshot: ActiveAgent[]): FossilAgent[] {
  const [agents, setAgents] = useState<FossilAgent[]>([]);

  useEffect(() => {
    setAgents((prev) => merge(prev, snapshot));
  }, [snapshot]);

  // Reap fossils whose lifetime has elapsed. Re-checked whenever the list
  // changes; one timer per re-render is fine because the list churn rate
  // is low (≤1 Hz from the SSE side).
  useEffect(() => {
    const fossils = agents.filter((a) => a.fossilStart !== undefined);
    if (fossils.length === 0) return;
    const id = setTimeout(() => {
      const cutoff = Date.now() - CONSTELLATION.FOSSIL_LIFETIME_MS;
      setAgents((prev) =>
        prev.filter(
          (a) => a.fossilStart === undefined || a.fossilStart >= cutoff,
        ),
      );
    }, CONSTELLATION.FOSSIL_LIFETIME_MS + 200);
    return () => clearTimeout(id);
  }, [agents]);

  return agents;
}

function merge(prev: FossilAgent[], next: ActiveAgent[]): FossilAgent[] {
  const now = Date.now();
  const prevByKey = new Map(prev.map((a) => [a.key, a]));
  const nextKeys = new Set(next.map(keyOf));

  const merged: FossilAgent[] = next.map((a) => ({
    ...a,
    key: keyOf(a),
    fossilStart: undefined,
  }));

  for (const a of prev) {
    if (nextKeys.has(a.key)) continue;
    const fossilStart = a.fossilStart ?? now;
    if (now - fossilStart >= CONSTELLATION.FOSSIL_LIFETIME_MS) continue;
    merged.push({ ...a, fossilStart });
  }

  merged.sort((x, y) => x.startedAt - y.startedAt);
  return merged;
}

function keyOf(a: ActiveAgent): string {
  return `${a.sessionId}:${a.id}`;
}
