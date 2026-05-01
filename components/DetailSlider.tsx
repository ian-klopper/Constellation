/**
 * Header-mounted slider for the LOD floor. Right = more detail (lower
 * minRender, smaller tiles render); left = less detail (higher minRender,
 * only big tiles survive the gate). The displayed slider value is the
 * inverse of minRender so the natural reading ("more = right") matches the
 * resulting visual density.
 */
"use client";

import { LOD_RANGE, useLod } from "./LodContext";

export function DetailSlider() {
  const { minRender, setMinRender } = useLod();
  // Invert so dragging right = smaller minRender = more detail visible.
  const sliderValue = LOD_RANGE.MIN + LOD_RANGE.MAX - minRender;

  return (
    <label className="flex items-center gap-2 text-[11px] text-zinc-500">
      <span className="uppercase tracking-wider">Detail</span>
      <input
        type="range"
        min={LOD_RANGE.MIN}
        max={LOD_RANGE.MAX}
        step={1}
        value={sliderValue}
        onChange={(e) => {
          const v = Number.parseInt(e.target.value, 10);
          if (!Number.isFinite(v)) return;
          setMinRender(LOD_RANGE.MIN + LOD_RANGE.MAX - v);
        }}
        className="h-1 w-32 cursor-pointer accent-zinc-500"
        aria-label="Level of detail"
      />
      <span className="w-10 text-right tabular-nums">{minRender}px</span>
    </label>
  );
}
