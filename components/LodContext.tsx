/**
 * Global level-of-detail override. The slider exposes a level from 1
 * (least detail) to 60 (most detail); internally each level maps to a
 * minimum on-screen tile dimension (`minRender`) below which a directory
 * stops laying out children. TreemapNode reads `minRender` for its gate.
 *
 * Mapping is exponential — `minRender = 2^(8 * (60 − level) / 59)` —
 * so level 1 ≈ 256 px (only the very biggest tiles), level 60 = 1 px
 * (everything renders), and level 38 ≈ 8 px (the previous default that
 * works well for Constellation-sized repos). Exponential is the right
 * shape because perceptual difference between e.g. 100 px and 200 px is
 * tiny but between 1 px and 4 px it's huge.
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
  useMemo,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "constellation:lod-level";

export const LOD = {
  MIN_LEVEL: 1,
  MAX_LEVEL: 60,
  // Picked so levelToMinRender(DEFAULT_LEVEL) ≈ 8 px, the historical
  // hard-coded MIN_RENDER. Sits near the high-detail end of the slider.
  DEFAULT_LEVEL: 38,
} as const;

export function levelToMinRender(level: number): number {
  const exponent = (8 * (LOD.MAX_LEVEL - level)) / (LOD.MAX_LEVEL - 1);
  return Math.max(1, Math.round(2 ** exponent));
}

type LodContextValue = {
  level: number;
  setLevel: (value: number) => void;
  minRender: number;
};

const LodContext = createContext<LodContextValue | null>(null);

export function LodProvider({ children }: { children: ReactNode }) {
  const [level, setLevelState] = useState<number>(LOD.DEFAULT_LEVEL);

  // Hydrate from localStorage after mount. SSR can't read localStorage, so
  // first paint uses the default and the LOD gate re-evaluates after
  // hydration if the stored value differs.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw === null) return;
      const n = Number.parseInt(raw, 10);
      if (Number.isFinite(n) && n >= LOD.MIN_LEVEL && n <= LOD.MAX_LEVEL) {
        setLevelState(n);
      }
    } catch {
      // localStorage can throw in private mode / when disabled. Fall through.
    }
  }, []);

  const setLevel = useCallback((value: number) => {
    const clamped = Math.min(
      LOD.MAX_LEVEL,
      Math.max(LOD.MIN_LEVEL, Math.round(value)),
    );
    setLevelState(clamped);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(clamped));
    } catch {
      // Persistence is best-effort.
    }
  }, []);

  const value = useMemo<LodContextValue>(
    () => ({ level, setLevel, minRender: levelToMinRender(level) }),
    [level, setLevel],
  );

  return <LodContext.Provider value={value}>{children}</LodContext.Provider>;
}

export function useLod(): LodContextValue {
  const ctx = useContext(LodContext);
  if (!ctx) {
    throw new Error("useLod must be used inside <LodProvider>");
  }
  return ctx;
}
