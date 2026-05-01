/**
 * Reconciles successive API snapshots into the list AgentOverlay actually
 * renders. Stamps mountedAt on first sight, marks dropped agents as
 * removingAt (so they fade out instead of popping), and drops them once
 * the fade window expires.
 *
 * Pure function of the snapshot stream — no refs mutated during render,
 * no setState inside effects that read state, just merge → setState.
 */
"use client";

import { useEffect, useState } from "react";
import { OVERLAY_TIMING } from "@/lib/constants";
import type { ActiveAgent } from "@/lib/types";

const { REMOVE_FADE_MS, REMOVE_FADE_BUFFER_MS } = OVERLAY_TIMING;

export type DisplayAgent = ActiveAgent & {
  /**
   * Stable per-agent client key. Composite of sessionId + id so two
   * parallel sessions in the same repo (each with id="main") don't
   * collide in React keys, lifecycle reconciliation, or position maps.
   */
  key: string;
  /** Wall-clock ms when this agent first showed up. */
  mountedAt: number;
  /** Wall-clock ms when this agent disappeared (still rendering for fade-out). */
  removingAt?: number;
};

export function useAgentLifecycle(snapshot: ActiveAgent[]): DisplayAgent[] {
  const [agents, setAgents] = useState<DisplayAgent[]>([]);

  useEffect(() => {
    setAgents((prev) => merge(prev, snapshot));
  }, [snapshot]);

  // Drop fully-faded agents once the fade window expires.
  useEffect(() => {
    const removing = agents.filter((a) => a.removingAt !== undefined);
    if (removing.length === 0) return;
    const id = setTimeout(() => {
      const cutoff = Date.now() - REMOVE_FADE_MS;
      setAgents((prev) =>
        prev.filter((a) => a.removingAt === undefined || a.removingAt >= cutoff),
      );
    }, REMOVE_FADE_MS + REMOVE_FADE_BUFFER_MS);
    return () => clearTimeout(id);
  }, [agents]);

  return agents;
}

function merge(prev: DisplayAgent[], next: ActiveAgent[]): DisplayAgent[] {
  const now = Date.now();
  const prevByKey = new Map(prev.map((a) => [a.key, a]));
  const nextKeys = new Set(next.map(keyOf));

  const merged: DisplayAgent[] = next.map((a) => {
    const key = keyOf(a);
    const existing = prevByKey.get(key);
    return {
      ...a,
      key,
      mountedAt: existing?.mountedAt ?? now,
      removingAt: undefined,
    };
  });

  // Keep recently-removed agents around briefly so they can fade out.
  for (const a of prev) {
    if (nextKeys.has(a.key)) continue;
    const removingAt = a.removingAt ?? now;
    if (now - removingAt >= REMOVE_FADE_MS) continue;
    merged.push({ ...a, removingAt });
  }

  // Sort to keep stack ordering deterministic across renders.
  merged.sort((x, y) => x.startedAt - y.startedAt);
  return merged;
}

function keyOf(a: ActiveAgent): string {
  return `${a.sessionId}:${a.id}`;
}
