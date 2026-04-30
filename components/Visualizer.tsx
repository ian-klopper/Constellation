"use client";

import { useEffect, useRef, useState } from "react";
import { TreemapNode } from "./TreemapNode";
import type { CodebaseTree } from "@/lib/types";

export function Visualizer({ tree }: { tree: CodebaseTree }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

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

  return (
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
    </div>
  );
}
