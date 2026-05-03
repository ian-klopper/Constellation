/**
 * Draws one piece of the map. If it's a folder, it slices its area into
 * rectangles for the things inside and asks itself to draw each one. If
 * it's a file, it draws the filename, the description, and changes color
 * when you hover — the file you're on lights up, the files it pulls from
 * glow blue, the files that pull from it glow amber, and everything else
 * fades.
 */
"use client";

import { memo, useMemo } from "react";
import { squarify } from "@/lib/treemap";
import { TREEMAP } from "@/lib/constants";
import { useHover } from "./HoverContext";
import { useIsEditing } from "./EditingHighlightContext";
import { useLod } from "./LodContext";
import { useRegisterTile } from "./TileRegistry";
import { useZoomPan } from "./ZoomPanContext";
import type { TreeNode } from "@/lib/types";

const {
  LABEL_HEIGHT,
  INNER_PAD,
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

// Memoized so a Visualizer re-render that doesn't change layout-px props or
// committedZoom (e.g., pinnedPos updates while panning) skips re-executing
// the entire recursive tree. Context changes (HoverContext, ZoomPanContext)
// still propagate to consumers below — useHover in FileTile and useZoomPan
// here both bypass memo. This is the load-bearing perf optimization that
// lets PinController call setPinned on every transform tick without
// blowing up the render budget on Parsley-scale repos.
export const TreemapNode = memo(TreemapNodeImpl);

function TreemapNodeImpl({ node, x, y, w, h, depth, tint }: Props) {
  // committedZoom is React state — updates only on LOD_COMMIT_QUANTUM
  // crossings, so this hook does NOT cause per-detent reconciliation. Do
  // *not* swap to getLive().zoom: the whole point of the ref-driven
  // architecture is to keep continuous zoom values out of TreemapNode.
  const { committedZoom } = useZoomPan();
  // User-tunable LOD floor. Defaults to level 38 (≈ 8 px); the header
  // DetailSlider writes new values which reflow the gate live.
  const { minRender } = useLod();

  // Per-tile LOD gate. A tile (file *or* directory) below this floor is
  // skipped entirely — its area becomes empty space inside its parent.
  // The root (depth = 0) is exempt so the visualization is never empty.
  // Without this, the gate only culls a directory's *children*, leaving
  // the directory's own label tile rendering at any size — which made
  // the slider feel like it "didn't affect all the boxes".
  const tooSmall =
    depth > 0 &&
    (w * committedZoom < minRender || h * committedZoom < minRender);

  const style = {
    position: "absolute" as const,
    left: x,
    top: y,
    width: w,
    height: h,
  };

  if (node.kind === "file") {
    if (tooSmall) return null;
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

  // Children-expansion gate: even if this directory's own tile clears the
  // per-tile floor, lay out children only when the *inner* area also does.
  // Otherwise the directory shows just its label and absorbs the empty
  // space — no "+N hidden" placeholder. tooSmall folds in here too so a
  // tile we're about to skip doesn't waste work on squarify.
  //
  // Description line-clamp math (in FileTile below) intentionally stays
  // in layout-px. Zoom doesn't change the *number* of description lines;
  // full zoom-aware line-count is a deferred follow-up.
  const renderW = inner.w * committedZoom;
  const renderH = inner.h * committedZoom;
  const canRender =
    !tooSmall &&
    renderW >= minRender &&
    renderH >= minRender &&
    node.children.length > 0;

  // Memoize squarify on the actually-changing inputs: the children array's
  // *reference* (stable for a given tree, busts only when the scan re-runs)
  // plus the four primitive rect scalars. Keying on node.children rather
  // than the freshly-constructed items array dodges the "new array literal
  // every render" footgun that would defeat the memo.
  //
  // The `items` array is built *inside* the memo body for the same reason —
  // closing over the constructed array would key the memo on a fresh
  // reference each render. canRender is part of the deps so the empty-array
  // branch participates in the cache too (avoids re-running squarify on a
  // shrunken rect once it falls below MIN_RENDER and back).
  const childRects = useMemo(
    () => {
      if (!canRender) return [] as ReturnType<typeof squarify>;
      const items = node.children.map((c) => ({
        value: c.kind === "file" ? c.lines : c.totalLines,
      }));
      return squarify(items, inner);
    },
    [node.children, inner.x, inner.y, inner.w, inner.h, canRender],
  );

  // Per-tile gate fires *after* useMemo so the hook order stays stable
  // for this instance across re-renders (squarify above no-ops via the
  // canRender check, so no real work is wasted).
  if (tooSmall) return null;

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
  const isEditing = useIsEditing(node.path);

  // While a tile is pinned, hover does not change selection — pin freezes
  // the highlight on its target.
  const isPinned = pinnedPath === node.path;
  const isHovered = pinnedPath === null && hoveredPath === node.path;
  const isInput = inputs.has(node.path);
  const isOutput = outputs.has(node.path);
  const isUnrelated =
    activePath !== null && !isPinned && !isHovered && !isInput && !isOutput;

  const baseStateClass = isPinned
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
  // Edit-pulse stacks with the hover/pin state — a tile being edited can
  // still be the hovered or pinned tile, and the amber pulse should still
  // play. CSS handles the layering since outline + box-shadow don't
  // conflict with the bg-color tints used by the other states.
  const stateClass = isEditing
    ? `${baseStateClass} tile-editing`.trim()
    : baseStateClass;

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
    // for DevTools inspection and is *also* the marker Visualizer's
    // pointerup click resolver walks via closest('[data-path]') to decide
    // whether a press resolved on a tile (pin/unpin) or empty space.
    //
    // No onClick here: pin/unpin lives in Visualizer's pointerup so a
    // press-and-drag pans the canvas instead of pinning the tile under
    // the press point.
    <article
      ref={registerTile}
      data-path={node.path}
      style={style}
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
      className={`relative cursor-grab overflow-hidden border border-zinc-300 bg-white/40 transition-[opacity,background-color,border-color] duration-150 ${stateClass}`}
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
