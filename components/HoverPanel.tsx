/**
 * The little card that pops up next to your cursor when you hover a file.
 * Shows what the file does, the things it shares with the rest of the app,
 * and which other files it pulls from or is pulled by.
 */
import { SymbolRow } from "./SymbolRow";
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
}: {
  file: FileNode | null;
  mousePos: { x: number; y: number } | null;
}) {
  if (!file || !mousePos) return null;

  const winW = typeof window !== "undefined" ? window.innerWidth : FALLBACK_WIN_W;
  const winH = typeof window !== "undefined" ? window.innerHeight : FALLBACK_WIN_H;

  // Horizontal: default to the right of the cursor; flip to the left if the
  // (fixed-width) panel would run off the right edge.
  let left = mousePos.x + CURSOR_OFFSET;
  if (left + PANEL_WIDTH > winW - VIEWPORT_PADDING) {
    left = mousePos.x - PANEL_WIDTH - CURSOR_OFFSET;
  }
  if (left < VIEWPORT_PADDING) left = VIEWPORT_PADDING;

  // Vertical: panel height depends on content, so we can't pre-compute it.
  // Trick: when flipping above the cursor, set top to (cursorY - offset) and
  // apply translateY(-100%) so the panel's *bottom* anchors there. That way
  // the near edge stays close to the cursor regardless of how tall the
  // panel ends up — no leaping up to the top of the screen on short panels.
  const spaceBelow = winH - mousePos.y - CURSOR_OFFSET - VIEWPORT_PADDING;
  const spaceAbove = mousePos.y - CURSOR_OFFSET - VIEWPORT_PADDING;
  const flipUp =
    spaceBelow < MIN_BELOW_BEFORE_FLIP && spaceAbove > spaceBelow;

  const top = flipUp
    ? mousePos.y - CURSOR_OFFSET
    : mousePos.y + CURSOR_OFFSET;
  const maxH = Math.max(
    MIN_MAX_H,
    Math.min(PANEL_HARD_MAX_H, flipUp ? spaceAbove : spaceBelow),
  );
  const transform = flipUp ? "translateY(-100%)" : undefined;

  return (
    <div
      style={{ left, top, width: PANEL_WIDTH, maxHeight: maxH, transform }}
      className="pointer-events-none fixed z-40 overflow-y-auto rounded-sm border border-zinc-300 bg-white/95 p-3 text-[11px] text-zinc-800 shadow-lg backdrop-blur-sm"
    >
      <div className="mb-1 text-[10px] uppercase tracking-[0.15em] text-zinc-500">
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
        <li key={p} className="truncate text-[11px] text-zinc-700">
          {p}
        </li>
      ))}
    </ul>
  );
}
