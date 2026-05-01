/**
 * Read-only window onto the visualizer's zoom + pan state, plus the shared
 * pan-clamp helper. The actual state machine — live ref, frame coalescer,
 * subscriber set, committedZoom updater — lives in Visualizer; this file
 * just publishes the consumer-facing API and the math both call sites use.
 *
 * Consumer split:
 *  - TreemapNode reads `committedZoom` (React state) for the LOD gate.
 *    Updates only on LOD_COMMIT_QUANTUM crossings, so reading it does not
 *    re-render the tile tree on every wheel event.
 *  - useAgentPositions, PinController, HoverPanel (pin-mode anchor) call
 *    `subscribeTransformChange(cb)` and re-anchor by reading
 *    `getBoundingClientRect()` — which automatically reflects the live
 *    transform that was just mutated this rAF tick.
 *  - Wheel-zoom math and the reset shortcut call `getLive()` to read the
 *    up-to-date zoom/pan synchronously, since they need values that change
 *    faster than React state.
 *
 * Live `{zoom, pan}` are *never* exposed as React state, by design — that
 * was the original Option-A architecture this plan rejected. Routing them
 * through state would force O(N) TreemapNode reconciliation per detent,
 * defeating the whole point.
 */
"use client";

import { createContext, useContext } from "react";

export type ZoomPanState = {
  zoom: number;
  pan: { x: number; y: number };
};

export type ZoomPanContextValue = {
  committedZoom: number;
  getLive: () => ZoomPanState;
  subscribeTransformChange: (cb: () => void) => () => void;
};

export const ZoomPanContext = createContext<ZoomPanContextValue | null>(null);

export function useZoomPan(): ZoomPanContextValue {
  const ctx = useContext(ZoomPanContext);
  if (!ctx) {
    throw new Error("useZoomPan must be used inside <ZoomPanContext.Provider>");
  }
  return ctx;
}

// Pan clamp: strict no-overflow. The scaled canvas occupies the rect
// [pan.x, pan.x + viewportW * zoom] × [pan.y, pan.y + viewportH * zoom] in
// viewport coords. To make the canvas always cover the viewport (no
// background bleed at any edge):
//   pan.x ≤ 0                              (don't expose empty space on the left)
//   pan.x + viewportW * zoom ≥ viewportW   (don't expose empty space on the right)
// ⇒ pan.x ∈ [viewportW * (1 − zoom), 0]. Symmetric for y. At zoom=1 both
// bounds collapse to 0, which is the intended fixed point.
export function clampPan(
  pan: { x: number; y: number },
  zoom: number,
  viewportW: number,
  viewportH: number,
): { x: number; y: number } {
  if (zoom <= 1) return { x: 0, y: 0 };
  const minX = viewportW * (1 - zoom);
  const minY = viewportH * (1 - zoom);
  return {
    x: Math.min(0, Math.max(minX, pan.x)),
    y: Math.min(0, Math.max(minY, pan.y)),
  };
}
