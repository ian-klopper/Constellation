/**
 * One line in the hover card's "Exports" list — a small shape that hints at
 * what kind of thing it is (component, hook, type, etc.) followed by the
 * name.
 */
import { Glyph } from "./Glyph";
import type { SymbolNode } from "@/lib/types";

export function SymbolRow({ symbol }: { symbol: SymbolNode }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1">
      <Glyph kind={symbol.kind} />
      <span className="text-[11px] text-zinc-800">{symbol.name}</span>
    </div>
  );
}
