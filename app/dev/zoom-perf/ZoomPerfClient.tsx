/**
 * The interactive perf-bench shell. Owns the `liveZoomPanRef`, the rAF tick
 * that mutates `wrapperRef.current.style.transform`, and the wheel + pointer
 * handlers — modeled on the architecture Unit 3 will land in
 * components/Visualizer.tsx for real, so this measurement reflects production
 * behavior, not a misleading "naive useState" baseline.
 *
 * Differences from the production Visualizer (intentional, to keep the bench
 * focused on the transform stack):
 *   - HoverContext is a no-op (perf bench doesn't pin / hover).
 *   - No agent overlay, no hover panel, no LOD gating.
 *   - Synthetic tree replaces scanProject(); FileNodes have empty
 *     symbols/imports.
 */
"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { TreemapNode } from "@/components/TreemapNode";
import { TileRegistryProvider } from "@/components/TileRegistry";
import {
  HoverContext,
  type HoverContextValue,
} from "@/components/HoverContext";
import {
  ZoomPanContext,
  type ZoomPanContextValue,
} from "@/components/ZoomPanContext";
import type { CodebaseTree } from "@/lib/types";

// Tunables — keep in sync with constants Unit 3 will add to lib/constants.ts.
// Duplicated here on purpose so the perf bench can be retuned without
// disturbing production constants.
const ZOOM_MIN = 1;
const ZOOM_MAX = 8;
const ZOOM_SENSITIVITY = 0.005;
const PAN_CLAMP_MARGIN = 0.3;

