/**
 * Shared "which file paths are being actively edited right now" — derived
 * from the live agent stream and made available to every FileTile via
 * useIsEditing(). Membership is recomputed only when the set of
 * editing paths actually changes (compared by sorted-join), so
 * TreemapNode's React.memo isn't busted on every snapshot tick.
 */
"use client";

import {
  createContext,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useAgentStream } from "@/hooks/useAgentStream";

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit"]);

const EditingHighlightContext = createContext<Set<string>>(new Set());

export function EditingHighlightProvider({
  root,
  children,
}: {
  root: string;
  children: ReactNode;
}) {
  const { agents } = useAgentStream();
  const lastSetRef = useRef<Set<string>>(new Set());
  const lastKeyRef = useRef<string>("");

  const value = useMemo(() => {
    const next = new Set<string>();
    for (const a of agents) {
      if (a.cwd !== root) continue;
      if (a.status !== "active") continue;
      if (!a.currentPath) continue;
      if (!EDIT_TOOLS.has(a.currentTool ?? "")) continue;
      next.add(a.currentPath);
    }
    // Stabilize identity: if membership matches last emission, hand back
    // the previous Set so consumers' === checks don't fire.
    const key = Array.from(next).sort().join("\n");
    if (key === lastKeyRef.current) return lastSetRef.current;
    lastKeyRef.current = key;
    lastSetRef.current = next;
    return next;
  }, [agents, root]);

  return (
    <EditingHighlightContext.Provider value={value}>
      {children}
    </EditingHighlightContext.Provider>
  );
}

export function useIsEditing(path: string): boolean {
  return useContext(EditingHighlightContext).has(path);
}
