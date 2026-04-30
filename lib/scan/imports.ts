/**
 * Walks every TypeScript source file's import declarations and builds a
 * project-internal import graph (only edges between files inside the
 * project — npm packages and unresolved specifiers are dropped). Returns
 * both directions of the graph: who-imports-whom and who-is-imported-by-whom.
 */
import "server-only";
import path from "node:path";
import type { Project } from "ts-morph";

export type ImportGraph = {
  imports: Map<string, string[]>;
  importedBy: Map<string, string[]>;
};

export function buildImportGraph(project: Project, root: string): ImportGraph {
  // absPath → relPath, used to resolve internal imports to project-relative paths.
  const relByAbs = new Map<string, string>();
  for (const sf of project.getSourceFiles()) {
    relByAbs.set(sf.getFilePath(), path.relative(root, sf.getFilePath()));
  }

  const imports = new Map<string, string[]>();
  const importedBy = new Map<string, string[]>();

  for (const sf of project.getSourceFiles()) {
    const relPath = path.relative(root, sf.getFilePath());
    const out: string[] = [];
    const seen = new Set<string>();

    for (const decl of sf.getImportDeclarations()) {
      const target = decl.getModuleSpecifierSourceFile();
      if (!target) continue; // external package or unresolved
      const targetRel = relByAbs.get(target.getFilePath());
      if (!targetRel || targetRel === relPath) continue;
      if (seen.has(targetRel)) continue;
      seen.add(targetRel);
      out.push(targetRel);
    }

    imports.set(relPath, out);
  }

  // Reverse the graph.
  for (const [source, targets] of imports) {
    for (const target of targets) {
      let bucket = importedBy.get(target);
      if (!bucket) {
        bucket = [];
        importedBy.set(target, bucket);
      }
      bucket.push(source);
    }
  }

  return { imports, importedBy };
}
