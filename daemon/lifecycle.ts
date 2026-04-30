/**
 * In-memory lifecycle state machine. Single writer for every mutation —
 * which is how the agent-touch / agent-watch / agent-idle race that
 * plagued the bash hooks dies: one Node event loop, one applyEvent
 * reducer, no concurrent file writes possible.
 *
 * After every mutation, schedules a debounced disk write (so the legacy
 * /api/agents polling endpoint keeps working) and broadcasts the new
 * snapshot to SSE subscribers.
 */
import path from "node:path";
import { promises as fs } from "node:fs";
import type { ActiveAgent } from "@/lib/types";
import type { DiskSync } from "./disk-sync";
import type { SseBroker } from "./sse";
import { formatActivity, type ToolInput } from "./activity";

export type LifecycleEvent =
  | {
      type: "agent-start";
      tool_use_id: string;
      subagent_type?: string;
      description?: string;
      run_in_background?: boolean;
    }
  | {
      type: "agent-stop";
      tool_use_id: string;
      agentId?: string; // background spawn returns child agentId
      output_file?: string;
      transcript_path?: string;
      cwd?: string;
    }
  | { type: "subagent-stop"; agent_id: string }
  | {
      type: "touch";
      agent_id?: string;
      agent_type?: string;
      tool_name?: string;
      tool_input?: ToolInput;
      cwd?: string;
      transcript_path?: string;
    }
  | {
      type: "idle";
      agent_id?: string;
      hook_event_name?: string;
    }
  | { type: "session-start" };

type LifecycleHooks = {
  onBackgroundTranscript?: (
    targetId: string,
    transcriptPath: string,
    cwd: string,
  ) => void;
  onMainTranscript?: (transcriptPath: string) => void;
  stopWatchersFor?: (id: string) => void;
};

export class Lifecycle {
  private agents = new Map<string, ActiveAgent>();

  constructor(
    private disk: DiskSync,
    private sse: SseBroker,
    private hooks: LifecycleHooks = {},
  ) {}

  setHooks(hooks: LifecycleHooks): void {
    this.hooks = hooks;
  }

