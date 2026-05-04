/**
 * Subscribes to /api/descriptions/stream?repo=<root> (SSE) for the
 * given repo and returns a live Map<repo-relative-path, description>
 * that grows as `constellation describe` writes new entries. Transport
 * (connection sharing across hook instances, reconnect backoff) lives
 * in sse-registry; this hook just accumulates events into local state.
 */
"use client";

import { useEffect, useState } from "react";
import { subscribeSSE } from "./sse-registry";

type DescriptionUpdate = {
  cwd: string;
  path: string;
  description: string;
};

export function useDescriptionStream(repoRoot: string): Map<string, string> {
  const [map, setMap] = useState<Map<string, string>>(() => new Map());

  useEffect(() => {
    let cancelled = false;

    // Reset state when the visualized repo changes — stale updates
    // from the previous repo would mis-attribute descriptions to
    // unrelated paths.
    setMap(new Map());

    return subscribeSSE<Partial<DescriptionUpdate>>({
      url: `/api/descriptions/stream?repo=${encodeURIComponent(repoRoot)}`,
      event: "description",
      onMessage: (data) => {
        if (cancelled) return;
        if (typeof data.path !== "string" || typeof data.description !== "string") return;
        // Daemon already filters by ?repo=, but defensively double-check.
        if (typeof data.cwd === "string" && data.cwd !== repoRoot) return;
        setMap((prev) => {
          const next = new Map(prev);
          next.set(data.path!, data.description!);
          return next;
        });
      },
    });
  }, [repoRoot]);

  return map;
}
