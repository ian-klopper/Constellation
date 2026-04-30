/**
 * Hover state shared between Visualizer and the recursive TreemapNode tree.
 * Lifted into context so TreemapNode doesn't have to thread hoveredPath,
 * inputs, outputs, and onHover through every recursive child. mousePos
 * stays in Visualizer-local state on purpose — putting it here would
 * re-render every tile on every mousemove.
 */
"use client";

import { createContext, useContext } from "react";

export type HoverContextValue = {
  hoveredPath: string | null;
  inputs: Set<string>;
  outputs: Set<string>;
  setHover: (path: string | null, pos?: { x: number; y: number }) => void;
};

export const HoverContext = createContext<HoverContextValue | null>(null);

export function useHover(): HoverContextValue {
  const ctx = useContext(HoverContext);
  if (!ctx) {
    throw new Error("useHover must be used inside <HoverContext.Provider>");
  }
  return ctx;
}