export function ZoomPerfClient({ tree }: { tree: CodebaseTree }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  // Live continuous values — never React state. Wheel + pointer handlers
  // write here synchronously, scheduleFrame() flushes to the DOM.
  const liveRef = useRef({ zoom: 1, pan: { x: 0, y: 0 } });
  const frameScheduledRef = useRef(false);
  const panelHoveredRef = useRef(false);

  function scheduleFrame() {
    if (frameScheduledRef.current) return;
    frameScheduledRef.current = true;
    requestAnimationFrame(() => {
      frameScheduledRef.current = false;
      const w = wrapperRef.current;
      if (!w) return;
      const { zoom, pan } = liveRef.current;
      w.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
    });
  }

  // Initial transform write before paint, so the wrapper isn't briefly
  // un-styled on first commit.
  useLayoutEffect(() => {
    const w = wrapperRef.current;
    if (w) w.style.transform = "translate(0px, 0px) scale(1)";
  }, []);

  // Container size drives the squarified layout — same shape as Visualizer.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize({ w: width, h: height });
      // Re-clamp pan against new bounds (Unit 3 R15 behavior).
      const z = liveRef.current.zoom;
      liveRef.current = {
        zoom: z,
        pan: clampPan(liveRef.current.pan, z, width, height),
      };
      scheduleFrame();
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Wheel — cursor-anchored zoom on the wrapper. `passive: false` so we can
  // preventDefault and stop the page from scrolling behind the canvas.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    const container = containerRef.current;
    if (!wrapper || !container) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = container!.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      // Magnitude-aware factor — mouse-wheel detents (~deltaY 100) and
      // trackpad ticks (~deltaY 5) both produce sensible per-event zoom.
      const factorRaw = Math.exp(-e.deltaY * ZOOM_SENSITIVITY);
      const factor = Math.min(2, Math.max(0.5, factorRaw));
      const oldZoom = liveRef.current.zoom;
      const newZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, oldZoom * factor));
      const oldPan = liveRef.current.pan;
      // Cursor-anchored zoom math: keep the world point under the cursor
      // stationary on screen.
      const newPanX = cx - (cx - oldPan.x) * (newZoom / oldZoom);
      const newPanY = cy - (cy - oldPan.y) * (newZoom / oldZoom);
      liveRef.current = {
        zoom: newZoom,
        pan: clampPan({ x: newPanX, y: newPanY }, newZoom, rect.width, rect.height),
      };
      scheduleFrame();
    }
    wrapper.addEventListener("wheel", onWheel, { passive: false });
    return () => wrapper.removeEventListener("wheel", onWheel);
  }, []);

  // Pointer drag — pan from anywhere on the container.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    function onPointerDown(e: PointerEvent) {
      if (e.button !== 0) return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      try {
        container!.setPointerCapture(e.pointerId);
      } catch {
        // setPointerCapture can throw on detached elements during HMR.
      }
    }
    function onPointerMove(e: PointerEvent) {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      const rect = container!.getBoundingClientRect();
      const z = liveRef.current.zoom;
      const oldPan = liveRef.current.pan;
      liveRef.current = {
        zoom: z,
        pan: clampPan(
          { x: oldPan.x + dx, y: oldPan.y + dy },
          z,
          rect.width,
          rect.height,
        ),
      };
      scheduleFrame();
    }
    function onPointerUp(e: PointerEvent) {
      dragging = false;
      try {
        container!.releasePointerCapture(e.pointerId);
      } catch {
        // releasePointerCapture is also tolerant of "no active capture".
      }
    }
    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerup", onPointerUp);
    container.addEventListener("pointercancel", onPointerUp);
    return () => {
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("pointercancel", onPointerUp);
    };
  }, []);

  // No-op HoverContext value — TreemapNode requires the provider but the
  // perf bench doesn't exercise hover/pin paths.
  const hoverValue = useMemo<HoverContextValue>(
    () => ({
      hoveredPath: null,
      pinnedPath: null,
      activePath: null,
      inputs: EMPTY_SET,
      outputs: EMPTY_SET,
      setHover: () => {},
      setPinned: () => {},
      panelHoveredRef,
    }),
    [panelHoveredRef],
  );

  // Stub ZoomPanContext: committedZoom pinned at 1 so LOD never culls
  // tiles (worst-case load — the whole point of the bench). The live
  // transform is mutated imperatively above; nothing here subscribes.
  const zoomPanValue = useMemo<ZoomPanContextValue>(
    () => ({
      committedZoom: 1,
      getLive: () => liveRef.current,
      subscribeTransformChange: () => () => {},
    }),
    [],
  );

  return (
    <main className="flex h-screen flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-zinc-200 px-6 py-3 text-[11px] uppercase tracking-wider text-zinc-500">
        <span>zoom-perf · 5,000 synthetic tiles · ref-driven transform</span>
        <span>scroll = zoom toward cursor · drag = pan</span>
      </header>
      <div className="min-h-0 flex-1">
        <HoverContext.Provider value={hoverValue}>
          <TileRegistryProvider>
            <ZoomPanContext.Provider value={zoomPanValue}>
              <div
                ref={containerRef}
                className="relative h-full w-full overflow-hidden"
                style={{ touchAction: "none" }}
              >
                <div
                  ref={wrapperRef}
                  style={{
                    transformOrigin: "0 0",
                    width: size?.w ?? 0,
                    height: size?.h ?? 0,
                    position: "relative",
                  }}
                >
                  {size && size.w > 0 && size.h > 0 && (
                    <TreemapNode
                      node={tree.tree}
                      x={0}
                      y={0}
                      w={size.w}
                      h={size.h}
                      depth={0}
                      tint={null}
                    />
                  )}
                </div>
              </div>
            </ZoomPanContext.Provider>
          </TileRegistryProvider>
        </HoverContext.Provider>
      </div>
    </main>
  );
}

const EMPTY_SET: Set<string> = new Set();

// Pan clamp: at zoom=1 the layout fills the viewport, so pan must be (0,0).
// At higher zooms allow pan such that at least PAN_CLAMP_MARGIN * smaller-
// dimension stays visible per axis.
function clampPan(
  pan: { x: number; y: number },
  zoom: number,
  viewportW: number,
  viewportH: number,
): { x: number; y: number } {
  if (zoom <= 1) return { x: 0, y: 0 };
  const minVisible = PAN_CLAMP_MARGIN * Math.min(viewportW, viewportH);
  const minX = minVisible - viewportW * zoom;
  const maxX = viewportW - minVisible;
  const minY = minVisible - viewportH * zoom;
  const maxY = viewportH - minVisible;
  return {
    x: Math.min(maxX, Math.max(minX, pan.x)),
    y: Math.min(maxY, Math.max(minY, pan.y)),
  };
}
