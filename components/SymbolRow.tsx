import { Glyph } from "./Glyph";
import type { SymbolNode } from "@/lib/types";

export function SymbolRow({ symbol }: { symbol: SymbolNode }) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-3">
      <Glyph kind={symbol.kind} />
      <span className="text-[12px] text-zinc-800">{symbol.name}</span>
    </div>
  );
}
