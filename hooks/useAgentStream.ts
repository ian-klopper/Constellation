/**
 * Subscribes to /api/agents/stream (SSE), returns the latest snapshot.
 * Falls back to a single /api/agents poll if the EventSource fails — so
 * the overlay still shows something when the daemon is down. Reconnects
 * with exponential backoff (capped at 10s) when the connection drops.
 */
"use client";

import { useEffect, useState } from "react";
import type { ActiveAgent } from "@/lib/types";

const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 10_000;

export function useAgentStream(): ActiveAgent[] {
  const [snapshot, setSnapshot] = useState<ActiveAgent[]>([]);

  useEffect(() => {
    let cancelled = false;
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let backoff = INITIAL_BACKOFF_MS;

    const handleSnapshotEvent = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as ActiveAgent[];
        if (!cancelled) setSnapshot(data);
        backoff = INITIAL_BACKOFF_MS; // healthy stream resets backoff
      } catch {
        // ignore malformed messages
      }
    };

    const fallbackPoll = async () => {
      try {
        const res = await fetch("/api/agents", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { agents: ActiveAgent[] };
        if (!cancelled) setSnapshot(json.agents);
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
