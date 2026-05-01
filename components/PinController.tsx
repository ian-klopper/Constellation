/**
 * Mount-once owner of pin-related global behaviors that need to live inside
 * both <HoverContext.Provider> and <TileRegistryProvider>:
 *
 * - Esc unpins.
 * - Click in empty space (not a tile, not the panel, not the agent overlay)
 *   unpins. Guarded by a 4px pointer-distance threshold so trackpad scroll-
 *   release synthetic clicks and click-drags don't spuriously unpin.
 * - Viewport resize re-anchors the pinned panel to the tile's new rect, so
 *   treemap reflow doesn't strand the panel.
 *
 * Listeners attach once with empty deps and read pinnedPath through a ref —
 * no attach/detach churn on each pin/unpin and no StrictMode double-attach
 * surprise.
 */
"use client";

import { useEffect, useRef } from "react";
import { useHover } from "./HoverContext";
import { useTileRegistry } from "./TileRegistry";

const POINTER_MOVE_THRESHOLD = 4;

export function PinController() {
  const { pinnedPath, setPinned } = useHover();
  const registry = useTileRegistry();
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

  // Click in empty space unpins. Tracks pointerdown coords so a click that
  // moved more than POINTER_MOVE_THRESHOLD pixels (drag, trackpad scroll
  // release) is rejected — only deliberate clicks unpin.
  useEffect(() => {
    let downPos: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      downPos = { x: e.clientX, y: e.clientY };
    };
    const onClick = (e: MouseEvent) => {
      // Consume downPos: a stale value from an earlier pointerdown must
      // not falsely reject a later click as a drag.
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
      // e.target is EventTarget | null — a Document/Window/Text node would
      // pass an `as Element` cast but doesn't have .closest().
      const target = e.target instanceof Element ? e.target : null;
      if (!target) return;
      // Tiles (their own onClick already toggled pin), the panel itself,
      // and anything inside the agent overlay are all "not empty space".
      if (target.closest("[data-path]")) return;
      if (target.closest("[data-hover-panel]")) return;
      if (target.closest("[data-agent-overlay]")) return;
      setPinned(null);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("click", onClick);
    };
  }, [setPinned]);

  // Re-anchor on resize: treemap reflow may move the pinned tile, so re-read
  // its rect via the registry and recenter the pin position. The auto-clear
  // effect in Visualizer handles the case where the tile is gone entirely.
  useEffect(() => {
    if (!pinnedPath) return;
    const onResize = () => {
      const tileEl = registry.get(pinnedPath);
      if (!tileEl) return;
      const rect = tileEl.getBoundingClientRect();
      setPinned(pinnedPath, {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [pinnedPath, registry, setPinned]);

  return null;
}
