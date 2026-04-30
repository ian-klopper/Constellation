import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { ActiveAgent } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATE_DIR = path.join(process.cwd(), ".constellation", "agents");
const MAX_AGE_SECONDS = 30 * 60;

export async function GET() {
  let entries: string[];
  try {
    entries = await fs.readdir(STATE_DIR);
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
    try {
      const raw = await fs.readFile(path.join(STATE_DIR, name), "utf8");
      const a = JSON.parse(raw) as ActiveAgent;
      if (typeof a.startedAt !== "number") continue;
      const ts = typeof a.lastActiveAt === "number" ? a.lastActiveAt : a.startedAt;
      if (now - ts > MAX_AGE_SECONDS) continue;
      agents.push(a);
    } catch {
      // mid-write or unreadable file — pick up on next poll
    }
  }

  agents.sort((a, b) => a.startedAt - b.startedAt);
  return NextResponse.json({ agents });
}
