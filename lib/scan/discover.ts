/**
 * Walks the project root and splits every interesting file into TypeScript
 * sources (which feed ts-morph) and everything else (which still becomes
 * a tile but doesn't get symbol/import analysis). Stats every match so
 * downstream phases can skip oversize files and so we can collapse
 * absurd directory subtrees (build caches, .trigger/.turbo/etc.) into a
 * single placeholder tile instead of loading 14 GB into memory.
 */
import "server-only";
import path from "node:path";
import { stat } from "node:fs/promises";
import fg from "fast-glob";
import { SCAN_LIMITS } from "../constants";

// Anything generated, vendored, ephemeral, or so large it would dwarf real
// source on the treemap. Lockfile is tracked in git but excluded here on
// purpose — at thousands of lines it would dominate the layout.
//
// We deliberately do *not* add ecosystem-specific build caches (.trigger,
// .turbo, .cache, target, vendor, …) here — the size-aware gate below
// catches those generically so we don't have to play whack-a-mole.
export const IGNORE = [
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

export const TS_EXTS = new Set([".ts", ".tsx"]);

export type DiscoveredFile = {
  absPath: string;
  size: number;
  oversize: boolean;
};

export type CollapsedDir = {
  absPath: string;
  relPath: string;
  totalBytes: number;
  fileCount: number;
};

export type DiscoveredFiles = {
  tsFiles: DiscoveredFile[];
  otherFiles: DiscoveredFile[];
  collapsedDirs: CollapsedDir[];
};

const STAT_CONCURRENCY = 64;

export async function discoverFiles(root: string): Promise<DiscoveredFiles> {
  const absPaths = await fg("**/*", {
    cwd: root,
    ignore: IGNORE,
    absolute: true,
    onlyFiles: true,
    dot: true,
  });

  const sizes = await statAll(absPaths);

  // For each non-root ancestor dir, accumulate bytes + file count.
  const dirBytes = new Map<string, number>();
  const dirCount = new Map<string, number>();
  for (const [absPath, size] of sizes) {
    const rel = path.relative(root, absPath);
    const segments = rel.split(/[\\/]/);
    for (let i = 1; i < segments.length; i++) {
      const dir = segments.slice(0, i).join("/");
      dirBytes.set(dir, (dirBytes.get(dir) ?? 0) + size);
      dirCount.set(dir, (dirCount.get(dir) ?? 0) + 1);
    }
  }

  // Find the outermost collapsible dirs. A dir is collapsible if its
  // subtree exceeds either the byte cap or the file-count cap. We never
  // collapse the project root itself, and we never collapse a dir whose
  // ancestor is already collapsed (the ancestor's placeholder covers it).
  const collapsedSet = new Set<string>();
  const dirsByDepth = [...dirBytes.keys()].sort(
    (a, b) => a.split("/").length - b.split("/").length,
  );
  for (const dir of dirsByDepth) {
    const bytes = dirBytes.get(dir) ?? 0;
    const count = dirCount.get(dir) ?? 0;
    const oversize =
      bytes > SCAN_LIMITS.MAX_DIR_BYTES ||
      count > SCAN_LIMITS.MAX_DIR_FILES;
    if (!oversize) continue;
    if (hasCollapsedAncestor(dir, collapsedSet)) continue;
    collapsedSet.add(dir);
  }

  const tsFiles: DiscoveredFile[] = [];
  const otherFiles: DiscoveredFile[] = [];
  for (const [absPath, size] of sizes) {
    const rel = path.relative(root, absPath);
    if (hasCollapsedAncestor(rel, collapsedSet)) continue;
    const file: DiscoveredFile = {
      absPath,
      size,
      oversize: size > SCAN_LIMITS.MAX_FILE_BYTES,
    };
    if (TS_EXTS.has(path.extname(absPath).toLowerCase())) {
      tsFiles.push(file);
    } else {
      otherFiles.push(file);
    }
  }

  const collapsedDirs: CollapsedDir[] = [...collapsedSet].map((relPath) => ({
    absPath: path.join(root, relPath),
    relPath,
    totalBytes: dirBytes.get(relPath) ?? 0,
    fileCount: dirCount.get(relPath) ?? 0,
  }));

  return { tsFiles, otherFiles, collapsedDirs };
}

async function statAll(absPaths: string[]): Promise<Map<string, number>> {
  const sizes = new Map<string, number>();
  for (let i = 0; i < absPaths.length; i += STAT_CONCURRENCY) {
    const chunk = absPaths.slice(i, i + STAT_CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (p) => {
        try {
          const s = await stat(p);
          return [p, s.size] as const;
        } catch {
          return [p, 0] as const;
        }
      }),
    );
    for (const [p, size] of results) sizes.set(p, size);
  }
  return sizes;
}

// True if any strict ancestor of `relPath` (parent, grandparent, …) is in the
// collapsed set. Walks segments instead of repeated string concatenation.
function hasCollapsedAncestor(
  relPath: string,
  collapsedSet: Set<string>,
): boolean {
  if (collapsedSet.size === 0) return false;
  const segments = relPath.split(/[\\/]/);
  for (let i = 1; i < segments.length; i++) {
    const ancestor = segments.slice(0, i).join("/");
    if (collapsedSet.has(ancestor)) return true;
  }
  return false;
}
