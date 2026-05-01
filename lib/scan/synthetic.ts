/**
 * Builds a synthetic CodebaseTree for the zoom-perf dev bench. Pure data —
 * no filesystem, no parsing — so a 5,000-tile tree is constructed in
 * milliseconds and is byte-identical across runs (deterministic LCG seed).
 *
 * Shape goals:
 * - File count is roughly the requested target (default 5000).
 * - Line counts follow a heavy tail (most files small, a few large) so the
 *   squarified treemap has the same long-tail shape we see on real repos.
 * - Directory nesting goes 4-5 levels deep with branching factor 1-5, so
 *   recursion depth and DOM-node counts mirror real projects.
 *
 * Used only by app/dev/zoom-perf/. Marked server-only so it can never
 * accidentally bundle into the client — the perf bench page calls it from
 * the server component and ships the resulting POJOs to the client.
 */
import "server-only";
import type { CodebaseTree, DirectoryNode, FileNode, TreeNode } from "../types";

const TOP_LEVEL_DIRS = [
  "app",
  "components",
  "lib",
  "hooks",
  "tests",
  "docs",
  "scripts",
  "vendor",
];

export function buildSyntheticTree(
  targetFiles = 5000,
  seed = 1,
): CodebaseTree {
  // Linear congruential generator (Numerical Recipes). Deterministic across
  // runs given the same seed — perf measurements stay reproducible.
  let rngState = seed >>> 0;
  function rand(): number {
    rngState = (Math.imul(rngState, 1664525) + 1013904223) >>> 0;
    return rngState / 0x100000000;
  }
  function randInt(lo: number, hi: number): number {
    return lo + Math.floor(rand() * (hi - lo + 1));
  }
  function syntheticLineCount(): number {
    // Heavy-tail distribution: u^4 pushes most weight near 0 and stretches
    // the tail. Ranges roughly: median ~25 lines, p90 ~250, p99 ~1500.
    const u = rand();
    return Math.max(5, Math.floor(Math.exp(2.5 + u ** 4 * 6.5)));
  }

  let fileCount = 0;
  let fileIdx = 0;

  function makeFile(parentPath: string): FileNode {
    fileCount++;
    const idx = fileIdx++;
    const name = `synthetic-${idx}.ts`;
    const filePath = parentPath ? `${parentPath}/${name}` : name;
    return {
      kind: "file",
      path: filePath,
      name,
      lines: syntheticLineCount(),
      symbols: [],
      // Sprinkle descriptions on ~1 in 7 files so the line-clamp render
      // path is exercised at scale, not just the bare-tile path.
      description:
        idx % 7 === 0 ? `Synthetic file ${idx} for the perf bench.` : undefined,
      imports: [],
      importedBy: [],
    };
  }

  function makeDir(
    parentPath: string,
    name: string,
    depth: number,
    budget: number,
  ): DirectoryNode {
    const dirPath = parentPath ? `${parentPath}/${name}` : name;
    const children: TreeNode[] = [];

    const filesHere =
      depth >= 4 || budget < 30
        ? Math.min(budget, randInt(5, 30))
        : randInt(2, 12);

    for (let i = 0; i < filesHere && fileCount < targetFiles; i++) {
      children.push(makeFile(dirPath));
    }

    if (depth < 4 && fileCount < targetFiles) {
      const subdirCount = randInt(1, 5);
      const remainingHere = targetFiles - fileCount;
      const perSub = Math.max(1, Math.ceil(remainingHere / subdirCount));
      for (let i = 0; i < subdirCount && fileCount < targetFiles; i++) {
        const subName = `sub-${depth}-${i}`;
        children.push(makeDir(dirPath, subName, depth + 1, perSub));
      }
    }

    children.sort((a, b) => sizeOf(b) - sizeOf(a));
    const totalLines = children.reduce(
      (s, c) => s + (c.kind === "file" ? c.lines : c.totalLines),
      0,
    );
    return { kind: "directory", path: dirPath, name, children, totalLines };
  }

  const rootChildren: TreeNode[] = [];
  const perTopDir = Math.ceil(targetFiles / TOP_LEVEL_DIRS.length);
  for (const name of TOP_LEVEL_DIRS) {
    if (fileCount >= targetFiles) break;
    rootChildren.push(makeDir("", name, 1, perTopDir));
  }

  rootChildren.sort((a, b) => sizeOf(b) - sizeOf(a));
  const totalLines = rootChildren.reduce(
    (s, c) => s + (c.kind === "file" ? c.lines : c.totalLines),
    0,
  );

  const tree: DirectoryNode = {
    kind: "directory",
    path: "",
    name: "",
    children: rootChildren,
    totalLines,
  };

  return { root: "/synthetic", tree };
}

function sizeOf(node: TreeNode): number {
  return node.kind === "file" ? node.lines : node.totalLines;
}
