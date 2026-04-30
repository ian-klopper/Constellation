/**
 * Floating info panel pinned to the bottom-left of the viewport. Shows the
 * description, exports, and import/importer lists for the file the cursor is
 * currently over. Hidden when nothing is hovered.
 */
import { SymbolRow } from "./SymbolRow";
import type { FileNode } from "@/lib/types";

export function HoverPanel({ file }: { file: FileNode | null }) {
  if (!file) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-40 w-[320px] max-h-[60vh] overflow-y-auto rounded-sm border border-zinc-300 bg-white/95 p-3 text-[11px] text-zinc-800 shadow-lg backdrop-blur-sm">
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
