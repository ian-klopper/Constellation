/**
 * Header-mounted slider for the LOD level. Slider value is the level
 * directly: 1 (least detail) to 60 (most detail). Right = more detail.
 * The level → tile-size mapping lives in LodContext as
 * `levelToMinRender`; this component just shoves the level around.
 */
"use client";

import { LOD, useLod } from "./LodContext";

export function DetailSlider() {
  const { level, setLevel } = useLod();

  return (
    <label className="flex items-center gap-2 text-[11px] text-zinc-500">
      <span className="uppercase tracking-wider">Detail</span>
      <input
        type="range"
        min={LOD.MIN_LEVEL}
        max={LOD.MAX_LEVEL}
        step={1}
        value={level}
        onChange={(e) => {
          const v = Number.parseInt(e.target.value, 10);
          if (!Number.isFinite(v)) return;
          setLevel(v);
        }}
        className="h-1 w-32 cursor-pointer accent-zinc-500"
        aria-label="Level of detail"
      />
      <span className="w-6 text-right tabular-nums">{level}</span>
    </label>
  );
}
