/**
 * A re-render driver tied to wall-clock time. Replaces the old
 * "setInterval(setTick) plus mutate-a-ref-during-render" hack: now
 * idleness is purely derived from `now - agent.lastActiveAt` against
 * the IDLE_DEBOUNCE_MS threshold, and this hook is the only thing
 * that triggers re-renders for the threshold to re-evaluate.
 */
"use client";

import { useEffect, useState } from "react";
import { OVERLAY_TIMING } from "@/lib/constants";

export function useIdleClock(): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), OVERLAY_TIMING.IDLE_TICK_MS);
    return () => clearInterval(id);
  }, []);
  return now;
}
