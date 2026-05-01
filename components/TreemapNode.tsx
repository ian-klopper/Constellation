/**
 * Draws one piece of the map. If it's a folder, it slices its area into
 * rectangles for the things inside and asks itself to draw each one. If
 * it's a file, it draws the filename, the description, and changes color
 * when you hover — the file you're on lights up, the files it pulls from
 * glow blue, the files that pull from it glow amber, and everything else
 * fades.
 */
"use client";

import { squarify } from "@/lib/treemap";
import { TREEMAP } from "@/lib/constants";
import { useHover } from "./HoverContext";
import { useRegisterTile } from "./TileRegistry";
import type { TreeNode } from "@/lib/types";

const {
  LABEL_HEIGHT,
  INNER_PAD,
  MIN_RENDER,
  TINTS,
  DESCRIPTION_LINE_HEIGHT,
  DESCRIPTION_PADDING_Y,
  FILE_TILE_HEADER_HEIGHT,
  ARTICLE_BORDER_Y,
} = TREEMAP;

type Props = {
  node: TreeNode;
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
  tint: string | null;
};

export function TreemapNode({ node, x, y, w, h, depth, tint }: Props) {
  const style = {
    position: "absolute" as const,
    left: x,
    top: y,
    width: w,
    height: h,
  };

  if (node.kind === "file") {
    return <FileTile node={node} style={style} h={h} />;
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

function FileTile({
  node,
  style,
  h,
}: {
  node: Extract<TreeNode, { kind: "file" }>;
  style: React.CSSProperties;
  h: number;
}) {
  const {
    hoveredPath,
    pinnedPath,
    activePath,
    inputs,
    outputs,
    setHover,
    setPinned,
    panelHoveredRef,
  } = useHover();
  const registerTile = useRegisterTile(node.path);

  // While a tile is pinned, hover does not change selection — pin freezes
  // the highlight on its target.
  const isPinned = pinnedPath === node.path;
  const isHovered = pinnedPath === null && hoveredPath === node.path;
  const isInput = inputs.has(node.path);
  const isOutput = outputs.has(node.path);
  const isUnrelated =
    activePath !== null && !isPinned && !isHovered && !isInput && !isOutput;

  const stateClass = isPinned
    ? "tile-pinned"
    : isHovered
      ? "tile-hovered"
      : isInput
        ? "tile-input"
        : isOutput
          ? "tile-output"
          : isUnrelated
            ? "tile-dim"
            : "";

  // h is the full article box (border-box), so the borders count against
  // the content area. Without subtracting them the math over-promises by
  // up to one line, which leaves a 2px sliver of the next line peeking
  // through overflow:hidden under the ellipsis.
  const availableH =
    h - FILE_TILE_HEADER_HEIGHT - DESCRIPTION_PADDING_Y - ARTICLE_BORDER_Y;
  const lines = Math.floor(availableH / DESCRIPTION_LINE_HEIGHT);
  const showDescription = lines >= 1 && Boolean(node.description);

  return (
    // ref => TileRegistry; data-path is kept as a redundant escape hatch
    // for DevTools inspection and as a fallback if the registry breaks.
    <article
      ref={registerTile}
      data-path={node.path}
      style={style}
      onClick={(e) => {
        // Toggle pin on the same tile; otherwise re-pin to this tile. No
        // stopPropagation: the document-level click handler in PinController
        // uses closest('[data-path]') to know we already handled it, and
        // stopPropagation wouldn't stop window-level listeners anyway.
        setPinned(isPinned ? null : node.path, {
          x: e.clientX,
          y: e.clientY,
        });
      }}
      onMouseEnter={(e) => setHover(node.path, { x: e.clientX, y: e.clientY })}
      onMouseMove={(e) => setHover(node.path, { x: e.clientX, y: e.clientY })}
      onMouseLeave={(e) => {
        // While pinned, hover does not change selection — pin owns the
        // highlight. Skip the cross-element survival dance entirely.
        if (pinnedPath !== null) {
          setHover(null);
          return;
        }
        // Cross-element hover survival: if the cursor is heading onto the
        // floating panel, keep the hover. relatedTarget can be null on
        // rapid mouseouts (panelHoveredRef is the fallback) and can also
        // be a Document/Window in some browsers — neither has .closest().
        const rt = e.relatedTarget;
        const goingToPanel =
          rt instanceof Element && rt.closest("[data-hover-panel]");
        if (goingToPanel) return;
        if (panelHoveredRef.current) return;
        setHover(null);
      }}
      className={`relative overflow-hidden border border-zinc-300 bg-white/40 transition-[opacity,background-color,border-color] duration-150 ${stateClass}`}
    >
      <header
        // Pin the header to exactly FILE_TILE_HEADER_HEIGHT so the line-clamp
        // math `(h - HEADER - PADDING_Y) / LINE_HEIGHT` is precise. Without
        // this, the rendered height drifts with font / inherited line-height
        // and the description's last line (including its ellipsis) is clipped
        // by overflow-hidden on the article.
        style={{ height: FILE_TILE_HEADER_HEIGHT }}
        className="flex shrink-0 items-center border-b border-zinc-300 bg-white/30 px-2 text-[11px] text-zinc-600"
      >
        <span className="min-w-0 truncate">{node.name}</span>
      </header>
      {showDescription && (
        <p
          className="px-2 py-1.5 text-[11px] leading-[14px] text-zinc-700"
          style={{
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: lines,
            overflow: "hidden",
          }}
        >
          {node.description}
        </p>
      )}
    </article>
  );
}
