import { SymbolRow } from "./SymbolRow";
import { squarify } from "@/lib/treemap";
import type { TreeNode } from "@/lib/types";

const TINTS: Record<string, string> = {
  app: "bg-[#eef2f7]",
  components: "bg-[#e7eee2]",
  lib: "bg-[#f5f5f4]",
  supabase: "bg-[#f3edd9]",
  trigger: "bg-[#f0d9d9]",
};

const LABEL_HEIGHT = 16;
const INNER_PAD = 3;
const MIN_RENDER = 8;

export function TreemapNode({
  node,
  x,
  y,
  w,
  h,
  depth,
  tint,
}: {
  node: TreeNode;
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
  tint: string | null;
}) {
  const style = {
    position: "absolute" as const,
    left: x,
    top: y,
    width: w,
    height: h,
  };

  if (node.kind === "file") {
    return (
      // data-path is the AgentOverlay contract — see components/AgentOverlay.tsx.
      // Removing or renaming it will break agent-icon anchoring.
      <article
        data-path={node.path}
        style={style}
        className="relative overflow-hidden border border-zinc-300 bg-white/40"
      >
        <header className="truncate border-b border-zinc-300 bg-white/30 px-2 py-1 text-[11px] text-zinc-600">
          {node.name}
        </header>
        <ul className="flex flex-col">
          {node.symbols.map((s, i) => (
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

  // Directory branch.
  const isRoot = depth === 0;
  const sectionClass = isRoot
    ? "relative"
    : `relative border border-zinc-300/60 ${tint ?? "bg-zinc-50"}`;

  // Inner rect (local coords, origin at this node's top-left).
  const inner = isRoot
    ? { x: 0, y: 0, w, h }
    : {
        x: INNER_PAD,
        y: LABEL_HEIGHT + INNER_PAD,
        w: w - 2 * INNER_PAD,
        h: h - LABEL_HEIGHT - 2 * INNER_PAD,
      };

  const canRender =
    inner.w >= MIN_RENDER && inner.h >= MIN_RENDER && node.children.length > 0;

  const childRects = canRender
    ? squarify(
        node.children.map((c) => ({
          value: c.kind === "file" ? c.lines : c.totalLines,
        })),
        inner,
      )
    : [];

  return (
    <section style={style} className={sectionClass}>
      {!isRoot && (
        <div className="pointer-events-none absolute left-1 top-0.5 truncate text-[10px] tracking-[0.15em] uppercase text-zinc-500">
          {node.name}/
        </div>
      )}
      {canRender &&
        node.children.map((child, idx) => {
          const r = childRects[idx];
          const childTint =
            isRoot && child.kind === "directory"
              ? (TINTS[child.name] ?? null)
              : tint;
          return (
            <TreemapNode
              key={child.kind === "file" ? child.path : `dir:${child.path}`}
              node={child}
              x={r.x}
              y={r.y}
              w={r.w}
              h={r.h}
              depth={depth + 1}
              tint={childTint}
            />
          );
        })}
    </section>
  );
}
