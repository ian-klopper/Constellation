/**
 * Reads every file in the project and figures out, for each one:
 * its name, how big it is, what it tells you about itself in its
 * comment header, and (for TypeScript files only) which other files
 * it pulls from or is pulled by. The visualizer turns this list into
 * the map you see on the screen.
 */
import "server-only";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Project } from "ts-morph";
import type { CodebaseTree } from "./types";
import { resolveTargetRoot } from "./config";
import { discoverFiles } from "./scan/discover";
import { extractSymbols } from "./scan/symbols";
import { buildImportGraph } from "./scan/imports";
import { extractDescriptions } from "./scan/descriptions";
import { assembleTree, countTree } from "./scan/tree";

export { countTree };

export async function scanProject(
  root: string = resolveTargetRoot(),
): Promise<CodebaseTree> {
  const { tsAbsPaths, otherAbsPaths } = await discoverFiles(root);

  // Load tsconfig so the resolver knows about path aliases (e.g. `@/*`),
  // but skip auto-adding files — we control the file set ourselves. A
  // foreign target without a tsconfig.json (Python repo, plain shell, etc.)
  // gets ts-morph defaults; the import graph just won't follow path aliases
  // it doesn't know about.
  const tsConfigPath = path.join(root, "tsconfig.json");
  const project = new Project({
    tsConfigFilePath: existsSync(tsConfigPath) ? tsConfigPath : undefined,
    skipAddingFilesFromTsConfig: true,
  });
  project.addSourceFilesAtPaths(tsAbsPaths);

  const symbolsByPath = extractSymbols(project, root);
  const graph = buildImportGraph(project, root);

  // Compose source text + line counts for every file. TS files come from
  // ts-morph (already loaded); non-TS we read off disk in parallel.
  const sources = new Map<string, string>();
  const linesByPath = new Map<string, number>();

  for (const sf of project.getSourceFiles()) {
    const relPath = path.relative(root, sf.getFilePath());
    sources.set(relPath, sf.getFullText());
    linesByPath.set(relPath, Math.max(1, sf.getEndLineNumber()));
  }

  const otherEntries = await Promise.all(
    otherAbsPaths.map(async (abs): Promise<[string, string]> => {
      const text = await readFile(abs, "utf8");
      return [path.relative(root, abs), text];
    }),
  );
  for (const [relPath, text] of otherEntries) {
    sources.set(relPath, text);
    linesByPath.set(relPath, Math.max(1, text.split("\n").length));
  }

  const descriptionsByPath = extractDescriptions(sources);

  const tree = assembleTree({
    relPaths: Array.from(sources.keys()),
    symbolsByPath,
    graph,
    linesByPath,
    descriptionsByPath,
  });

  return { root, tree };
}
