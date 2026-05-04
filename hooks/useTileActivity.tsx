/**
 * Universal tile-activity fade. Reads every agent's pathHistory (stamped on
 * every tool touch — Read, Bash, Grep, Edit, Write, etc.) and returns per-path
 * decay data so TreemapNode can render a fading glow that outlasts the touch.
 *
 * Identity stability is the load-bearing concern: a 200ms heartbeat would bust
 * TreemapNode's React.memo for every tile on every tick unless we gate on a
 * content hash and hand back the previous Map reference when nothing changed.
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
import { useAgentStream } from "@/hooks/useAgentStream";
import { agentColor } from "@/lib/agent-colors";
import { TILE_TOUCH } from "@/lib/constants";
import type { ActiveAgent } from "@/lib/types";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type TileTouch = {
  opacity: number;
  color: string;
  isEdit: boolean;
};

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const TileActivityContext = createContext<Map<string, TileTouch>>(new Map());

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function TileActivityProvider({
  root,
  initialAgents,
  children,
}: {
  root: string;
  initialAgents?: ActiveAgent[];
  children: ReactNode;
}) {
  const { agents } = useAgentStream(initialAgents);

  // 200ms heartbeat so opacity decays smoothly between SSE events.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TILE_TOUCH.TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Previous Map reference and content hash — hand back the old Map when
  // nothing actually changed, so consumers' context-equality check fires and
  // TreemapNode's React.memo skips re-rendering untouched tiles.
  const lastMapRef = useRef<Map<string, TileTouch>>(new Map());
  const lastHashRef = useRef<string>("");

  // Per-path object reference cache — if (opacity, color, isEdit) is
  // unchanged, hand back the same object so prop-equality on consumers holds.
  const lastObjectsRef = useRef<Map<string, TileTouch>>(new Map());

  // Build the next map from the current snapshot + now.
  const next = new Map<string, TileTouch>();
  for (const agent of agents) {
    if (agent.cwd !== root) continue;
    if (!agent.pathHistory || agent.pathHistory.length === 0) continue;
    const color = agentColor(agent).fillRgb;

    for (const entry of agent.pathHistory) {
      const { path, ts } = entry;
      // Keep the latest ts across all agents for this path.
      const existing = next.get(path);
      if (existing && (existing as TileTouch & { _ts?: number })._ts !== undefined) {
        const existingTs = (existing as TileTouch & { _ts?: number })._ts!;
        if (ts <= existingTs) continue;
      }

      const rawOpacity = Math.max(
        0,
        1 - (now - ts * 1000) / TILE_TOUCH.FADE_MS,
      );
      // Round to OPACITY_QUANTUM so most ticks produce identical values.
      const opacity =
        Math.round(rawOpacity / TILE_TOUCH.OPACITY_QUANTUM) *
        TILE_TOUCH.OPACITY_QUANTUM;
      if (opacity <= 0) continue;

      // isEdit: daemon stamps both pathHistory[i].ts and lastEditAt via
      // nowSeconds() in the same lifecycle write — so exact-equal means this
      // entry was an Edit/Write/MultiEdit touch. A future refactor that splits
      // the two writes would silently break this heuristic; if that happens,
      // pass isEdit explicitly on the wire instead.
      const isEdit = agent.lastEditAt === ts;

      // Store ts as a hidden field for the max-ts comparison above.
      const touch = { opacity, color, isEdit, _ts: ts } as TileTouch & { _ts: number };
      next.set(path, touch);
    }
  }

  // Strip the hidden _ts fields and build the content hash.
  // For each path, use the clean triple for the hash and for the final Map.
  const clean = new Map<string, TileTouch>();
  for (const [path, touch] of next) {
    const { opacity, color, isEdit } = touch;
    clean.set(path, { opacity, color, isEdit });
  }

  const sorted = [...clean.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  const hash = sorted
    .map(
      ([p, v]) =>
        `${p}|${v.opacity.toFixed(2)}|${v.color}|${v.isEdit ? "e" : "-"}`,
    )
    .join("\n");

  let published: Map<string, TileTouch>;
  if (hash === lastHashRef.current) {
    // Nothing changed — hand back the previous Map reference so context
    // consumers don't re-render.
    published = lastMapRef.current;
  } else {
    // Build a new Map, but reuse object references for unchanged entries.
    const newMap = new Map<string, TileTouch>();
    const prevObjects = lastObjectsRef.current;
    for (const [path, v] of clean) {
      const prev = prevObjects.get(path);
      if (
        prev &&
        prev.opacity === v.opacity &&
        prev.color === v.color &&
        prev.isEdit === v.isEdit
      ) {
        // Triple unchanged — reuse the old object so prop-equality holds.
        newMap.set(path, prev);
      } else {
        newMap.set(path, v);
      }
    }
    lastHashRef.current = hash;
    lastMapRef.current = newMap;
    lastObjectsRef.current = newMap;
    published = newMap;
  }

  return (
    <TileActivityContext.Provider value={published}>
      {children}
    </TileActivityContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Consumer hook
// ---------------------------------------------------------------------------

/**
 * Returns the touch data for a given absolute path, or null when the path is
 * absent or its computed opacity has decayed to zero. Returning null lets
 * TreemapNode skip all className/style work for inactive tiles.
 */
export function useTileActivity(path: string): TileTouch | null {
  const map = useContext(TileActivityContext);
  return map.get(path) ?? null;
}
