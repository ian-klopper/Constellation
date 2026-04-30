/**
 * The interactive shell around the map. Watches its own size so the layout
 * fills the page, remembers which file your cursor is on and where the
 * cursor is, figures out which other files that file is connected to, and
 * shows the floating info card next to your cursor.
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TreemapNode } from "./TreemapNode";
import { HoverPanel } from "./HoverPanel";
import { HoverContext, type HoverContextValue } from "./HoverContext";
import { TileRegistryProvider } from "./TileRegistry";
import { AgentOverlay } from "./AgentOverlay";
import type { CodebaseTree, FileNode, TreeNode } from "@/lib/types";

export function Visualizer({ tree }: { tree: CodebaseTree }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(
    null,
  );

  const setHover = useCallback(
    (path: string | null, pos?: { x: number; y: number }) => {
      setHoveredPath(path);
      if (pos) setMousePos(pos);
    },
    [],
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize({ w: width, h: height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const filesByPath = useMemo(() => {
    const map = new Map<string, FileNode>();
    walk(tree.tree, map);
    return map;
  }, [tree]);

  const { inputs, outputs, hoveredFile } = useMemo(() => {
    if (!hoveredPath) {
      return {
        inputs: EMPTY_SET,
        outputs: EMPTY_SET,
        hoveredFile: null as FileNode | null,
      };
    }
    const f = filesByPath.get(hoveredPath) ?? null;
    return {
      inputs: new Set(f?.imports ?? []),
      outputs: new Set(f?.importedBy ?? []),
      hoveredFile: f,
    };
  }, [hoveredPath, filesByPath]);

  const hoverValue = useMemo<HoverContextValue>(
    () => ({ hoveredPath, inputs, outputs, setHover }),
    [hoveredPath, inputs, outputs, setHover],
  );

  return (
    <HoverContext.Provider value={hoverValue}>
      <TileRegistryProvider>
        <div ref={ref} className="relative h-full w-full">
          {size && size.w > 0 && size.h > 0 && (
            <TreemapNode
              node={tree.tree}
              x={0}
              y={0}
              w={size.w}
              h={size.h}
              depth={0}
              tint={null}
            />
          )}
          <HoverPanel file={hoveredFile} mousePos={mousePos} />
        </div>
        <AgentOverlay />
      </TileRegistryProvider>
    </HoverContext.Provider>
  );
}

const EMPTY_SET: Set<string> = new Set();

function walk(node: TreeNode, out: Map<string, FileNode>) {
  if (node.kind === "file") {
    out.set(node.path, node);
    return;
  }
  for (const child of node.children) walk(child, out);
}
