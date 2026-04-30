/**
 * Reads every file in the project and figures out, for each one:
 * its name, how big it is, what it tells you about itself in its
 * comment header, and (for TypeScript files only) which other files
 * it pulls from or is pulled by. The visualizer turns this list into
 * the map you see on the screen.
 */
import "server-only";
import { readFile } from "node:fs/promises";
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

// Anything generated, vendored, ephemeral, or so large it would dwarf real
// source on the treemap. Lockfile is tracked in git but excluded here on
// purpose — at thousands of lines it would dominate the layout.
const IGNORE = [
  "**/node_modules/**",
  "**/.next/**",
  "**/.git/**",
  "**/dist/**",
  "**/out/**",
  "**/build/**",
  "**/.constellation/**",
  "**/.claude/worktrees/**",
  "**/.claude/settings.local.json",
  "**/next-env.d.ts",
  "**/*.tsbuildinfo",
  "**/.DS_Store",
  "**/package-lock.json",
  "**/*.{png,jpg,jpeg,gif,ico,svg,webp,bmp,woff,woff2,ttf,eot,otf,pdf,zip,gz,tar,exe,dmg}",
];

const TS_EXTS = new Set([".ts", ".tsx"]);

export async function scanProject(
  root: string = process.cwd(),
): Promise<CodebaseTree> {
  const allFiles = await fg("**/*", {
    cwd: root,
    ignore: IGNORE,
    absolute: true,
    onlyFiles: true,
    dot: true,
  });

  const tsFiles: string[] = [];
  const otherFiles: string[] = [];
  for (const f of allFiles) {
    if (TS_EXTS.has(path.extname(f).toLowerCase())) tsFiles.push(f);
    else otherFiles.push(f);
  }

  // Load tsconfig so the resolver knows about path aliases (e.g. `@/*`),
  // but skip auto-adding files — we control the file set ourselves via fast-glob.
  const project = new Project({
    tsConfigFilePath: path.join(root, "tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });
  project.addSourceFilesAtPaths(tsFiles);

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

    const relPath = path.relative(root, sf.getFilePath());
    const lines = Math.max(1, sf.getEndLineNumber());
    const name = path.basename(relPath);
    const description = extractDescription(name, sf.getFullText());

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

  // Non-TS files: filename + line count + best-effort description.
  // No symbols, no import graph — those concepts don't apply.
  const otherNodes = await Promise.all(
    otherFiles.map(async (absPath): Promise<FileNode> => {
      const text = await readFile(absPath, "utf8");
      const relPath = path.relative(root, absPath);
      const name = path.basename(relPath);
      return {
        kind: "file",
        path: relPath,
        name,
        lines: Math.max(1, text.split("\n").length),
        symbols: [],
        description: extractDescription(name, text),
        imports: [],
        importedBy: [],
      };
    }),
  );
  for (const node of otherNodes) {
    fileNodes.push(node);
    nodeByPath.set(node.path, node);
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

const JSDOC_LIKE_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css", ".scss",
]);

// Pulls a short description from a file's leading comment block. JS/TS/CSS
// use a /** … */ JSDoc; shell scripts use leading # lines after the shebang;
// markdown grabs the first paragraph below any heading. For everything else
// (JSON, lockfiles, .gitignore, etc.) we leave description undefined and
// let the tile show just its filename — a wrong guess is worse than none.
function extractDescription(filename: string, source: string): string | undefined {
  const ext = path.extname(filename).toLowerCase();
  if (JSDOC_LIKE_EXTS.has(ext)) return extractJsDoc(source);
  if (ext === ".sh") return extractShellHeader(source);
  if (ext === ".md") return extractMarkdownIntro(source);
  return undefined;
}

function extractJsDoc(source: string): string | undefined {
  const match = source.match(/^\s*\/\*\*([\s\S]*?)\*\//);
  if (!match) return undefined;
  const body = match[1]
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, "").trim())
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  // Drop anything from the first JSDoc tag onward (e.g. @param, @returns).
  return clamp(body.split(/\s@\w/)[0].trim());
}

function extractShellHeader(source: string): string | undefined {
  const lines = source.split("\n");
  let i = 0;
  if (lines[i]?.startsWith("#!")) i++;
  while (i < lines.length && lines[i].trim() === "") i++;
  const out: string[] = [];
  while (i < lines.length) {
    const line = lines[i].trimStart();
    if (!line.startsWith("#")) break;
    const stripped = line.replace(/^#+\s?/, "").trim();
    if (stripped === "") break;
    out.push(stripped);
    i++;
  }
  if (out.length === 0) return undefined;
  return clamp(out.join(" ").replace(/\s+/g, " ").trim());
}

function extractMarkdownIntro(source: string): string | undefined {
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "" || line.startsWith("#")) continue;
    const para: string[] = [line];
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j].trim();
      if (next === "" || next.startsWith("#")) break;
      para.push(next);
    }
    return clamp(para.join(" ").replace(/\s+/g, " ").trim());
  }
  return undefined;
}

function clamp(s: string): string | undefined {
  if (!s) return undefined;
  return s.length > 240 ? s.slice(0, 237).trimEnd() + "…" : s;
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
