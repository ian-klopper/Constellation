/**
 * Pulls a description from each file's leading comment block. The supported
 * format-to-syntax map is the dispatch table below. Anything that doesn't
 * appear there returns undefined and the tile shows just its filename — a
 * wrong guess is worse than none for the vibecoder this map is built for.
 *
 * For TS/JS/CSS files the JSDoc may sit *above or below* a leading run of
 * shebangs, string-literal directives ('use client', 'use server', 'use
 * strict', 'use asm'), and a closed set of single-line directive comments
 * (// @vitest-environment, // @ts-nocheck, // eslint-disable, etc.). The
 * "preamble" classifier is intentionally a closed set: a wildcard `// @\w`
 * rule would silently swallow real-world non-pragma comments like
 * `// @author Foo` or `// @license MIT` and could promote a function-level
 * JSDoc later in the file as a wrong file-level description. New pragmas
 * get added to LINE_DIRECTIVE_PATTERNS as they emerge.
 *
 * No length cap. The tile applies a per-tile line-clamp at render time to
 * fit the description into whatever vertical space the squarify layout
 * gave it; the hover panel scrolls long descriptions. A scan-time clamp
 * would force both surfaces to share the same truncation, which broke R4
 * (panel must show the full description).
 *
 * The description-writer prompt at the end of `install.sh` mirrors these
 * has-header rules so the launched Claude session can decide which files
 * to skip without importing this module. If you change detection here,
 * also update the prompt in `install.sh` and the "File descriptions"
 * bullet in `CLAUDE.md`.
 */
import "server-only";
import path from "node:path";

type Extractor = (source: string) => string | undefined;

const EXTRACTORS: Record<string, Extractor> = {
  ".ts": extractJsDoc,
  ".tsx": extractJsDoc,
  ".js": extractJsDoc,
  ".jsx": extractJsDoc,
  ".mjs": extractJsDoc,
  ".cjs": extractJsDoc,
  ".css": extractJsDoc,
  ".scss": extractJsDoc,
  ".sh": extractHashHeader,
  ".md": extractMarkdownIntro,
  ".sql": extractSqlHeader,
  ".yaml": extractHashHeader,
  ".yml": extractHashHeader,
  ".py": extractPythonDoc,
  ".rb": extractHashHeader,
  ".html": extractHtmlComment,
  ".htm": extractHtmlComment,
};

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
  const extractor = EXTRACTORS[ext];
  return extractor ? extractor(source) : undefined;
}

// --- JSDoc + directive-aware preamble ---------------------------------------

const STRING_DIRECTIVE_RE =
  /^['"]use (client|server|strict|asm)['"];?\s*(?:\/\/.*)?$/;

// Closed set. See module docstring for why this isn't a wildcard.
const LINE_DIRECTIVE_PATTERNS: RegExp[] = [
  /^@vitest-environment\b/,
  /^@jest-environment\b/,
  /^@ts-nocheck\b/,
  /^@ts-check\b/,
  /^@ts-expect-error\b/,
  /^@ts-ignore\b/,
  /^@flow\b/,
  /^@next-runtime\b/,
  // \b after `eslint-disable` matches `-line` and `-next-line` variants too,
  // because `-` is a non-word boundary.
  /^eslint-disable\b/,
  /^eslint-enable\b/,
  /^prettier-ignore\b/,
  /^stylelint-disable\b/,
  /^stylelint-enable\b/,
];

function isPreambleLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === "") return true;
  if (trimmed.startsWith("#!")) return true;
  if (STRING_DIRECTIVE_RE.test(trimmed)) return true;
  if (trimmed.startsWith("//")) {
    const inner = trimmed.slice(2).trimStart();
    if (LINE_DIRECTIVE_PATTERNS.some((re) => re.test(inner))) return true;
  }
  return false;
}

// Walks lines from byte 0 and returns the byte offset right after the last
// preamble line. A file with no preamble returns 0; a file that's entirely
// preamble returns source.length.
function findJsDocAnchor(source: string): number {
  let i = 0;
  while (i < source.length) {
    const newlineIdx = source.indexOf("\n", i);
    const lineEnd = newlineIdx === -1 ? source.length : newlineIdx;
    if (!isPreambleLine(source.slice(i, lineEnd))) return i;
    i = newlineIdx === -1 ? source.length : newlineIdx + 1;
  }
  return i;
}

function extractJsDoc(source: string): string | undefined {
  // Fast path: description at byte 0 (current behavior, also handles the
  // "/** desc */ then 'use client'" ordering since the regex matches first).
  const head = matchJsDocAt(source, 0);
  if (head !== undefined) return head;

  // Fallback: skip directive preamble, try again. Only worth doing if there
  // *is* a preamble — otherwise we'd just retry the same byte-0 match.
  const anchor = findJsDocAnchor(source);
  if (anchor === 0) return undefined;
  return matchJsDocAt(source, anchor);
}

