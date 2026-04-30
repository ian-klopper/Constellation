/**
 * Walks the project from the repo root and builds the directory/file tree the
 * visualizer renders. Uses ts-morph to count lines, list exported symbols,
 * parse the leading JSDoc header as a description, and resolve which other
 * project files each file imports (and is imported by).
 */
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

  // Load tsconfig so the resolver knows about path aliases (e.g. `@/*`),
  // but skip auto-adding files — we control the file set ourselves via fast-glob.
  const project = new Project({
    tsConfigFilePath: path.join(root, "tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });
  project.addSourceFilesAtPaths(files);

  // absPath → relPath, used to resolve internal imports to project-relative paths.
  const relByAbs = new Map<string, string>();
  for (const sf of project.getSourceFiles()) {
    relByAbs.set(sf.getFilePath(), path.relative(root, sf.getFilePath()));
  }

  const fileNodes: FileNode[] = [];
  const nodeByPath = new Map<string, FileNode>();

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
    const description = extractDescription(sf.getFullText());

    const imports: string[] = [];
    const seenImports = new Set<string>();
    for (const decl of sf.getImportDeclarations()) {
      const target = decl.getModuleSpecifierSourceFile();
      if (!target) continue; // external package or unresolved
      const targetRel = relByAbs.get(target.getFilePath());
      if (!targetRel || targetRel === relPath) continue;
      if (seenImports.has(targetRel)) continue;
      seenImports.add(targetRel);
      imports.push(targetRel);
    }

    const node: FileNode = {
      kind: "file",
      path: relPath,
      name,
      lines,
      symbols,
      description,
      imports,
      importedBy: [],
    };
    fileNodes.push(node);
    nodeByPath.set(relPath, node);
  }

  // Reverse the import graph to populate importedBy.
  for (const node of fileNodes) {
    for (const target of node.imports) {
      const targetNode = nodeByPath.get(target);
      if (targetNode) targetNode.importedBy.push(node.path);
    }
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

// Pulls the leading /** ... */ block comment from a source file and turns it
// into a single-paragraph description. Returns undefined if the file doesn't
// open with a JSDoc-style header.
function extractDescription(source: string): string | undefined {
  const match = source.match(/^\s*\/\*\*([\s\S]*?)\*\//);
  if (!match) return undefined;
  const body = match[1]
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, "").trim())
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  // Drop anything from the first JSDoc tag onward (e.g. @param, @returns).
  const beforeTag = body.split(/\s@\w/)[0].trim();
  if (!beforeTag) return undefined;
  return beforeTag.length > 240 ? beforeTag.slice(0, 237).trimEnd() + "…" : beforeTag;
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
