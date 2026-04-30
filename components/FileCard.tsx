import { SymbolRow } from "./SymbolRow";
import type { FileNode } from "@/lib/types";

export function FileCard({ file }: { file: FileNode }) {
  return (
    <article className="flex flex-col rounded-sm border border-zinc-300 bg-white/50">
      <header className="border-b border-zinc-300 bg-white/40 px-3 py-1.5 text-[11px] text-zinc-700">
        {file.path}
      </header>
      <ul className="flex flex-1 flex-col">
        {file.symbols.map((s, i) => (
          <li
            key={`${s.name}-${i}`}
            className="border-b border-dotted border-zinc-300 last:border-b-0"
          >
            <SymbolRow symbol={s} />
          </li>
        ))}
      </ul>
    </article>
  );
}
