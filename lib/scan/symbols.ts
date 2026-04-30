/**
 * For each TypeScript source file in the ts-morph project, extract its
 * top-level exported declarations and classify each one as a component,
 * hook, type, etc. The result is what populates the "Exports" list when
 * a file is hovered.
 */
import "server-only";
import path from "node:path";
import type { Project } from "ts-morph";
import { classify, nameFromDeclaration } from "../classify";
import type { SymbolNode } from "../types";

export function extractSymbols(
  project: Project,
  root: string,
): Map<string, SymbolNode[]> {
  const result = new Map<string, SymbolNode[]>();

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
    result.set(relPath, symbols);
  }

  return result;
}
