/**
 * Combines the per-file outputs of the other phases (symbols, imports,
 * descriptions, line counts) into FileNodes, then builds the recursive
 * DirectoryNode tree the visualizer renders. Children are sorted by size
 * descending so the squarified treemap lays them out predictably.
 */
import "server-only";
import type {
  DirectoryNode,
  FileNode,
  SymbolNode,
} from "../types";
import type { ImportGraph } from "./imports";

export type AssembleInput = {
  relPaths: string[];
  symbolsByPath: Map<string, SymbolNode[]>;
  graph: ImportGraph;
  linesByPath: Map<string, number>;
  descriptionsByPath: Map<string, string>;
};

export function assembleTree(input: AssembleInput): DirectoryNode {
  const { relPaths, symbolsByPath, graph, linesByPath, descriptionsByPath } =
    input;

  const fileNodes: FileNode[] = relPaths.map((relPath) => ({
    kind: "file",
    path: relPath,
    name: basename(relPath),
    lines: linesByPath.get(relPath) ?? 1,
    symbols: symbolsByPath.get(relPath) ?? [],
    description: descriptionsByPath.get(relPath),
    imports: graph.imports.get(relPath) ?? [],
    importedBy: graph.importedBy.get(relPath) ?? [],
  }));

  const rootNode: DirectoryNode = {
    kind: "directory",
    path: "",
    name: "",
    children: [],
    totalLines: 0,
  };
  const dirByPath = new Map<string, DirectoryNode>();
  dirByPath.set("", rootNode);

  for (const file of fileNodes) {
    const segments = file.path.split(/[\\/]/);
    let parent = rootNode;
    for (let i = 0; i < segments.length - 1; i++) {
      const dirPath = segments.slice(0, i + 1).join("/");
      let dir = dirByPath.get(dirPath);
      if (!dir) {
        dir = {
          kind: "directory",
          path: dirPath,
          name: segments[i],
          children: [],
          totalLines: 0,
        };
        dirByPath.set(dirPath, dir);
        parent.children.push(dir);
      }
      parent = dir;
    }
    parent.children.push(file);
  }

  finalize(rootNode);
  return rootNode;
}

// Post-order: sum totalLines and sort children by size descending.
function finalize(node: DirectoryNode): number {
  let total = 0;
  for (const child of node.children) {
    total += child.kind === "file" ? child.lines : finalize(child);
  }
  node.totalLines = total;
  node.children.sort((a, b) => sizeOf(b) - sizeOf(a));
  return total;
}

function sizeOf(
  node:
    | { kind: "file"; lines: number }
    | { kind: "directory"; totalLines: number },
): number {
  return node.kind === "file" ? node.lines : node.totalLines;
}

function basename(relPath: string): string {
  const idx = relPath.lastIndexOf("/");
  return idx >= 0 ? relPath.slice(idx + 1) : relPath;
}

export function countTree(node: DirectoryNode): {
  dirs: number;
  files: number;
  lines: number;
} {
  let dirs = 0;
  let files = 0;
  let lines = 0;
  function walk(n: DirectoryNode) {
    for (const child of n.children) {
      if (child.kind === "file") {
        files++;
        lines += child.lines;
      } else {
        dirs++;
        walk(child);
      }
    }
  }
  walk(node);
  return { dirs, files, lines };
}
