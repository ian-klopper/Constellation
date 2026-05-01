/**
 * Hover state shared between Visualizer and the recursive TreemapNode tree.
 * Lifted into context so TreemapNode doesn't have to thread hoveredPath,
 * inputs, outputs, and onHover through every recursive child. mousePos
 * stays in Visualizer-local state on purpose — putting it here would
 * re-render every tile on every mousemove.
 *
 * panelHoveredRef is a non-reactive escape hatch: a ref object in context
 * has stable identity (only its .current mutates), so reads are cheap and
 * toggling .current does not re-render any consumer. Used for cross-
 * element hover survival between the tile and the floating panel.
 */
"use client";

import { createContext, useContext, type MutableRefObject } from "react";

export type Pos = { x: number; y: number };

export type HoverContextValue = {
  hoveredPath: string | null;
  pinnedPath: string | null;
  pinnedPos: Pos | null;
  inputs: Set<string>;
  outputs: Set<string>;
  setHover: (path: string | null, pos?: Pos) => void;
  setPinned: (path: string | null, pos?: Pos) => void;
  panelHoveredRef: MutableRefObject<boolean>;
};

export const HoverContext = createContext<HoverContextValue | null>(null);

export function useHover(): HoverContextValue {
  const ctx = useContext(HoverContext);
  if (!ctx) {
    throw new Error("useHover must be used inside <HoverContext.Provider>");
  }
  return ctx;
}
