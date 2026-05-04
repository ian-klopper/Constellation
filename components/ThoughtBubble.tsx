/**
 * Live thought bubble anchored above an agent icon. Pure presentational —
 * takes a pre-resolved text string and the colored border class for its
 * agent, sits above its parent's bottom edge via `bottom: 100%`, and
 * inherits opacity from the icon wrapper so it fades in/out on the same
 * timeline as the icon. When N agents share a tile, the caller passes a
 * stackIndex so each bubble offsets vertically and the texts stay readable.
 */
"use client";

import { BUBBLE } from "@/lib/constants";

type Props = {
  text: string;
  /** Tailwind border-* class so the left edge color-matches the agent's ring. */
  colorClass: string;
  /** 0 = closest to icon, 1 = above that, ... — only matters when bubbles share a tile. */
  stackIndex: number;
};

export function ThoughtBubble({ text, colorClass, stackIndex }: Props) {
  if (!text) return null;
  const stackOffsetPx = stackIndex * (BUBBLE.HEIGHT + BUBBLE.GAP);
  return (
    <div
      data-thought-bubble
      className={`pointer-events-none absolute bottom-full left-1/2 line-clamp-2 whitespace-normal rounded-md border-l-[3px] bg-white/95 px-2 py-1 text-[11px] leading-snug text-zinc-700 shadow-md ${colorClass}`}
      style={{
        maxWidth: BUBBLE.MAX_WIDTH,
        transform: `translate(-50%, -${stackOffsetPx}px)`,
        marginBottom: BUBBLE.GAP,
      }}
    >
      {text}
    </div>
  );
}
