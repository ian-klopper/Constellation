/**
 * Subscribes to /api/agents/stream (SSE) and returns the latest
 * { agents, repos } snapshot. The transport — connection sharing,
 * exponential-backoff reconnect, and a coalesced /api/agents fallback
 * poll on transport errors — lives in sse-registry; this hook is just
 * the React-state shim on top.
 */
"use client";

import { useEffect, useState } from "react";
import type { ActiveAgent, AgentsPayload, RepoSummary } from "@/lib/types";
import { subscribeSSE, fetchOnce } from "./sse-registry";

const EMPTY: AgentsPayload = { agents: [], repos: [] };

export function useAgentStream(): AgentsPayload {
  const [snapshot, setSnapshot] = useState<AgentsPayload>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    return subscribeSSE<Partial<AgentsPayload>>({
      url: "/api/agents/stream",
      event: "snapshot",
      onMessage: (data) => {
        if (cancelled) return;
        setSnapshot(normalize(data));
      },
      onError: () => {
        // Daemon may be down; show whatever the disk fallback knows so the
        // overlay isn't empty for the entire backoff window. fetchOnce
        // dedupes concurrent fetches so 4+ consumers all hitting an error
        // event share one network round-trip.
        fetchOnce<Partial<AgentsPayload>>("/api/agents").then((data) => {
          if (cancelled || !data) return;
          setSnapshot(normalize(data));
        });
      },
    });
    // The unsubscribe returned by subscribeSSE handles cleanup; the
    // `cancelled` flag guards against late async fallback-poll resolves.
  }, []);

  return snapshot;
}

function normalize(data: Partial<AgentsPayload>): AgentsPayload {
  const agents: ActiveAgent[] = Array.isArray(data.agents) ? data.agents : [];
  const repos: RepoSummary[] = Array.isArray(data.repos) ? data.repos : [];
  return { agents, repos };
}
