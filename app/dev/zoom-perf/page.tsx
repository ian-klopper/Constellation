/**
 * Permanent dev-only perf bench for the zoom + LOD feature. NOT linked from
 * the home page — visit /dev/zoom-perf manually.
 *
 * Renders a synthetic 5,000-tile tree under a wrapper whose `style.transform`
 * is mutated imperatively in an rAF tick — the exact ref-driven pattern Unit
 * 3 lands for real. Use this to measure the transform stack (FPS, paint
 * cost, layer promotion) on Constellation's actual rendering pipeline before
 * scaling to Parsley-size repos.
 *
 * How to measure: open in Chrome, open DevTools Performance tab, record a
 * 5-second wheel-zoom (1x → 8x → 1x) and a 5-second drag-pan. Watch the
 * "Frames" track for sustained FPS and the "Main" thread for layout / paint
 * thrash. Repeat in Safari (which historically rasterizes text per-frame on
 * transform changes).
 *
 * Decision gate (from docs/plans/2026-05-01-001-feat-zoom-and-lod-plan.md
 * Unit 1):
 *   - >50 FPS sustained, no per-frame layout thrash → land Units 2-8 as planned.
 *   - 30-50 FPS, occasional thrash → land Units 2-8 with `will-change: transform`
 *     + `contain: paint` on the wrapper, then re-measure after Unit 4.
 *   - <30 FPS or visible jank → STOP. Replan as canvas / virtualization.
 *
 * Baseline (fill in after running on a real machine):
 *   - Chrome FPS during wheel-zoom: TBD
 *   - Chrome FPS during drag-pan:   TBD
 *   - Safari FPS during wheel-zoom: TBD
 *   - Safari FPS during drag-pan:   TBD
 *   - Memory after 30s stress:      TBD
 */
import { buildSyntheticTree } from "@/lib/scan/synthetic";
import { ZoomPerfClient } from "./ZoomPerfClient";

export default function ZoomPerfPage() {
  const tree = buildSyntheticTree(5000);
  return <ZoomPerfClient tree={tree} />;
}
