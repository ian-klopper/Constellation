/**
 * Coalesces rapid lifecycle mutations into one disk write per (repo,
 * session, agent). Keeps the on-disk JSON files current for the legacy
 * /api/agents fallback without thrashing the filesystem when the touch
 * hook fires every tool call.
 */
import type { ActiveAgent } from "@/lib/types";
import {
  fileNameFor,
  removeAgentFile,
  writeAgentFile,
} from "./atomic-write";

const FLUSH_DELAY_MS = 50;

type PendingWrite =
  | { kind: "write"; agent: ActiveAgent }
  | { kind: "delete"; cwd: string; sessionId: string; id: string };

export class DiskSync {
  private timers = new Map<string, NodeJS.Timeout>();
  private pending = new Map<string, PendingWrite>();

  constructor(private stateDir: string) {}

  scheduleWrite(agent: ActiveAgent): void {
    const key = fileNameFor(agent.cwd, agent.sessionId, agent.id);
    this.pending.set(key, { kind: "write", agent });
    this.schedule(key);
  }

  scheduleDelete(agent: ActiveAgent): void {
    const key = fileNameFor(agent.cwd, agent.sessionId, agent.id);
    this.pending.set(key, {
      kind: "delete",
      cwd: agent.cwd,
      sessionId: agent.sessionId,
      id: agent.id,
    });
    this.schedule(key);
  }

  private schedule(key: string): void {
    const existing = this.timers.get(key);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => this.flush(key), FLUSH_DELAY_MS);
    this.timers.set(key, timer);
  }

  private async flush(key: string): Promise<void> {
    this.timers.delete(key);
    const op = this.pending.get(key);
    if (!op) return;
    this.pending.delete(key);
    try {
      if (op.kind === "write") {
        await writeAgentFile(this.stateDir, op.agent);
      } else {
        await removeAgentFile(this.stateDir, op.cwd, op.sessionId, op.id);
      }
    } catch (err) {
      console.warn(`[daemon] disk-sync ${key}:`, err);
    }
  }

  async flushAll(): Promise<void> {
    const keys = Array.from(this.timers.keys());
    for (const key of keys) {
      const t = this.timers.get(key);
      if (t) clearTimeout(t);
    }
    this.timers.clear();
    await Promise.all(keys.map((key) => this.flush(key)));
  }
}
