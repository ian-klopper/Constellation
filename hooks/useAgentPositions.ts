/**
 * Computes screen positions for every agent icon. Agents anchored to a
 * file (currentPath) sit at the top-right corner of that tile. Agents
 * without a resolved tile (no currentPath, or path not in the registry)
 * are omitted — AgentOverlay skips them (they appear only in the AgentDock).
 *
 * Positions are clamped to the visualizer container's bounding rect so
 * an agent working on a tile near the viewport edge stays fully visible.
 * The container bbox is sized to fit the treemap exactly (no siblings).
 *
 * Re-runs on agent change, registry change, window resize, scroll, and
 * every transform tick (so icons stay anchored under live zoom + pan).
 */
"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { OVERLAY } from "@/lib/constants";
import { useTileRegistry } from "@/components/TileRegistry";
import { useZoomPan } from "@/components/ZoomPanContext";
import type { DisplayAgent } from "./useAgentLifecycle";

const { ICON_SIZE } = OVERLAY;

export type Pos = { x: number; y: number };

export function useAgentPositions(
  agents: DisplayAgent[],
  container: HTMLElement | null,
): Map<string, Pos> {
  const registry = useTileRegistry();
  const { subscribeTransformChange } = useZoomPan();
  const [positions, setPositions] = useState<Map<string, Pos>>(new Map());

  // Recompute when the agent list changes (initial + every snapshot).
  useLayoutEffect(() => {
    setPositions(compute(agents, registry, container));
  }, [agents, registry, container]);

  // Recompute when tiles mount/unmount, when the window shape changes, and
  // on every transform tick (so icons stay anchored under live zoom + pan).
  useEffect(() => {
    const recompute = () => setPositions(compute(agents, registry, container));
    const unsubReg = registry.subscribe(recompute);
    const unsubXf = subscribeTransformChange(recompute);
    window.addEventListener("resize", recompute);
    window.addEventListener("scroll", recompute, { passive: true });
    return () => {
      unsubReg();
      unsubXf();
      window.removeEventListener("resize", recompute);
      window.removeEventListener("scroll", recompute);
    };
  }, [agents, registry, container, subscribeTransformChange]);

  return positions;
}

function compute(
  agents: DisplayAgent[],
  registry: { get: (path: string) => HTMLElement | null },
  container: HTMLElement | null,
): Map<string, Pos> {
  const out = new Map<string, Pos>();
  if (typeof window === "undefined") return out;

  // Read the container bbox once per compute call so all icons are
  // clamped against the same snapshot of the container's position.
  const containerRect = container?.getBoundingClientRect() ?? null;

  for (const a of agents) {
    if (!a.currentPath) continue;
    const pos = cardPosition(a.currentPath, registry, containerRect);
    if (pos) out.set(a.key, pos);
  }
  return out;
}

function cardPosition(
  path: string,
  registry: { get: (path: string) => HTMLElement | null },
  containerRect: DOMRect | null,
): Pos | null {
  const el = registry.get(path);
  if (!el) return null;
  const rect = el.getBoundingClientRect();

  // Place the icon centered at the tile's top-right corner.
  let x = rect.right - ICON_SIZE / 2;
  let y = rect.top - ICON_SIZE / 2;

  // Clamp to the container so icons on edge tiles don't clip outside
  // the visualizer. Falls back to unclamped if container is not yet
  // measured (first paint, SSR).
  if (containerRect) {
    x = Math.max(containerRect.left, Math.min(containerRect.right - ICON_SIZE, x));
    y = Math.max(containerRect.top, Math.min(containerRect.bottom - ICON_SIZE, y));
  }

  return { x, y };
}
