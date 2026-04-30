/**
 * Tells the page which Claude agents are working right now. Tries the
 * daemon first (in-memory, always fresh), falls back to reading the
 * lifecycle JSON files from disk if the daemon is down. Validates each
 * record against the shared zod schema so a malformed write surfaces
 * as a console warning instead of corrupting the UI silently.
 */
import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { loadConfig, resolveStateDir } from "@/lib/config";
import { ActiveAgentSchema, type ActiveAgent } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = loadConfig();

  // Try the daemon first — it's the authoritative source.
  try {
    const res = await fetch(
      `http://127.0.0.1:${config.daemon.port}/agents`,
      { cache: "no-store", signal: AbortSignal.timeout(500) },
    );
    if (res.ok) {
      const json = (await res.json()) as { agents: ActiveAgent[] };
      return NextResponse.json({ agents: json.agents });
    }
  } catch {
    // daemon unavailable; fall through to disk
  }

  // Fallback: read the on-disk lifecycle files.
  const stateDir = resolveStateDir();
  let entries: string[];
  try {
    entries = await fs.readdir(stateDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ agents: [] });
    }
    throw err;
  }

  const now = Math.floor(Date.now() / 1000);
  const agents: ActiveAgent[] = [];

  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    let raw: string;
    try {
      raw = await fs.readFile(path.join(stateDir, name), "utf8");
    } catch {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const result = ActiveAgentSchema.safeParse(parsed);
    if (!result.success) {
      console.warn(
        `[/api/agents] ${name}: invalid lifecycle shape — ${result.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`,
      );
      continue;
    }
    const a = result.data;
    const ts = typeof a.lastActiveAt === "number" ? a.lastActiveAt : a.startedAt;
    if (now - ts > config.agentTtlSeconds) continue;
    agents.push(a);
  }

  agents.sort((a, b) => a.startedAt - b.startedAt);
  return NextResponse.json({ agents });
}
