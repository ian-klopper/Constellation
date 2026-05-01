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
import {
  HoverContext,
  type HoverContextValue,
  type Pos,
} from "./HoverContext";
import { TileRegistryProvider } from "./TileRegistry";
import { AgentOverlay } from "./AgentOverlay";
import { PinController } from "./PinController";
import type { CodebaseTree, FileNode, TreeNode } from "@/lib/types";

export function Visualizer({ tree }: { tree: CodebaseTree }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState<Pos | null>(null);
  const [pinnedPath, setPinnedPath] = useState<string | null>(null);
  const [pinnedPos, setPinnedPos] = useState<Pos | null>(null);
  // True while the cursor is over the floating HoverPanel. Tiles read this
  // in their onMouseLeave to keep the panel up when hover crosses tile→panel.
  // Ref instead of state: toggling .current must not re-render every tile.
  const panelHoveredRef = useRef(false);

  const setHover = useCallback((path: string | null, pos?: Pos) => {
    setHoveredPath(path);
    if (pos) setMousePos(pos);
  }, []);

  const setPinned = useCallback((path: string | null, pos?: Pos) => {
    setPinnedPath(path);
    setPinnedPos(path && pos ? pos : null);
  }, []);

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

  // Pin wins over hover so the import-graph highlight freezes on the
  // pinned file even as the cursor wanders.
  const activePath = pinnedPath ?? hoveredPath;

  const { inputs, outputs, activeFile } = useMemo(() => {
    if (!activePath) {
      return {
        inputs: EMPTY_SET,
        outputs: EMPTY_SET,
        activeFile: null as FileNode | null,
      };
    }
    const f = filesByPath.get(activePath) ?? null;
    return {
      inputs: new Set(f?.imports ?? []),
      outputs: new Set(f?.importedBy ?? []),
      activeFile: f,
    };
  }, [activePath, filesByPath]);

  // Auto-clear: if the pinned file disappears (HMR re-scan, file deletion),
  // drop the pin so we don't leave a dangling reference.
  useEffect(() => {
    if (pinnedPath && !filesByPath.has(pinnedPath)) {
      setPinned(null);
    }
  }, [pinnedPath, filesByPath, setPinned]);

  const hoverValue = useMemo<HoverContextValue>(
    () => ({
      hoveredPath,
      pinnedPath,
      pinnedPos,
      inputs,
      outputs,
      setHover,
      setPinned,
      panelHoveredRef,
    }),
    [
      hoveredPath,
      pinnedPath,
      pinnedPos,
      inputs,
      outputs,
      setHover,
      setPinned,
    ],
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
          <HoverPanel
            file={activeFile}
            mousePos={mousePos}
            pinned={pinnedPath !== null}
            pinnedPos={pinnedPos}
            onClose={() => setPinned(null)}
          />
        </div>
        <AgentOverlay />
        <PinController />
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
