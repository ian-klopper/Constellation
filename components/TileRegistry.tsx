/**
 * Lets TreemapNode register its file-tile DOM elements so AgentOverlay can
 * look them up by path without resorting to document.querySelector. The
 * registry sits in a context so the overlay (rendered inside Visualizer)
 * can read it; tiles call useRegisterTile(path) and pass the returned ref
 * callback to their root element.
 *
 * Subscribers are notified when the registry changes (mount/unmount), so
 * useAgentPositions can re-anchor when tiles come and go (e.g. after a
 * resize triggers a fresh squarify pass).
 */
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

export type TileRegistry = {
  register: (path: string, el: HTMLElement | null) => void;
  get: (path: string) => HTMLElement | null;
  subscribe: (listener: () => void) => () => void;
};

const TileRegistryContext = createContext<TileRegistry | null>(null);

export function TileRegistryProvider({ children }: { children: ReactNode }) {
  const elementsRef = useRef<Map<string, HTMLElement>>(new Map());
  const listenersRef = useRef<Set<() => void>>(new Set());

  const value = useMemo<TileRegistry>(
    () => ({
      register(path, el) {
        if (el) elementsRef.current.set(path, el);
        else elementsRef.current.delete(path);
        for (const listener of listenersRef.current) listener();
      },
      get(path) {
        return elementsRef.current.get(path) ?? null;
      },
      subscribe(listener) {
        listenersRef.current.add(listener);
        return () => listenersRef.current.delete(listener);
      },
    }),
    [],
  );

  return (
    <TileRegistryContext.Provider value={value}>
      {children}
    </TileRegistryContext.Provider>
  );
}

export function useTileRegistry(): TileRegistry {
  const ctx = useContext(TileRegistryContext);
  if (!ctx) {
    throw new Error("useTileRegistry must be used inside <TileRegistryProvider>");
  }
  return ctx;
}

export function useRegisterTile(path: string): (el: HTMLElement | null) => void {
  const registry = useTileRegistry();
  return useCallback(
    (el: HTMLElement | null) => registry.register(path, el),
    [path, registry],
  );
}