  /** Re-hydrate state from any lifecycle files left over from a previous run. */
  async loadFromDisk(stateDir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdir(stateDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
    for (const name of entries) {
      if (!name.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(path.join(stateDir, name), "utf8");
        const a = JSON.parse(raw) as ActiveAgent;
        if (typeof a.id === "string" && typeof a.startedAt === "number") {
          this.agents.set(a.id, a);
        }
      } catch {
        // skip malformed
      }
    }
  }

  snapshot(): ActiveAgent[] {
    return Array.from(this.agents.values()).sort(
      (a, b) => a.startedAt - b.startedAt,
    );
  }

  applyEvent(event: LifecycleEvent): void {
    switch (event.type) {
      case "agent-start":
        this.handleAgentStart(event);
        break;
      case "agent-stop":
        this.handleAgentStop(event);
        break;
      case "subagent-stop":
        this.handleSubagentStop(event);
        break;
      case "touch":
        this.handleTouch(event);
        break;
      case "idle":
        this.handleIdle(event);
        break;
      case "session-start":
        this.handleSessionStart();
        break;
    }
    this.sse.broadcast(this.snapshot());
  }

  private handleAgentStart(
    e: Extract<LifecycleEvent, { type: "agent-start" }>,
  ): void {
    const now = nowSeconds();
    const agent: ActiveAgent = {
      id: e.tool_use_id,
      subagent_type: e.subagent_type ?? "unknown",
      description: e.description ?? "",
      startedAt: now,
      lastActiveAt: now,
      kind: e.run_in_background ? "background" : "foreground",
    };
    this.agents.set(agent.id, agent);
    this.disk.scheduleWrite(agent);
  }

  private handleAgentStop(
    e: Extract<LifecycleEvent, { type: "agent-stop" }>,
  ): void {
    const agent = this.agents.get(e.tool_use_id);
    if (!agent) return;
    if (agent.kind === "foreground") {
      this.removeAgent(agent.id);
      return;
    }
    // Background: record the child's agentId, leave the file in place.
    // SubagentStop will clean up later via agentId match.
    if (e.agentId) {
      const updated = { ...agent, agentId: e.agentId };
      this.agents.set(updated.id, updated);
      this.disk.scheduleWrite(updated);
    }
    if (e.output_file && e.transcript_path && this.hooks.onBackgroundTranscript) {
      this.hooks.onBackgroundTranscript(
        agent.id,
        e.output_file,
        e.cwd ?? "",
      );
    }
  }

  private handleSubagentStop(
    e: Extract<LifecycleEvent, { type: "subagent-stop" }>,
  ): void {
    for (const [id, agent] of this.agents) {
      if (id === "main") continue;
      if (agent.agentId === e.agent_id) {
        this.removeAgent(id);
        return;
      }
    }
  }

  private handleTouch(
    e: Extract<LifecycleEvent, { type: "touch" }>,
  ): void {
    const activity = e.tool_name
      ? formatActivity(e.tool_name, e.tool_input)
      : "";
    const filePath = relativizePath(
      typeof e.tool_input?.file_path === "string"
        ? e.tool_input.file_path
        : "",
      e.cwd,
    );

    if (!e.agent_id) {
      this.upsertMain({
        activity,
        filePath,
        transcriptPath: e.transcript_path,
      });
      return;
    }

    let agent = this.findByAgentId(e.agent_id);
    if (!agent) {
      agent = this.findOldestUnbound(e.agent_type);
      if (agent) {
        agent.agentId = e.agent_id;
      }
    }
    if (!agent) return;

    const updated: ActiveAgent = {
      ...agent,
      status: "active",
      lastActiveAt: nowSeconds(),
    };
    if (activity) updated.currentActivity = activity;
    if (filePath) updated.currentPath = filePath;

    this.agents.set(updated.id, updated);
    this.disk.scheduleWrite(updated);
  }

  private upsertMain(opts: {
    activity: string;
    filePath: string;
    transcriptPath?: string;
  }): void {
    const now = nowSeconds();
    const existing = this.agents.get("main");
    const next: ActiveAgent = existing
      ? { ...existing, status: "active", lastActiveAt: now }
      : {
          id: "main",
          subagent_type: "main",
          description: "Claude (main)",
          startedAt: now,
          lastActiveAt: now,
          status: "active",
        };
    if (opts.activity) next.currentActivity = opts.activity;
    if (opts.filePath) next.currentPath = opts.filePath;

    this.agents.set("main", next);
    this.disk.scheduleWrite(next);

    if (opts.transcriptPath && this.hooks.onMainTranscript) {
      this.hooks.onMainTranscript(opts.transcriptPath);
    }
  }

  private handleIdle(e: Extract<LifecycleEvent, { type: "idle" }>): void {
    const now = nowSeconds();
    if (!e.agent_id || e.hook_event_name === "Stop") {
      const main = this.agents.get("main");
      if (main) {
        const updated = { ...main, status: "idle" as const, lastActiveAt: now };
        this.agents.set("main", updated);
        this.disk.scheduleWrite(updated);
      }
      return;
    }
    const agent = this.findByAgentId(e.agent_id);
    if (!agent) return;
    const updated = { ...agent, status: "idle" as const, lastActiveAt: now };
    this.agents.set(updated.id, updated);
    this.disk.scheduleWrite(updated);
  }

  private handleSessionStart(): void {
    for (const id of this.agents.keys()) {
      this.disk.scheduleDelete(id);
      this.hooks.stopWatchersFor?.(id);
    }
    this.agents.clear();
  }

  /** Called by transcript watchers — same single-writer guarantee. */
  applyTranscriptUpdate(
    targetId: string,
    fields: Partial<ActiveAgent>,
  ): void {
    const agent = this.agents.get(targetId);
    if (!agent) return;
    const updated = { ...agent, ...fields, lastActiveAt: nowSeconds() };
    this.agents.set(targetId, updated);
    this.disk.scheduleWrite(updated);
    this.sse.broadcast(this.snapshot());
  }

  /** Same single-writer for transcript-driven idle flips. */
  markIdleIfPresent(targetId: string): void {
    const agent = this.agents.get(targetId);
    if (!agent || agent.status === "idle") return;
    const updated = { ...agent, status: "idle" as const };
    this.agents.set(targetId, updated);
    this.disk.scheduleWrite(updated);
    this.sse.broadcast(this.snapshot());
  }

  has(id: string): boolean {
    return this.agents.has(id);
  }

  private removeAgent(id: string): void {
    this.agents.delete(id);
    this.disk.scheduleDelete(id);
    this.hooks.stopWatchersFor?.(id);
  }

  private findByAgentId(agentId: string): ActiveAgent | undefined {
    for (const [id, a] of this.agents) {
      if (id === "main") continue;
      if (a.agentId === agentId) return a;
    }
    return undefined;
  }

  private findOldestUnbound(
    subagentType: string | undefined,
  ): ActiveAgent | undefined {
    let oldest: ActiveAgent | undefined;
    for (const [id, a] of this.agents) {
      if (id === "main") continue;
      if (a.agentId) continue;
      if (subagentType && a.subagent_type !== subagentType) continue;
      if (!oldest || a.startedAt < oldest.startedAt) oldest = a;
    }
    return oldest;
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function relativizePath(filePath: string, cwd: string | undefined): string {
  if (!filePath) return "";
  if (cwd && filePath.startsWith(cwd + "/")) {
    return filePath.slice(cwd.length + 1);
  }
  return filePath;
}
