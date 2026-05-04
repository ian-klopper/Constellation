/**
 * Mount-once owner of pin-related global behaviors that need to live inside
 * <HoverContext.Provider>, <TileRegistryProvider>, and <ZoomPanContext.Provider>:
 *
 * - Esc unpins.
 * - Window-level click in empty space (not a tile, panel, or agent overlay)
 *   unpins. Acts as the safety net for clicks *outside* the visualizer
 *   container — clicks inside the container are owned by Visualizer's
 *   pointerup handler. Guarded by a 4 px pointer-distance threshold so
 *   trackpad scroll-release synthetic clicks and click-drags don't
 *   spuriously unpin.
 * - Re-anchor on every transform tick (subscribe channel from
 *   ZoomPanContext) AND on viewport resize (window event). Reads the
 *   pinned tile's current getBoundingClientRect() and feeds it back via
 *   setPinned, so the floating panel slides with the tile under zoom/pan.
 *   When the tile is culled by LOD (registry.get returns null), pin state
 *   is preserved but pinnedPos is dropped — HoverPanel hides itself when
 *   pos is null (R13).
 *
 * Listeners attach once with stable deps and read pinnedPath through a ref —
 * no attach/detach churn on each pin/unpin and no StrictMode double-attach
 * surprise.
 */
"use client";

import { useEffect, useRef } from "react";
import { POINTER_MOVE_THRESHOLD } from "@/lib/constants";
import { useHover } from "./HoverContext";
import { useTileRegistry } from "./TileRegistry";
import { useZoomPan } from "./ZoomPanContext";

export function PinController() {
  const { pinnedPath, setPinned } = useHover();
  const registry = useTileRegistry();
  const { subscribeTransformChange } = useZoomPan();
  const pinnedPathRef = useRef(pinnedPath);

  useEffect(() => {
    pinnedPathRef.current = pinnedPath;
  }, [pinnedPath]);

  // Esc unpins.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && pinnedPathRef.current !== null) {
        setPinned(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPinned]);

  // Click in empty space outside the visualizer container unpins. The new
  // pointerup handler in Visualizer already handles clicks *inside* the
  // container (tile clicks pin/unpin, empty-space clicks unpin), so this
  // window-level handler is intentional belt-and-suspenders for clicks on
  // the page chrome (header, body padding) — nothing the container saw.
  useEffect(() => {
    let downPos: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      downPos = { x: e.clientX, y: e.clientY };
    };
    const onClick = (e: MouseEvent) => {
      const last = downPos;
      downPos = null;
      if (pinnedPathRef.current === null) return;
      if (
        last &&
        Math.hypot(e.clientX - last.x, e.clientY - last.y) >
          POINTER_MOVE_THRESHOLD
      ) {
        return;
      }
      const target = e.target instanceof Element ? e.target : null;
      if (!target) return;
      if (target.closest("[data-path]")) return;
      if (target.closest("[data-hover-panel]")) return;
      if (target.closest("[data-agent-overlay]")) return;
      if (target.closest("[data-agent-rail]")) return;
      setPinned(null);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("click", onClick);
    };
  }, [setPinned]);

  // Re-anchor: live (transform tick) + double-rAF resize. Both call the
  // same recompute, which reads the pinned tile's current rect from the
  // registry and feeds it back through setPinned. Tile not in the
  // registry → R13 hide (setPinned(path, undefined) → pinnedPos null).
  //
  // The double-rAF on resize is load-bearing: window 'resize' fires
  // synchronously *before* React's ResizeObserver-driven re-render and
  // squarify pass commits, so reading the rect inside the event handler
  // returns the pre-reflow position. Two animation frames later, layout
  // reflects the post-reflow tile rect.
  //
  // The transform-change tick fires from inside Visualizer's rAF, *after*
  // the wrapper's style.transform has already been mutated this frame, so
  // getBoundingClientRect() returns post-transform coords automatically —
  // no additional rAF deferral needed for that path.
  useEffect(() => {
    const recompute = () => {
      const path = pinnedPathRef.current;
      if (!path) return;
      const tileEl = registry.get(path);
      if (!tileEl) {
        setPinned(path, undefined);
        return;
      }
      const rect = tileEl.getBoundingClientRect();
      setPinned(path, {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      });
    };

    const unsubTransform = subscribeTransformChange(recompute);

    let raf1: number | null = null;
    let raf2: number | null = null;
    const onResize = () => {
      if (pinnedPathRef.current === null) return;
      if (raf1 !== null) cancelAnimationFrame(raf1);
      raf1 = requestAnimationFrame(() => {
        if (raf2 !== null) cancelAnimationFrame(raf2);
        raf2 = requestAnimationFrame(() => {
          raf1 = null;
          raf2 = null;
          recompute();
        });
      });
    };
    window.addEventListener("resize", onResize);

    return () => {
      unsubTransform();
      window.removeEventListener("resize", onResize);
      if (raf1 !== null) cancelAnimationFrame(raf1);
      if (raf2 !== null) cancelAnimationFrame(raf2);
    };
  }, [registry, setPinned, subscribeTransformChange]);

  return null;
}
