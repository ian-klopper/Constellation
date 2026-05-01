/**
 * Atomic disk writes for lifecycle files. The daemon is the single writer,
 * but readers (the API route, the legacy polling fallback) might read
 * mid-update — temp-file + rename guarantees they see either the old or
 * new file, never a partial write.
 *
 * Filenames are namespaced by session: `<sessionId>__<id>.json`. Two
 * parallel sessions in the same repo each get their own `<id>__main.json`
 * without colliding. The double-underscore separator stays out of the way
 * of UUIDs (which use single hyphens) and tool_use_id strings (alphanum
 * + underscores).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { ActiveAgent } from "@/lib/types";

export async function writeAgentFile(
  stateDir: string,
  agent: ActiveAgent,
): Promise<void> {
  await fs.mkdir(stateDir, { recursive: true });
  const target = path.join(stateDir, fileNameFor(agent.sessionId, agent.id));
  const tmp = `${target}.tmp.${process.pid}.${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(agent), "utf8");
  await fs.rename(tmp, target);
}

export async function removeAgentFile(
  stateDir: string,
  sessionId: string,
  id: string,
): Promise<void> {
  const target = path.join(stateDir, fileNameFor(sessionId, id));
  await fs.rm(target, { force: true });
}

export async function clearAgentFiles(stateDir: string): Promise<void> {
  try {
    const entries = await fs.readdir(stateDir);
    await Promise.all(
      entries
        .filter((n) => n.endsWith(".json"))
        .map((n) => fs.rm(path.join(stateDir, n), { force: true })),
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

// Defensive sanitize: in practice sessionId is a Claude Code UUID and id
// is either "main" or a tool_use_id (alphanum + underscore), so this
// replace is a no-op today. The rule keeps a hostile id from escaping
// stateDir via path traversal.
export function fileNameFor(sessionId: string, id: string): string {
  const safeSession = sessionId.replace(/[^A-Za-z0-9._-]/g, "_");
  const safeId = id.replace(/[^A-Za-z0-9._-]/g, "_");
  return `${safeSession}__${safeId}.json`;
}
