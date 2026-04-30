import "server-only";
import path from "node:path";
import fg from "fast-glob";
import { Project } from "ts-morph";
import { classify, nameFromDeclaration } from "./classify";
import type {
  CodebaseTree,
  DirectoryNode,
  FileNode,
  SymbolNode,
} from "./types";

const IGNORE = [
  "node_modules/**",
  ".next/**",
  ".git/**",
  "dist/**",
  "out/**",
  "build/**",
  "next-env.d.ts",
];

export async function scanProject(
  root: string = process.cwd(),
): Promise<CodebaseTree> {
  const files = await fg("**/*.{ts,tsx}", {
    cwd: root,
    ignore: IGNORE,
    absolute: true,
    dot: false,
  });

  const project = new Project({ skipAddingFilesFromTsConfig: true });
  project.addSourceFilesAtPaths(files);

  const fileNodes: FileNode[] = [];

  for (const sf of project.getSourceFiles()) {
    const symbols: SymbolNode[] = [];

    for (const [exportName, decls] of sf.getExportedDeclarations()) {
      const decl = decls.find((d) => d.getSourceFile() === sf);
      if (!decl) continue;

      const displayName =
        exportName === "default"
          ? (nameFromDeclaration(decl) ??
            path.basename(sf.getFilePath()).replace(/\.tsx?$/, ""))
          : exportName;

      symbols.push({
        name: displayName,
        kind: classify(displayName, decl, sf),
      });
    }

    if (symbols.length === 0) continue;

    const relPath = path.relative(root, sf.getFilePath());
    const lines = Math.max(1, sf.getEndLineNumber());
    const name = path.basename(relPath);

    fileNodes.push({ kind: "file", path: relPath, name, lines, symbols });
  }

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
  finalize(rootNode);

  return { root, tree: rootNode };
}

function sizeOf(node: { kind: "file"; lines: number } | { kind: "directory"; totalLines: number }): number {
  return node.kind === "file" ? node.lines : node.totalLines;
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
