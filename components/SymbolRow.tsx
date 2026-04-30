/**
 * One row in the hover panel's "Exports" list: a Glyph for the symbol kind
 * plus the symbol name. Kept generic so other surfaces (debug views, future
 * sidebars) can reuse it.
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
