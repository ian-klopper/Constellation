/**
 * Draws one piece of the map. If it's a folder, it slices its area into
 * rectangles for the things inside and asks itself to draw each one. If
 * it's a file, it draws the filename, the description, and changes color
 * when you hover — the file you're on lights up, the files it pulls from
 * glow blue, the files that pull from it glow amber, and everything else
 * fades.
 */
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
const DESC_MIN_HEIGHT = 32;

type Props = {
  node: TreeNode;
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
  tint: string | null;
  hoveredPath: string | null;
  inputs: Set<string>;
  outputs: Set<string>;
  onHover: (path: string | null, pos?: { x: number; y: number }) => void;
};

export function TreemapNode({
  node,
  x,
  y,
  w,
  h,
  depth,
  tint,
  hoveredPath,
  inputs,
  outputs,
  onHover,
}: Props) {
  const style = {
    position: "absolute" as const,
    left: x,
    top: y,
    width: w,
    height: h,
  };

  if (node.kind === "file") {
    const isHovered = hoveredPath === node.path;
    const isInput = inputs.has(node.path);
    const isOutput = outputs.has(node.path);
    const isUnrelated =
      hoveredPath !== null && !isHovered && !isInput && !isOutput;

    const stateClass = isHovered
      ? "tile-hovered"
      : isInput
        ? "tile-input"
        : isOutput
          ? "tile-output"
          : isUnrelated
            ? "tile-dim"
            : "";

    const showDescription = h >= DESC_MIN_HEIGHT && node.description;

    return (
      // data-path is the AgentOverlay contract — see components/AgentOverlay.tsx.
      // Removing or renaming it will break agent-icon anchoring.
      <article
        data-path={node.path}
        style={style}
        onMouseEnter={(e) =>
          onHover(node.path, { x: e.clientX, y: e.clientY })
        }
        onMouseMove={(e) =>
          onHover(node.path, { x: e.clientX, y: e.clientY })
        }
        onMouseLeave={() => onHover(null)}
        className={`relative overflow-hidden border border-zinc-300 bg-white/40 transition-[opacity,background-color,border-color] duration-150 ${stateClass}`}
      >
        <header className="truncate border-b border-zinc-300 bg-white/30 px-2 py-1 text-[11px] text-zinc-600">
          {node.name}
        </header>
        {showDescription && (
          <p className="px-2 py-1.5 text-[11px] leading-snug text-zinc-700">
            {node.description}
          </p>
        )}
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
              hoveredPath={hoveredPath}
              inputs={inputs}
              outputs={outputs}
              onHover={onHover}
            />
          );
        })}
    </section>
  );
}
