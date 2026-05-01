/**
 * Loads the optional `.constellation/descriptions.{yaml,yml,json}` sidecar
 * map from the repo being scanned. Sidecar entries override anything the
 * in-file extractors found, which is the right precedence for one reason:
 * the user typed the sidecar entry deliberately. If they later add an
 * in-file JSDoc and forget to delete the sidecar entry, sidecar wins —
 * matches their last explicit choice.
 *
 * The format is a flat `{ "<repo-relative-path>": "<one-line description>" }`
 * map. Anything else (top-level array, non-string values, missing/malformed
 * file) emits a single console.warn and the loader returns an empty Map. The
 * scan must keep working with no sidecar — the failure mode is "tile shows
 * filename only," not a crash.
 *
 * Each visualized repo carries its own sidecar; the loader takes the same
 * `root` already passed to `scanProject(root)` so multi-repo lookups don't
 * leak across repos.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";

type SidecarMap = Map<string, string>;

const CANDIDATE_FILES = [
  "descriptions.yaml",
  "descriptions.yml",
  "descriptions.json",
];

export async function loadDescriptionSidecar(
  scannedRoot: string,
): Promise<SidecarMap> {
  for (const name of CANDIDATE_FILES) {
    const abs = path.join(scannedRoot, ".constellation", name);
    const text = await tryRead(abs);
    if (text === null) continue;
    return parseSidecar(abs, text);
  }
  return new Map();
}

async function tryRead(absPath: string): Promise<string | null> {
  try {
    return await readFile(absPath, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return null;
    console.warn(
      `[constellation] sidecar at ${absPath} could not be read: ${(err as Error).message}`,
    );
    return null;
  }
}

function parseSidecar(absPath: string, text: string): SidecarMap {
  const result = new Map<string, string>();
  let raw: unknown;
  try {
    raw = absPath.endsWith(".json") ? JSON.parse(text) : parseYaml(text);
  } catch (err) {
    console.warn(
      `[constellation] sidecar at ${absPath} failed to parse: ${(err as Error).message}`,
    );
    return result;
  }

  if (raw === null || raw === undefined) return result;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    console.warn(
      `[constellation] sidecar at ${absPath} ignored: expected an object map of paths`,
    );
    return result;
  }

  for (const [rawKey, rawValue] of Object.entries(raw)) {
    if (typeof rawValue !== "string") {
      console.warn(
        `[constellation] sidecar at ${absPath} skipped key ${JSON.stringify(rawKey)}: value must be a string`,
      );
      continue;
    }
    const value = rawValue.trim();
    if (!value) continue;
    const key = normalizeKey(rawKey);
    result.set(key, value);
  }
  return result;
}

function normalizeKey(key: string): string {
  let k = key.replace(/\\/g, "/");
  if (k.startsWith("./")) k = k.slice(2);
  return k;
}
