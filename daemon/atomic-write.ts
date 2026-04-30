/**
 * Atomic disk writes for lifecycle files. The daemon is the single writer,
 * but readers (the API route, the legacy polling fallback) might read
 * mid-update — temp-file + rename guarantees they see either the old or
 * new file, never a partial write.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { ActiveAgent } from "@/lib/types";

export async function writeAgentFile(
  stateDir: string,
  agent: ActiveAgent,
): Promise<void> {
  await fs.mkdir(stateDir, { recursive: true });
  const target = path.join(stateDir, fileNameFor(agent.id));
  const tmp = `${target}.tmp.${process.pid}.${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(agent), "utf8");
  await fs.rename(tmp, target);
}

export async function removeAgentFile(
  stateDir: string,
  id: string,
): Promise<void> {
  const target = path.join(stateDir, fileNameFor(id));
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

// "main" → "_main.json" (matches the bash hook's underscore-prefix convention
// that kept the main agent out of subagent bind loops). Other ids are used as-is.
function fileNameFor(id: string): string {
  return id === "main" ? "_main.json" : `${id}.json`;
}
