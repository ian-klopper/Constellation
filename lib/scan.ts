import "server-only";
import path from "node:path";
import fg from "fast-glob";
import { Project } from "ts-morph";
import { classify, nameFromDeclaration } from "./classify";
import type {
  CodebaseTree,
  DirectoryGroup,
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
    if (!relPath.includes(path.sep)) continue;

    fileNodes.push({ path: relPath, symbols });
  }

  const groupMap = new Map<string, FileNode[]>();
  for (const file of fileNodes) {
    const top = file.path.split(path.sep)[0];
    if (!groupMap.has(top)) groupMap.set(top, []);
    groupMap.get(top)!.push(file);
  }

  const groups: DirectoryGroup[] = Array.from(groupMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, files]) => ({
      name,
      files: files.sort((a, b) => a.path.localeCompare(b.path)),
    }));

  return { root, groups };
}
