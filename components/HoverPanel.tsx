/**
 * The little card that pops up next to your cursor when you hover a file.
 * Shows what the file does, the things it shares with the rest of the app,
 * and which other files it pulls from or is pulled by.
 *
 * The panel is pointer-interactive so its content can be wheel-scrolled and
 * its text selected. In hover mode the panel edge-touches the cursor (zero
 * offset) so there's no gap for the cursor to traverse and hover survival
 * works reliably; in pin mode it keeps a 16px offset so it doesn't cover
 * the click target.
 */
"use client";

import { useEffect, useRef } from "react";
import { SymbolRow } from "./SymbolRow";
import { useHover, type Pos } from "./HoverContext";
import { HOVER_PANEL } from "@/lib/constants";
import type { FileNode } from "@/lib/types";

const {
  WIDTH: PANEL_WIDTH,
  HARD_MAX_H: PANEL_HARD_MAX_H,
  FALLBACK_WIN_W,
  FALLBACK_WIN_H,
  MIN_MAX_H,
  CURSOR_OFFSET,
  VIEWPORT_PADDING,
  MIN_BELOW_BEFORE_FLIP,
} = HOVER_PANEL;

export function HoverPanel({
  file,
  mousePos,
  pinned = false,
  pinnedPos = null,
  onClose,
}: {
  file: FileNode | null;
  mousePos: Pos | null;
  pinned?: boolean;
  pinnedPos?: Pos | null;
  onClose?: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { panelHoveredRef } = useHover();

  // Reset scrollTop on file change without remounting the panel. A keyed
  // remount (key={file.path}) would destroy the DOM element on every hover
  // transition, causing visible flicker and breaking the no-flash promise
  // for re-pin (R10).
  useEffect(() => {
    scrollRef.current?.scrollTo(0, 0);
  }, [file?.path]);

  // Reset panelHoveredRef on unmount: if the panel disappears while the
  // cursor is over it (Esc, close button, file deletion), onMouseLeave
  // never fires and the ref would stay stuck `true`, suppressing every
  // future tile mouseleave indefinitely.
  useEffect(
    () => () => {
      panelHoveredRef.current = false;
    },
    [panelHoveredRef],
  );

  const pos = pinned ? pinnedPos : mousePos;
  if (!file || !pos) return null;

  // Hover mode: zero offset so the panel touches the cursor — no gap to
  // traverse means relatedTarget-based hover survival works reliably.
  // Pin mode: keep the offset so the panel doesn't cover the click target.
  const effectiveOffset = pinned ? CURSOR_OFFSET : 0;

  const winW = typeof window !== "undefined" ? window.innerWidth : FALLBACK_WIN_W;
  const winH = typeof window !== "undefined" ? window.innerHeight : FALLBACK_WIN_H;

  // Horizontal: default to the right of the anchor; flip to the left if the
  // (fixed-width) panel would run off the right edge.
  let left = pos.x + effectiveOffset;
  if (left + PANEL_WIDTH > winW - VIEWPORT_PADDING) {
    left = pos.x - PANEL_WIDTH - effectiveOffset;
  }
  if (left < VIEWPORT_PADDING) left = VIEWPORT_PADDING;

  // Vertical: panel height depends on content, so we can't pre-compute it.
  // Trick: when flipping above the anchor, set top to (anchorY - offset) and
  // apply translateY(-100%) so the panel's *bottom* anchors there. That way
  // the near edge stays close to the anchor regardless of how tall the
  // panel ends up — no leaping up to the top of the screen on short panels.
  const spaceBelow = winH - pos.y - effectiveOffset - VIEWPORT_PADDING;
  const spaceAbove = pos.y - effectiveOffset - VIEWPORT_PADDING;
  const flipUp =
    spaceBelow < MIN_BELOW_BEFORE_FLIP && spaceAbove > spaceBelow;

  let top = flipUp ? pos.y - effectiveOffset : pos.y + effectiveOffset;
  const maxH = Math.max(
    MIN_MAX_H,
    Math.min(PANEL_HARD_MAX_H, flipUp ? spaceAbove : spaceBelow),
  );
  const transform = flipUp ? "translateY(-100%)" : undefined;

  // Final viewport-edge safety. flipUp/maxH already cover the common cases;
  // this catches corners (very short viewports, anchor in a corner) where
  // the rendered rect could still leak past the edge.
  if (flipUp) {
    if (top - maxH < VIEWPORT_PADDING) top = VIEWPORT_PADDING + maxH;
  } else if (top < VIEWPORT_PADDING) {
    top = VIEWPORT_PADDING;
  }

  return (
    <div
      ref={scrollRef}
      data-hover-panel
      onMouseEnter={() => {
        panelHoveredRef.current = true;
      }}
      onMouseLeave={() => {
        panelHoveredRef.current = false;
      }}
      style={{ left, top, width: PANEL_WIDTH, maxHeight: maxH, transform }}
      className="fixed z-40 overflow-y-auto rounded-sm border border-zinc-300 bg-white/95 p-3 text-[11px] text-zinc-800 shadow-lg backdrop-blur-sm"
    >
      {pinned && onClose && (
        <button
          type="button"
          aria-label="Close panel"
          onClick={onClose}
          className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded text-base leading-none text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
        >
          ×
        </button>
      )}
      <div className="mb-1 break-all pr-6 text-[10px] uppercase tracking-[0.15em] text-zinc-500">
        {file.path}
      </div>
      <div className="mb-2 text-[12px] font-medium text-zinc-900">
        {file.name}
      </div>

      {file.description && (
        <p className="mb-3 leading-snug text-zinc-700">{file.description}</p>
      )}

      {file.symbols.length > 0 && (
        <Section label="Exports">
          <ul className="-mx-3 flex flex-col">
            {file.symbols.map((s, i) => (
              <li key={`${s.name}-${i}`}>
                <SymbolRow symbol={s} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section label={`← Imports from (${file.imports.length})`}>
        <PathList paths={file.imports} emptyText="No internal imports." />
      </Section>

      <Section label={`→ Imported by (${file.importedBy.length})`}>
        <PathList paths={file.importedBy} emptyText="Not imported anywhere." />
      </Section>
    </div>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-3 border-t border-zinc-200 pt-2 first:mt-0 first:border-t-0 first:pt-0">
      <div className="mb-1 text-[10px] uppercase tracking-[0.15em] text-zinc-500">
        {label}
      </div>
      {children}
    </div>
  );
}

function PathList({
  paths,
  emptyText,
}: {
  paths: string[];
  emptyText: string;
}) {
  if (paths.length === 0) {
    return <div className="text-[11px] italic text-zinc-400">{emptyText}</div>;
  }
  return (
    <ul className="flex flex-col gap-0.5">
      {paths.map((p) => (
        <li key={p} className="break-all text-[11px] text-zinc-700">
          {p}
        </li>
      ))}
    </ul>
  );
}
