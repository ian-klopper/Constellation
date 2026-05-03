/**
 * Per-agent file-trail overlay. For every (live or recently-finished) agent
 * in the snapshot, draws a faint colored line between the centers of every
 * file tile that agent has visited, in chronological order — like joining
 * stars into a constellation. Trails of finished agents linger and fade
 * out over CONSTELLATION.FOSSIL_LIFETIME_MS so you can read the agent's
 * investigation path even after it has stopped.
 *
 * Performance: the SVG `<path>` elements are React-managed (one per agent),
 * but their `d` and `stroke-opacity` attributes are mutated imperatively
 * each frame — same channel useAgentPositions uses (subscribeTransformChange
 * from ZoomPanContext). React state never touches per-frame data, so this
 * adds zero reconciliation cost during pans/zooms even with many agents.
 *
 * LOD culling: when a tile in the agent's history is gone from the
 * TileRegistry (the user zoomed out and the LOD gate dropped it), the
 * line breaks at that point — the path string starts a new `M` segment
 * on the next visible tile rather than jumping to (0,0) or skipping
 * across an invisible coordinate.
 */
"use client";

import { useEffect, useMemo, useRef } from "react";
import { CONSTELLATION } from "@/lib/constants";
import { useAgentStream } from "@/hooks/useAgentStream";
import { useFossilizedAgents, type FossilAgent } from "@/hooks/useFossilizedAgents";
import { useTileRegistry, type TileRegistry } from "./TileRegistry";
import { useZoomPan } from "./ZoomPanContext";

// Smooth-fade tick for fossil opacity. Transform-driven recomputes already
// cover live pan/zoom; this interval covers the case where nothing else is
// happening but fossils are aging out and need their stroke-opacity
// nudged downward.
const FOSSIL_TICK_MS = 200;

export function ConstellationOverlay({ root }: { root: string }) {
  const { agents: allAgents } = useAgentStream();
  // Filter by repo first — same reason as AgentOverlay: trails for agents
  // working in a different repo would resolve to (0,0) here.
  const filtered = useMemo(
    () => allAgents.filter((a) => a.cwd === root),
    [allAgents, root],
  );
  const agents = useFossilizedAgents(filtered);
  const registry = useTileRegistry();
  const { subscribeTransformChange } = useZoomPan();

  // Per-agent <path> element registry. Keyed by the same composite key the
  // hooks use, so unmounted agents don't leak.
  const pathsRef = useRef<Map<string, SVGPathElement>>(new Map());
  const agentsRef = useRef<FossilAgent[]>(agents);
  agentsRef.current = agents;

  useEffect(() => {
    const recompute = () => {
      const now = Date.now();
      for (const a of agentsRef.current) {
        const el = pathsRef.current.get(a.key);
        if (!el) continue;
        const d = buildPathD(a.pathHistory, registry);
        el.setAttribute("d", d);
        el.setAttribute("stroke-opacity", String(fossilOpacity(a, now)));
      }
    };

    recompute();
    const unsubXf = subscribeTransformChange(recompute);
    const unsubReg = registry.subscribe(recompute);
    const interval = setInterval(recompute, FOSSIL_TICK_MS);
    window.addEventListener("resize", recompute);
    window.addEventListener("scroll", recompute, { passive: true });

    return () => {
      unsubXf();
      unsubReg();
      clearInterval(interval);
      window.removeEventListener("resize", recompute);
      window.removeEventListener("scroll", recompute);
    };
  }, [registry, subscribeTransformChange]);

  if (agents.length === 0) return null;

  return (
    <svg
      data-constellation-overlay
      className="pointer-events-none fixed inset-0 z-40"
      // viewBox-less + no width/height attrs — the inset-0 + fixed sizing
      // gives the SVG a viewport-sized coordinate system in CSS pixels,
      // matching the values getBoundingClientRect() returns.
    >
      {agents.map((a) => (
        <path
          key={a.key}
          ref={(el) => {
            if (el) pathsRef.current.set(a.key, el);
            else pathsRef.current.delete(a.key);
          }}
          stroke={kindColor(a)}
          strokeWidth={CONSTELLATION.STROKE_WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      ))}
    </svg>
  );
}

function buildPathD(
  history: FossilAgent["pathHistory"],
  registry: TileRegistry,
): string {
  if (!history || history.length < 2) return "";
  let d = "";
  let inSegment = false;
  for (const entry of history) {
    const el = registry.get(entry.path);
    if (!el) {
      // Break the line — next visible tile starts a fresh `M` segment.
      inSegment = false;
      continue;
    }
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    if (!inSegment) {
      d += `M${cx.toFixed(1)} ${cy.toFixed(1)}`;
      inSegment = true;
    } else {
      d += ` L${cx.toFixed(1)} ${cy.toFixed(1)}`;
    }
  }
  return d;
}

// Match the AgentIcon palette so a trail's color makes its owning icon
// obvious at a glance.
function kindColor(a: FossilAgent): string {
  if (a.subagent_type === "main") return "rgb(14 165 233)"; // sky-500
  if (a.kind === "background") return "rgb(245 158 11)"; // amber-500
  return "rgb(16 185 129)"; // emerald-500
}

function fossilOpacity(a: FossilAgent, now: number): number {
  if (a.fossilStart === undefined) return CONSTELLATION.ALIVE_OPACITY;
  const elapsed = now - a.fossilStart;
  if (elapsed >= CONSTELLATION.FOSSIL_LIFETIME_MS) return 0;
  return (
    CONSTELLATION.ALIVE_OPACITY *
    (1 - elapsed / CONSTELLATION.FOSSIL_LIFETIME_MS)
  );
}
