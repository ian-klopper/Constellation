/**
 * Focus context — lets the user drill into a subdirectory so its subtree
 * fills the canvas. State lives in ?focus=<rel/path> so reload preserves
 * focus and browser back/forward navigates through the focus history.
 *
 * The zoom-reset callback registered by Visualizer is called synchronously
 * inside the flushSync callback passed to document.startViewTransition. This
 * ensures the "after" View Transition snapshot sees zoom=1 before React has
 * committed the new tree, preventing a visible transform pop when the
 * transition ends.
 */
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import type { DirectoryNode } from "@/lib/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sanitises a node path into a CSS-identifier-safe view-transition-name.
 * Each non-identifier character becomes its hex codepoint wrapped in dashes —
 * collision-free and CSS-safe.
 */
export function vtName(path: string): string {
  if (!path) return "t-root";
  return "t-" + path.replace(/[^a-zA-Z0-9_-]/g, (c) => `-${c.charCodeAt(0).toString(16)}-`);
}

/**
 * Walks the tree from `node` following the segments of `relPath`, returning
 * the matching DirectoryNode or null if any segment misses or the leaf is a
 * file. Paths are slash-separated relative strings, e.g. "lib/scan".
 */
export function findDirectory(
  node: DirectoryNode,
  relPath: string,
): DirectoryNode | null {
  if (!relPath) return node;
  const segments = relPath.split("/").filter(Boolean);
  let current: DirectoryNode = node;
  for (const seg of segments) {
    const child = current.children.find(
      (c) => c.kind === "directory" && c.path === (current.path ? `${current.path}/${seg}` : seg),
    );
    if (!child || child.kind !== "directory") return null;
    current = child;
  }
  return current;
}

// ---------------------------------------------------------------------------
// Context value type
// ---------------------------------------------------------------------------

type FocusContextValue = {
  focusPath: string | null;
  focusedNode: DirectoryNode | null;
  segments: string[];
  setFocusPath: (next: string | null) => void;
  registerResetZoom: (fn: () => void) => () => void;
};

const FocusContext = createContext<FocusContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

function readFocusFromURL(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  return params.get("focus");
}

function buildURL(next: string | null): string {
  const url = new URL(window.location.href);
  if (next) {
    url.searchParams.set("focus", next);
  } else {
    url.searchParams.delete("focus");
  }
  return url.toString();
}

export function FocusContextProvider({
  tree,
  children,
}: {
  tree: DirectoryNode;
  children: ReactNode;
}) {
  // Initialise from URL without validation — the mount effect below cleans up
  // any bad value before the user can interact with it.
  const [focusPath, setFocusPathState] = useState<string | null>(
    () => readFocusFromURL(),
  );

  // Imperative zoom-reset callback registered by Visualizer. Called inside
  // flushSync so the View Transition "after" snapshot sees zoom=1.
  const resetZoomRef = useRef<(() => void) | null>(null);

  const registerResetZoom = useCallback((fn: () => void) => {
    resetZoomRef.current = fn;
    return () => {
      resetZoomRef.current = null;
    };
  }, []);

  // Core state transition. Validates the new path, builds the new URL, then
  // fires via View Transitions if available, falling back to a direct
  // flushSync call. Order inside flushSync is load-bearing — see module doc.
  const setFocusPath = useCallback(
    (next: string | null) => {
      // Validate — a path that doesn't exist in the tree becomes null so the
      // URL is cleaned up rather than left pointing at a missing directory.
      const resolved = next ? findDirectory(tree, next) : null;
      const validated = resolved ? next : null;

      const url = buildURL(validated);

      const commit = () => {
        flushSync(() => {
          resetZoomRef.current?.();
          setFocusPathState(validated);
          window.history.pushState({}, "", url);
        });
      };

      if (typeof document !== "undefined" && "startViewTransition" in document) {
        // startViewTransition accepts a callback whose return value is ignored
        // when it's not a Promise. flushSync makes it synchronous so the
        // snapshot is taken at the right moment.
        (document as Document & { startViewTransition: (cb: () => void) => unknown }).startViewTransition(commit);
      } else {
        commit();
      }
    },
    [tree],
  );

  // Mount-time URL hygiene: if the URL contains a ?focus= that doesn't
  // resolve to a real directory (deleted dir, pasted junk URL), clean it up.
  useEffect(() => {
    const raw = readFocusFromURL();
    if (raw && !findDirectory(tree, raw)) {
      window.history.replaceState({}, "", buildURL(null));
      setFocusPathState(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once on mount only

  // Browser back/forward: re-read ?focus= from the URL, animate the
  // transition the same way as a direct setFocusPath call.
  useEffect(() => {
    const onPopState = () => {
      const raw = readFocusFromURL();
      const resolved = raw ? findDirectory(tree, raw) : null;
      const validated = raw && resolved ? raw : null;

      const commit = () => {
        flushSync(() => {
          resetZoomRef.current?.();
          setFocusPathState(validated);
        });
        // Don't pushState here — popstate already moved the URL.
      };

      if (typeof document !== "undefined" && "startViewTransition" in document) {
        (document as Document & { startViewTransition: (cb: () => void) => unknown }).startViewTransition(commit);
      } else {
        commit();
      }
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [tree]);

  const focusedNode = useMemo(
    () => (focusPath ? findDirectory(tree, focusPath) : null),
    [focusPath, tree],
  );

  const segments = useMemo(
    () => (focusPath ? focusPath.split("/").filter(Boolean) : []),
    [focusPath],
  );

  const value = useMemo<FocusContextValue>(
    () => ({
      focusPath,
      focusedNode,
      segments,
      setFocusPath,
      registerResetZoom,
    }),
    [focusPath, focusedNode, segments, setFocusPath, registerResetZoom],
  );

  return <FocusContext.Provider value={value}>{children}</FocusContext.Provider>;
}

// ---------------------------------------------------------------------------
// Consumer hook
// ---------------------------------------------------------------------------

export function useFocusContext(): FocusContextValue {
  const ctx = useContext(FocusContext);
  if (!ctx) throw new Error("useFocusContext must be used inside FocusContextProvider");
  return ctx;
}
