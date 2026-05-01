/**
 * Subscribes to /api/agents/stream (SSE), returns the latest snapshot
 * of { agents, repos }. Falls back to a single /api/agents poll if the
 * EventSource fails — so the overlay still shows something when the
 * daemon is down. Reconnects with exponential backoff (capped at 10s)
 * when the connection drops.
 */
"use client";

import { useEffect, useState } from "react";
import type { ActiveAgent, AgentsPayload, RepoSummary } from "@/lib/types";

const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 10_000;

const EMPTY: AgentsPayload = { agents: [], repos: [] };

export function useAgentStream(): AgentsPayload {
  const [snapshot, setSnapshot] = useState<AgentsPayload>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let backoff = INITIAL_BACKOFF_MS;

    const handleSnapshotEvent = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as Partial<AgentsPayload>;
        if (cancelled) return;
        setSnapshot(normalize(data));
        backoff = INITIAL_BACKOFF_MS; // healthy stream resets backoff
      } catch {
        // ignore malformed messages
      }
    };

    const fallbackPoll = async () => {
      try {
        const res = await fetch("/api/agents", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as Partial<AgentsPayload>;
        if (!cancelled) setSnapshot(normalize(json));
      } catch {
        // ignore
      }
    };

    const connect = () => {
      if (cancelled) return;
      source = new EventSource("/api/agents/stream");
      source.addEventListener("snapshot", handleSnapshotEvent);
      source.onerror = () => {
        source?.close();
        source = null;
        if (cancelled) return;
        // Daemon may be down; show whatever the disk fallback knows so the
        // overlay isn't empty for the entire backoff window.
        fallbackPoll();
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
  }, []);

  return snapshot;
}

function normalize(data: Partial<AgentsPayload>): AgentsPayload {
  const agents: ActiveAgent[] = Array.isArray(data.agents) ? data.agents : [];
  const repos: RepoSummary[] = Array.isArray(data.repos) ? data.repos : [];
  return { agents, repos };
}
