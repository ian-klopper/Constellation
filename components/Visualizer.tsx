/**
 * The interactive shell around the map. Owns three things:
 *   1. Hover/pin state (which file is the cursor on, which one is pinned).
 *   2. Container size (ResizeObserver) so the squarified layout fills the
 *      page without React state churn during continuous gestures.
 *   3. The zoom + pan state machine — live values in a ref, an rAF tick
 *      that mutates the wrapper's CSS transform imperatively, a quantized
 *      `committedZoom` React state that drives the LOD gate, and a
 *      subscribe channel that anchor consumers (agent overlay, pinned
 *      panel) call to re-read tile rects after each transform change.
 *
 * The split between live ref and committed state is load-bearing: at
 * Parsley-scale repos with thousands of tiles, routing live zoom through
 * React state would force O(N) reconciliation per wheel detent. The ref-
 * driven transform pattern is borrowed from d3-zoom and react-zoom-pan-
 * pinch and means React only reconciles a few times per gesture, on
 * 5%-quantum LOD crossings.
 */
"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import {
  ZoomPanContext,
  type ZoomPanContextValue,
  type ZoomPanState,
  clampPan,
} from "./ZoomPanContext";
import { ZOOM } from "@/lib/constants";
import type { CodebaseTree, FileNode, TreeNode } from "@/lib/types";

export function Visualizer({
  tree,
  root,
}: {
  tree: CodebaseTree;
  root: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  // Mirror of `size` for use inside callbacks that must not stale-close.
  // Mutating a ref during render is permitted by the rules of hooks; the
  // rAF tick reads this when re-clamping pan.
  const sizeRef = useRef<{ w: number; h: number } | null>(null);
  sizeRef.current = size;

  const [hoveredPath, setHoveredPath] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState<Pos | null>(null);
  const [pinnedPath, setPinnedPath] = useState<string | null>(null);
  const [pinnedPos, setPinnedPos] = useState<Pos | null>(null);
  const panelHoveredRef = useRef(false);

  // ===== Zoom + Pan state =====
  // Live zoom/pan — written synchronously by gesture handlers, read by the
  // rAF tick. Never React state.
  const liveRef = useRef<ZoomPanState>({ zoom: 1, pan: { x: 0, y: 0 } });
  // Coalesces multiple ref writes per frame into a single transform mutation.
  const frameScheduledRef = useRef(false);
  // Subscribers re-anchor on every transform change by calling
  // getBoundingClientRect() on their tile element — which already reflects
  // the live transform we just mutated.
  const subsRef = useRef<Set<() => void>>(new Set());
  // The LOD gate in TreemapNode reads this. Updates only on quantum crossings.
  const [committedZoom, setCommittedZoom] = useState(1);
  // Ref mirror of committedZoom so the tick can compare without stale closure.
  const committedZoomRef = useRef(1);

  // Single-writer rAF tick. Every wheel/pointer/reset write to liveRef calls
  // scheduleFrame; the tick that follows mutates the wrapper transform,
  // notifies subscribers, and (when the live zoom has drifted ≥
  // LOD_COMMIT_QUANTUM from the committed value) commits committedZoom.
  const scheduleFrame = useCallback(() => {
    if (frameScheduledRef.current) return;
    frameScheduledRef.current = true;
    requestAnimationFrame(() => {
      frameScheduledRef.current = false;
      const wrapper = wrapperRef.current;
      if (!wrapper) return;

      // Belt-and-braces re-clamp: a few write paths skip clamping (resize)
      // and rely on this tick to enforce bounds. Cheap.
      const sz = sizeRef.current;
      if (sz) {
        liveRef.current = {
          zoom: liveRef.current.zoom,
          pan: clampPan(
            liveRef.current.pan,
            liveRef.current.zoom,
            sz.w,
            sz.h,
            ZOOM.PAN_CLAMP_MARGIN,
          ),
        };
      }

      const { zoom, pan } = liveRef.current;
      wrapper.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;

      for (const cb of subsRef.current) cb();

      const committed = committedZoomRef.current;
      const drift = Math.abs(zoom - committed) / committed;
      if (drift >= ZOOM.LOD_COMMIT_QUANTUM) {
        committedZoomRef.current = zoom;
        setCommittedZoom(zoom);
      }
    });
  }, []);

  // Initial transform — write before first paint, otherwise the wrapper is
  // briefly un-styled and the first frame can render at the wrong scale.
  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    if (wrapper) wrapper.style.transform = "translate(0px, 0px) scale(1)";
  }, []);

  // Container size + resize re-clamp (R15).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize({ w: width, h: height });
      // ZOOM_MIN is always 1 in the new layout space, so zoom doesn't need
      // re-clamping here — only pan, which becomes (0,0) at zoom=1 and may
      // drift past the new bounds at higher zooms.
      liveRef.current = {
        zoom: liveRef.current.zoom,
        pan: clampPan(
          liveRef.current.pan,
          liveRef.current.zoom,
          width,
          height,
          ZOOM.PAN_CLAMP_MARGIN,
        ),
      };
      scheduleFrame();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [scheduleFrame]);

  const setHover = useCallback((path: string | null, pos?: Pos) => {
    setHoveredPath(path);
    if (pos) setMousePos(pos);
  }, []);

  const setPinned = useCallback((path: string | null, pos?: Pos) => {
    setPinnedPath(path);
    setPinnedPos(path && pos ? pos : null);
  }, []);

  const filesByPath = useMemo(() => {
    const map = new Map<string, FileNode>();
    walk(tree.tree, map);
    return map;
  }, [tree]);

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
      activePath,
      inputs,
      outputs,
      setHover,
      setPinned,
      panelHoveredRef,
    }),
    [
      hoveredPath,
      pinnedPath,
      activePath,
      inputs,
      outputs,
      setHover,
      setPinned,
    ],
  );

  // Stable callbacks so consumers (useAgentPositions, PinController) can
  // put them in useEffect deps without churning their subscriptions on
  // every committedZoom commit.
  const getLive = useCallback(() => liveRef.current, []);
  const subscribeTransformChange = useCallback((cb: () => void) => {
    subsRef.current.add(cb);
    return () => {
      subsRef.current.delete(cb);
    };
  }, []);

  const zoomPanValue = useMemo<ZoomPanContextValue>(
    () => ({
      committedZoom,
      getLive,
      subscribeTransformChange,
    }),
    [committedZoom, getLive, subscribeTransformChange],
  );

  return (
    <HoverContext.Provider value={hoverValue}>
      <TileRegistryProvider>
        <ZoomPanContext.Provider value={zoomPanValue}>
          {/*
            Container holds the transformed wrapper *and* HoverPanel as
            siblings. HoverPanel must be a sibling (not a descendant) of the
            wrapper because position: fixed resolves against the nearest
            transformed ancestor — wrapping it inside the wrapper would
            interpret left/top in scaled coords.
          */}
          <div
            ref={containerRef}
            className="relative h-full w-full overflow-hidden"
          >
            <div
              ref={wrapperRef}
              style={{
                transformOrigin: "0 0",
                width: size?.w ?? 0,
                height: size?.h ?? 0,
                position: "relative",
              }}
            >
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
            </div>
            <HoverPanel
              file={activeFile}
              mousePos={mousePos}
              pinned={pinnedPath !== null}
              pinnedPos={pinnedPos}
              onClose={() => setPinned(null)}
            />
          </div>
          <AgentOverlay root={root} />
          <PinController />
        </ZoomPanContext.Provider>
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