function matchJsDocAt(source: string, offset: number): string | undefined {
  const match = source.slice(offset).match(/^\s*\/\*\*([\s\S]*?)\*\//);
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

// --- Hash-comment header (shell, YAML, Ruby, Python fallback) --------------

function extractHashHeader(source: string): string | undefined {
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

// --- Markdown ---------------------------------------------------------------

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

// --- SQL --------------------------------------------------------------------

function extractSqlHeader(source: string): string | undefined {
  // Block comment at byte 0 wins.
  const block = source.match(/^\s*\/\*([\s\S]*?)\*\//);
  if (block) {
    const body = block[1]
      .split("\n")
      .map((line) => line.replace(/^\s*\*\s?/, "").trim())
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (body) return body;
  }
  // Otherwise, leading -- line block.
  const lines = source.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  const out: string[] = [];
  while (i < lines.length) {
    const line = lines[i].trimStart();
    if (!line.startsWith("--")) break;
    const stripped = line.replace(/^-+\s?/, "").trim();
    if (stripped === "") break;
    out.push(stripped);
    i++;
  }
  if (out.length === 0) return undefined;
  return nonEmpty(out.join(" ").replace(/\s+/g, " ").trim());
}

// --- Python -----------------------------------------------------------------

const PYTHON_CODING_RE = /^#.*coding[:=]\s*[\w.-]+/;

function extractPythonDoc(source: string): string | undefined {
  // Skip optional shebang and an optional `# coding: ...` line, then blanks.
  const lines = source.split("\n");
  let i = 0;
  if (lines[i]?.startsWith("#!")) i++;
  if (lines[i] !== undefined && PYTHON_CODING_RE.test(lines[i])) i++;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (i >= lines.length) return undefined;

  const first = lines[i];
  const trimmedStart = first.trimStart();

  // Module docstring: triple-quoted string, no prefix forms (r"""..., b"""...,
  // f"""..., etc. are valid Python but the closed-set policy keeps detection
  // unambiguous and lets us fall through to # block on a miss).
  for (const quote of ['"""', "'''"] as const) {
    if (!trimmedStart.startsWith(quote)) continue;
    // Single-line case: opener and closer on the same line.
    const afterOpener = trimmedStart.slice(quote.length);
    const closerOnSameLine = afterOpener.indexOf(quote);
    if (closerOnSameLine !== -1) {
      const body = afterOpener.slice(0, closerOnSameLine).trim();
      return nonEmpty(body.replace(/\s+/g, " "));
    }
    // Multi-line: scan forward for the closer.
    const buffer: string[] = [afterOpener];
    for (let j = i + 1; j < lines.length; j++) {
      const ln = lines[j];
      const closer = ln.indexOf(quote);
      if (closer !== -1) {
        buffer.push(ln.slice(0, closer));
        return firstParagraph(buffer.join("\n"));
      }
      buffer.push(ln);
    }
    return undefined; // unterminated docstring; bail
  }

  // No docstring — fall back to a leading # block. Strip the shebang and
  // coding line first; extractHashHeader only knows about shebangs, so a raw
  // pass would treat `# coding: utf-8` as description text.
  return extractHashHeader(lines.slice(i).join("\n"));
}

function firstParagraph(body: string): string | undefined {
  const paragraphs = body.split(/\n\s*\n/);
  for (const p of paragraphs) {
    const cleaned = p.replace(/\s+/g, " ").trim();
    if (cleaned) return cleaned;
  }
  return undefined;
}

// --- HTML -------------------------------------------------------------------

function extractHtmlComment(source: string): string | undefined {
  // Strip optional UTF-8 BOM.
  let s = source.startsWith("﻿") ? source.slice(1) : source;
  s = s.replace(/^\s+/, "");
  // Skip optional XML prolog.
  s = s.replace(/^<\?xml[^>]*\?>\s*/i, "");
  // Skip optional doctype.
  s = s.replace(/^<!doctype[^>]*>\s*/i, "");
  // Match the next comment.
  const match = s.match(/^<!--([\s\S]*?)-->/);
  if (!match) return undefined;
  const body = match[1].replace(/\s+/g, " ").trim();
  if (!body) return undefined;
  // Reject IE conditional comments — `[if IE]>...<![endif]` is HTML-comment
  // syntax but never a real description.
  if (body.startsWith("[if ") || body.startsWith("[if(")) return undefined;
  return body;
}

// ---------------------------------------------------------------------------

function nonEmpty(s: string): string | undefined {
  return s ? s : undefined;
}
