/**
 * Coalesces rapid lifecycle mutations into one disk write per id. Keeps
 * the on-disk JSON files current for the legacy /api/agents fallback
 * without thrashing the filesystem when the touch hook fires every
 * tool call.
 */
import type { ActiveAgent } from "@/lib/types";
import { removeAgentFile, writeAgentFile } from "./atomic-write";

const FLUSH_DELAY_MS = 50;

type PendingWrite =
  | { kind: "write"; agent: ActiveAgent }
  | { kind: "delete" };

export class DiskSync {
  private timers = new Map<string, NodeJS.Timeout>();
  private pending = new Map<string, PendingWrite>();

  constructor(private stateDir: string) {}

  scheduleWrite(agent: ActiveAgent): void {
    this.pending.set(agent.id, { kind: "write", agent });
    this.schedule(agent.id);
  }

  scheduleDelete(id: string): void {
    this.pending.set(id, { kind: "delete" });
    this.schedule(id);
  }

  private schedule(id: string): void {
    const existing = this.timers.get(id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => this.flush(id), FLUSH_DELAY_MS);
    this.timers.set(id, timer);
  }

  private async flush(id: string): Promise<void> {
    this.timers.delete(id);
    const op = this.pending.get(id);
    if (!op) return;
    this.pending.delete(id);
    try {
      if (op.kind === "write") {
        await writeAgentFile(this.stateDir, op.agent);
      } else {
        await removeAgentFile(this.stateDir, id);
      }
    } catch (err) {
      console.warn(`[daemon] disk-sync ${id}:`, err);
    }
  }

  async flushAll(): Promise<void> {
    const ids = Array.from(this.timers.keys());
    for (const id of ids) {
      const t = this.timers.get(id);
      if (t) clearTimeout(t);
    }
    this.timers.clear();
    await Promise.all(ids.map((id) => this.flush(id)));
  }
}
