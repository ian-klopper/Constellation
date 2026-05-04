/**
 * Per-agent file-trail overlay. Renders one SVG <path> per *segment* of
 * each agent's pathHistory (not one per agent), so each segment can carry
 * its own opacity derived from its individual age. Older segments at the
 * tail of the trail fade out first while newer ones near the head stay
 * bright.
 *
 * Routing: segments use orthogonal "road" routing from lib/trail-routing.ts
 * (L-shape along the longer axis with rounded elbows) instead of straight
 * diagonals. New segments draw in via a stroke-dashoffset tween (~350ms).
 *
 * Performance: <path> elements are React-managed (one per segment), but
 * their `d` and `stroke-opacity` attributes are mutated imperatively each
 * frame via the same subscribeTransformChange channel useAgentPositions
 * uses. React state never touches per-frame data, so this adds zero
 * reconciliation cost during pans/zooms.
 *
 * LOD culling: if either endpoint tile is missing from the TileRegistry
 * (zoomed-out LOD gate dropped it), the segment's `d` is set to "" so it
 * renders nothing. Adjacent visible segments remain unaffected.
 */
"use client";

import { useEffect, useMemo, useRef } from "react";
import { CONSTELLATION } from "@/lib/constants";
import { agentColor } from "@/lib/agent-colors";
import { routeSegment } from "@/lib/trail-routing";
import { useAgentStream } from "@/hooks/useAgentStream";
import { useFossilizedAgents, type FossilAgent } from "@/hooks/useFossilizedAgents";
import { useTileRegistry } from "./TileRegistry";
import { useZoomPan } from "./ZoomPanContext";

// Smooth-fade tick for fossil + segment age opacity. Transform-driven
// recomputes cover live pan/zoom; this interval covers the case where
// nothing else is happening but segments are aging out.
const FOSSIL_TICK_MS = 200;

// Inline shape matches the zod schema in lib/types.ts:
// z.array(z.object({ path: z.string(), ts: z.number() }))
type PathHistoryEntry = { path: string; ts: number };

type Segment = {
  from: PathHistoryEntry;
  to: PathHistoryEntry;
  /** epoch seconds — max(from.ts, to.ts) for per-segment age decay */
  ts: number;
};

type SegmentRef = {
  el: SVGPathElement;
  agent: FossilAgent;
  seg: Segment;
};

/** Build consecutive (from, to) pairs from a path history. */
function segmentsOf(history: FossilAgent["pathHistory"]): Segment[] {
  if (!history || history.length < 2) return [];
  const out: Segment[] = [];
  for (let i = 1; i < history.length; i++) {
    const from = history[i - 1];
    const to = history[i];
    out.push({ from, to, ts: Math.max(from.ts, to.ts) });
  }
  return out;
}

export function ConstellationOverlay({ root }: { root: string }) {
  const { agents: allAgents } = useAgentStream();
  // Filter by repo first — trails for agents in a different repo would
  // resolve to (0,0) because their tiles aren't in this registry.
  const filtered = useMemo(
    () => allAgents.filter((a) => a.cwd === root),
    [allAgents, root],
  );
  const agents = useFossilizedAgents(filtered);
  const registry = useTileRegistry();
  const { subscribeTransformChange } = useZoomPan();

  // Map from segment key → { el, agent, seg } for imperative mutations.
  const pathsRef = useRef<Map<string, SegmentRef>>(new Map());
  // Track which segments have already been given the draw-in animation so
  // we only fire it once per segment lifetime.
  const drawnRef = useRef<Set<string>>(new Set());
  // Keep a stable ref to the latest agents list for use inside the effect.
  const agentsRef = useRef<FossilAgent[]>(agents);
  agentsRef.current = agents;

  useEffect(() => {
    const recompute = () => {
      const now = Date.now();
      for (const [k, { el, agent, seg }] of pathsRef.current) {
        const fromEl = registry.get(seg.from.path);
        const toEl = registry.get(seg.to.path);

        if (!fromEl || !toEl) {
          // Endpoint culled by LOD — hide this segment cleanly.
          el.setAttribute("d", "");
          continue;
        }

        const fromRect = fromEl.getBoundingClientRect();
        const toRect = toEl.getBoundingClientRect();
        const a = {
          cx: fromRect.left + fromRect.width / 2,
          cy: fromRect.top + fromRect.height / 2,
        };
        const b = {
          cx: toRect.left + toRect.width / 2,
          cy: toRect.top + toRect.height / 2,
        };

        const d = routeSegment(a, b, {
          cornerRadius: CONSTELLATION.ROUTING_CORNER_RADIUS,
        });
        el.setAttribute("d", d);

        // Opacity: agent alive factor × per-segment age decay.
        const aliveFactor = fossilOpacity(agent, now);
        const ageMs = now - seg.ts * 1000;
        const segmentAgeFactor = Math.max(
          0,
          1 - ageMs / CONSTELLATION.SEGMENT_LIFETIME_MS,
        );
        const opacity = aliveFactor * segmentAgeFactor;
        el.setAttribute("stroke-opacity", String(opacity));

        // Draw-in animation — fires once per segment, only after d is set
        // and the segment is visible. The ref callback can't do this because
        // d hasn't been assigned yet when the ref callback fires.
        if (!drawnRef.current.has(k) && opacity > 0 && d !== "") {
          const len = el.getTotalLength();
          if (len > 0) {
            el.style.strokeDasharray = String(len);
            el.style.strokeDashoffset = String(len);
            el.style.transition = `stroke-dashoffset ${CONSTELLATION.SEGMENT_DRAW_IN_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
            requestAnimationFrame(() => {
              el.style.strokeDashoffset = "0";
            });
            // Clean up dasharray after the animation so subsequent d
            // mutations from pan/zoom don't conflict with a stale dasharray.
            setTimeout(() => {
              el.style.strokeDasharray = "none";
              el.style.transition = "";
            }, CONSTELLATION.SEGMENT_DRAW_IN_MS + 50);
            drawnRef.current.add(k);
          }
        }
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
      // No viewBox or width/height — fixed + inset-0 gives a viewport-sized
      // coordinate system in CSS pixels, matching getBoundingClientRect().
    >
      {agents.flatMap((a) =>
        segmentsOf(a.pathHistory ?? []).map((seg, i) => {
          const k = `${a.key}:${i}`;
          return (
            <path
              key={k}
              ref={(el) => {
                if (el) {
                  pathsRef.current.set(k, { el, agent: a, seg });
                } else {
                  pathsRef.current.delete(k);
                  // NOTE: don't delete from drawnRef here. Inline arrow refs
                  // change identity every render, so React fires this cleanup
                  // every snapshot tick — clearing drawnRef would re-fire the
                  // draw-in animation continuously. drawnRef accumulates per-
                  // segment keys with PATH_HISTORY_MAX = 50 per agent, capped
                  // at the keyspace of all segments seen this session. Memory
                  // ceiling is small enough that no pruning sweep is needed.
                }
              }}
              stroke={agentColor(a).fillRgb}
              strokeWidth={CONSTELLATION.STROKE_WIDTH}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
              style={{ transition: "stroke-opacity 350ms ease-out" }}
            />
          );
        }),
      )}
    </svg>
  );
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
