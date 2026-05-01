/**
 * Reads every file in the project and figures out, for each one:
 * its name, how big it is, what it tells you about itself in its
 * comment header, and (for TypeScript files only) which other files
 * it pulls from or is pulled by. The visualizer turns this list into
 * the map you see on the screen.
 *
 * Files larger than `MAX_FILE_BYTES` are kept on the map but their
 * contents are never read; oversize directories collapse to a single
 * `__collapsed__` placeholder tile so a 14 GB build cache can't OOM us.
 */
import "server-only";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Project } from "ts-morph";
import type { CodebaseTree } from "./types";
import { resolveTargetRoot } from "./config";
import { SCAN_LIMITS } from "./constants";
import { discoverFiles } from "./scan/discover";
import { extractSymbols } from "./scan/symbols";
import { buildImportGraph } from "./scan/imports";
import { extractDescriptions } from "./scan/descriptions";
import { loadDescriptionSidecar } from "./scan/description-sidecar";
import { assembleTree, countTree } from "./scan/tree";

export { countTree };

const COLLAPSED_PLACEHOLDER = "__collapsed__";

export async function scanProject(
  root: string = resolveTargetRoot(),
): Promise<CodebaseTree> {
  const { tsFiles, otherFiles, collapsedDirs } = await discoverFiles(root);

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

  // Only feed parseable TS files to ts-morph. Oversize TS files still
  // become tiles below, but with no symbols and no edges in the graph.
  const parseableTs = tsFiles.filter((f) => !f.oversize);
  project.addSourceFilesAtPaths(parseableTs.map((f) => f.absPath));

  const symbolsByPath = extractSymbols(project, root);
  const graph = buildImportGraph(project, root);

  const sources = new Map<string, string>();
  const linesByPath = new Map<string, number>();
  const descriptionsByPath = new Map<string, string>();

  for (const sf of project.getSourceFiles()) {
    const relPath = path.relative(root, sf.getFilePath());
    sources.set(relPath, sf.getFullText());
    linesByPath.set(relPath, Math.max(1, sf.getEndLineNumber()));
  }

  // Oversize TS files: include in the tree, but no source / no symbols /
  // no description. Use a size-derived line estimate, capped.
  for (const f of tsFiles) {
    if (!f.oversize) continue;
    const relPath = path.relative(root, f.absPath);
    linesByPath.set(relPath, oversizeLineCount(f.size));
  }

  // Other files: read in parallel when small enough; oversize files get
  // a synthetic line count and no source (extractor returns undefined).
  const otherEntries = await Promise.all(
    otherFiles.map(async (f): Promise<[string, string | null, number]> => {
      const relPath = path.relative(root, f.absPath);
      if (f.oversize) {
        return [relPath, null, oversizeLineCount(f.size)];
      }
      const text = await readFile(f.absPath, "utf8");
      return [relPath, text, Math.max(1, text.split("\n").length)];
    }),
  );
  for (const [relPath, text, lines] of otherEntries) {
    if (text !== null) sources.set(relPath, text);
    linesByPath.set(relPath, lines);
  }

  // Collapsed dirs: one placeholder tile each. Sized at the cap so a
  // 14 GB blob doesn't dominate the layout — the description carries the
  // real number.
  for (const dir of collapsedDirs) {
    const relPath = path.posix.join(dir.relPath, COLLAPSED_PLACEHOLDER);
    linesByPath.set(relPath, SCAN_LIMITS.OVERSIZE_DISPLAY_LINES);
    descriptionsByPath.set(
      relPath,
      `Directory too large to scan (${dir.fileCount.toLocaleString()} files, ${humanBytes(dir.totalBytes)}) — contents skipped to keep the visualizer responsive.`,
    );
  }

  // Pull descriptions from the source we actually read; merge with the
  // canned placeholder descriptions written above.
  for (const [relPath, desc] of extractDescriptions(sources)) {
    descriptionsByPath.set(relPath, desc);
  }

  // Sidecar overrides win — the user typed those by hand, in-file
  // descriptions are a default. ENOENT (no sidecar) is the common case.
  for (const [relPath, desc] of await loadDescriptionSidecar(root)) {
    descriptionsByPath.set(relPath, desc);
  }

  const tree = assembleTree({
    relPaths: [...linesByPath.keys()],
    symbolsByPath,
    graph,
    linesByPath,
    descriptionsByPath,
  });

  return { root, tree };
}

function oversizeLineCount(bytes: number): number {
  return Math.min(
    SCAN_LIMITS.OVERSIZE_DISPLAY_LINES,
    Math.max(1, Math.ceil(bytes / 80)),
  );
}

function humanBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}
