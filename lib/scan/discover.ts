/**
 * Walks the project root and splits every interesting file into TypeScript
 * sources (which feed ts-morph) and everything else (which still becomes
 * a tile but doesn't get symbol/import analysis).
 */
import "server-only";
import path from "node:path";
import fg from "fast-glob";

// Anything generated, vendored, ephemeral, or so large it would dwarf real
// source on the treemap. Lockfile is tracked in git but excluded here on
// purpose — at thousands of lines it would dominate the layout.
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

export type DiscoveredFiles = {
  tsAbsPaths: string[];
  otherAbsPaths: string[];
};

export async function discoverFiles(root: string): Promise<DiscoveredFiles> {
  const allFiles = await fg("**/*", {
    cwd: root,
    ignore: IGNORE,
    absolute: true,
    onlyFiles: true,
    dot: true,
  });

  const tsAbsPaths: string[] = [];
  const otherAbsPaths: string[] = [];
  for (const f of allFiles) {
    if (TS_EXTS.has(path.extname(f).toLowerCase())) tsAbsPaths.push(f);
    else otherAbsPaths.push(f);
  }
  return { tsAbsPaths, otherAbsPaths };
}
