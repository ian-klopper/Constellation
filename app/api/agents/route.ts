/**
 * Tells the page which Claude agents are working right now. Looks at the
 * little JSON files the hooks leave behind on disk, ignores anything older
 * than 30 minutes, validates each one against the shared zod schema (so a
 * malformed hook write surfaces as a console warning instead of corrupting
 * the UI), and hands back a fresh list every time the page asks.
 */
import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { loadConfig, resolveStateDir } from "@/lib/config";
import { ActiveAgentSchema, type ActiveAgent } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = loadConfig();
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
      continue; // mid-write or unreadable — pick up on next poll
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue; // mid-write JSON; silently skip
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
