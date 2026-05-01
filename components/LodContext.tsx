/**
 * Global level-of-detail override. The LOD floor (`minRender`) is the
 * minimum on-screen tile dimension below which a directory stops laying
 * out children. Wired through to TreemapNode's render gate.
 *
 * Default is TREEMAP.MIN_RENDER (8 px), which works well for repos at
 * Constellation's scale (~8k files). Larger codebases like Parsley (~54k
 * files) need a higher floor to avoid pixel soup at zoom=1; the user moves
 * the DetailSlider in the header to retune at runtime.
 *
 * State is global, not per-repo (intentional — confirmed with the user).
 * Persisted in localStorage so the value survives reloads.
 */
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { TREEMAP } from "@/lib/constants";

const STORAGE_KEY = "constellation:lod-min-render";

export const LOD_RANGE = {
  MIN: 4,
  MAX: 64,
} as const;

type LodContextValue = {
  minRender: number;
  setMinRender: (value: number) => void;
};

const LodContext = createContext<LodContextValue | null>(null);

export function LodProvider({ children }: { children: ReactNode }) {
  const [minRender, setMinRenderState] = useState<number>(TREEMAP.MIN_RENDER);

  // Hydrate from localStorage after mount. SSR can't read localStorage, so
  // first paint uses the default (8) and the LOD gate re-evaluates after
  // hydration if the stored value differs.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw === null) return;
      const n = Number.parseInt(raw, 10);
      if (Number.isFinite(n) && n >= LOD_RANGE.MIN && n <= LOD_RANGE.MAX) {
        setMinRenderState(n);
      }
    } catch {
      // localStorage can throw in private mode / when disabled. Fall through.
    }
  }, []);

  const setMinRender = useCallback((value: number) => {
    const clamped = Math.min(
      LOD_RANGE.MAX,
      Math.max(LOD_RANGE.MIN, Math.round(value)),
    );
    setMinRenderState(clamped);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(clamped));
    } catch {
      // Persistence is best-effort.
    }
  }, []);

  return (
    <LodContext.Provider value={{ minRender, setMinRender }}>
      {children}
    </LodContext.Provider>
  );
}

export function useLod(): LodContextValue {
  const ctx = useContext(LodContext);
  if (!ctx) {
    throw new Error("useLod must be used inside <LodProvider>");
  }
  return ctx;
}
