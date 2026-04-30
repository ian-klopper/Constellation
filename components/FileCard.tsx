import { SymbolRow } from "./SymbolRow";
import type { FileNode } from "@/lib/types";

export function FileCard({
  file,
  stripPrefix,
}: {
  file: FileNode;
  stripPrefix: string;
}) {
  const prefix = stripPrefix + "/";
  const display = file.path.startsWith(prefix)
    ? file.path.slice(prefix.length)
    : file.path;

  return (
    <article
      data-path={file.path}
      className="flex flex-col border border-zinc-300 bg-white/40"
    >
      <header className="border-b border-zinc-300 bg-white/30 px-3 py-2 text-[11px] text-zinc-600">
        {display}
      </header>
      <ul className="flex flex-1 flex-col">
        {file.symbols.map((s, i) => (
          <li
            key={`${s.name}-${i}`}
            className="border-b border-dotted border-zinc-400/60 last:border-b-0"
          >
            <SymbolRow symbol={s} />
          </li>
        ))}
      </ul>
    </article>
  );
}
