/**
 * Subscribes to /api/descriptions/stream (SSE) for the given repo and
 * returns a live Map<repo-relative-path, description> that grows as
 * `constellation describe` writes new entries. When the daemon is down
 * or the connection drops, reconnects with exponential backoff (capped
 * at 10s) and otherwise stays silent — the visualizer's server-rendered
 * descriptions still show, just without live pop-in.
 */
"use client";

import { useEffect, useState } from "react";

const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 10_000;

type DescriptionUpdate = {
  cwd: string;
  path: string;
  description: string;
};

export function useDescriptionStream(repoRoot: string): Map<string, string> {
  const [map, setMap] = useState<Map<string, string>>(() => new Map());

  useEffect(() => {
    let cancelled = false;
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let backoff = INITIAL_BACKOFF_MS;

    // Reset state when the visualized repo changes — stale updates
    // from the previous repo would mis-attribute descriptions to
    // unrelated paths.
    setMap(new Map());

    const handleDescription = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as Partial<DescriptionUpdate>;
        if (cancelled) return;
        if (typeof data.path !== "string" || typeof data.description !== "string") return;
        // Daemon already filters by ?repo=, but defensively double-check.
        if (typeof data.cwd === "string" && data.cwd !== repoRoot) return;
        setMap((prev) => {
          const next = new Map(prev);
          next.set(data.path!, data.description!);
          return next;
        });
        backoff = INITIAL_BACKOFF_MS;
      } catch {
        // ignore malformed messages
      }
    };

    const connect = () => {
      if (cancelled) return;
      const url = `/api/descriptions/stream?repo=${encodeURIComponent(repoRoot)}`;
      source = new EventSource(url);
      source.addEventListener("description", handleDescription);
      source.onerror = () => {
        source?.close();
        source = null;
        if (cancelled) return;
        reconnectTimer = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      source?.close();
    };
  }, [repoRoot]);

  return map;
}
