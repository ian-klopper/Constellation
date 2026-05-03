/**
 * Holds the live-update map of file path → description that the SSE
 * stream pushes during a `constellation describe` run, and exposes a
 * resolver hook so individual tiles and the hover panel pull whichever
 * description is freshest. Server-rendered descriptions baked into the
 * tree at scan time are the default; live entries override them.
 *
 * The bridge component below subscribes to the stream and pumps it into
 * the context — kept separate so the context provider itself stays a
 * pure render boundary while the subscription effect lives in the
 * component subtree.
 */
"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useDescriptionStream } from "@/hooks/useDescriptionStream";

type LiveMap = Map<string, string>;

const LiveDescriptionsContext = createContext<LiveMap>(new Map());

// Wraps the visualizer subtree, opens the SSE subscription for the
// current repo, and feeds incoming descriptions into the context. Mount
// this once near the top of the page (inside the page-level server
// component, immediately around <Visualizer />).
export function LiveDescriptionsBridge({
  root,
  children,
}: {
  root: string;
  children: ReactNode;
}) {
  const live = useDescriptionStream(root);
  return (
    <LiveDescriptionsContext.Provider value={live}>
      {children}
    </LiveDescriptionsContext.Provider>
  );
}

// Resolves the description for a file: live wins over server-rendered.
// Also returns whether the resolved value came from the live stream and
// whether it just changed, so consumers (FileTile, HoverPanel) can fire
// a one-shot pop-in animation when fresh data lands.
export function useResolvedDescription(
  filePath: string,
  serverDescription: string | undefined,
): { description: string | undefined; isLive: boolean; popKey: number } {
  const live = useContext(LiveDescriptionsContext);
  const liveValue = live.get(filePath);

  // popKey increments each time the live value changes — consumers key
  // a CSS-animation effect on it so the same tile re-fires the pop-in
  // if it gets re-described later (e.g. `describe --force`). useRef
  // gives a stable mutable slot for the last-seen value across renders
  // (useMemo with [] is unsound under StrictMode's double-render).
  const [popKey, setPopKey] = useState(0);
  const lastSeenRef = useRef<string | undefined>(liveValue);
  useEffect(() => {
    if (liveValue !== undefined && liveValue !== lastSeenRef.current) {
      lastSeenRef.current = liveValue;
      setPopKey((k) => k + 1);
    }
  }, [liveValue]);

  return {
    description: liveValue ?? serverDescription,
    isLive: liveValue !== undefined,
    popKey,
  };
}
