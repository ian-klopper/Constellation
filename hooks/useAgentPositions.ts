/**
 * Computes screen positions for every agent icon. Agents anchored to a
 * file (currentPath) sit at the top-right corner of that tile, stacking
 * horizontally if multiple agents share a path. Agents without a tile
 * (or with no currentPath) park in a row at the top-right of the page.
 *
 * Replaces the old document.querySelector('[data-path="…"]') with the
 * formal TileRegistry contract — TreemapNode registers its tile element
 * via a ref callback; we read it from the registry. Re-runs on agent
 * change, registry change, window resize, and scroll.
 */
"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { OVERLAY } from "@/lib/constants";
import { useTileRegistry } from "@/components/TileRegistry";
import type { DisplayAgent } from "./useAgentLifecycle";

const { ICON_SIZE, PARK_TOP, PARK_RIGHT, PARK_GAP, STACK_OFFSET } = OVERLAY;

export type Pos = { x: number; y: number };

export function useAgentPositions(agents: DisplayAgent[]): Map<string, Pos> {
  const registry = useTileRegistry();
  const [positions, setPositions] = useState<Map<string, Pos>>(new Map());

  // Recompute when the agent list changes (initial + every snapshot).
  useLayoutEffect(() => {
    setPositions(compute(agents, registry));
  }, [agents, registry]);

  // Recompute when tiles mount/unmount (resize re-runs squarify) and
  // when the window itself changes shape.
  useEffect(() => {
    const recompute = () => setPositions(compute(agents, registry));
    const unsub = registry.subscribe(recompute);
    window.addEventListener("resize", recompute);
    window.addEventListener("scroll", recompute, { passive: true });
    return () => {
      unsub();
      window.removeEventListener("resize", recompute);
      window.removeEventListener("scroll", recompute);
    };
  }, [agents, registry]);

  return positions;
}

function compute(
  agents: DisplayAgent[],
  registry: { get: (path: string) => HTMLElement | null },
): Map<string, Pos> {
  const out = new Map<string, Pos>();
  if (typeof window === "undefined") return out;

  const stackCount = new Map<string, number>();
  let parkIdx = 0;

  for (const a of agents) {
    const cardPos = a.currentPath
      ? cardPosition(a.currentPath, registry, stackCount)
      : null;
    out.set(a.id, cardPos ?? parkPosition(parkIdx++));
  }
  return out;
}

function cardPosition(
  path: string,
  registry: { get: (path: string) => HTMLElement | null },
  stackCount: Map<string, number>,
): Pos | null {
  const el = registry.get(path);
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
    x: window.innerWidth - PARK_RIGHT - ICON_SIZE - idx * (ICON_SIZE + PARK_GAP),
    y: PARK_TOP,
  };
}
