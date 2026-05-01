/**
 * Pulls a description from each file's leading comment block. JS/TS/CSS
 * files use a /** … *\/ JSDoc; shell scripts use the leading # lines after
 * the shebang; markdown grabs the first paragraph below any heading. For
 * everything else (JSON, lockfiles, .gitignore, etc.) we leave description
 * undefined and let the tile show just its filename — a wrong guess is
 * worse than none for the vibecoder this map is built for.
 *
 * No length cap. The tile applies a per-tile line-clamp at render time to
 * fit the description into whatever vertical space the squarify layout
 * gave it; the hover panel scrolls long descriptions. A scan-time clamp
 * would force both surfaces to share the same truncation, which broke R4
 * (panel must show the full description).
 */
import "server-only";
import path from "node:path";

const JSDOC_LIKE_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css", ".scss",
]);

export function extractDescriptions(
  sources: Map<string, string>,
): Map<string, string> {
  const result = new Map<string, string>();
  for (const [relPath, text] of sources) {
    const desc = extractDescription(path.basename(relPath), text);
    if (desc !== undefined) result.set(relPath, desc);
  }
  return result;
}

export function extractDescription(
  filename: string,
  source: string,
): string | undefined {
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
  return nonEmpty(body.split(/\s@\w/)[0].trim());
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
  return nonEmpty(out.join(" ").replace(/\s+/g, " ").trim());
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
    return nonEmpty(para.join(" ").replace(/\s+/g, " ").trim());
  }
  return undefined;
}

function nonEmpty(s: string): string | undefined {
  return s ? s : undefined;
}
