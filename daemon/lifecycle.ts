/**
 * In-memory lifecycle state machine. Single writer for every mutation —
 * which is how the agent-touch / agent-watch / agent-idle race that
 * plagued the bash hooks dies: one Node event loop, one applyEvent
 * reducer, no concurrent file writes possible.
 *
 * State is namespaced by (sessionId, id) so two parallel Claude Code
 * sessions in the same repo each get their own "main" without colliding,
 * and so multi-repo viewers can filter agents by their owning cwd.
 *
 * After every mutation, schedules a debounced disk write (so the legacy
 * /api/agents polling endpoint keeps working) and broadcasts the new
 * snapshot to SSE subscribers.
 */
import path from "node:path";
import { promises as fs } from "node:fs";
import {
  ActiveAgentSchema,
  type ActiveAgent,
  type AgentsPayload,
  type RepoSummary,
} from "../lib/types";
import { CONSTELLATION } from "../lib/constants";
import type { DiskSync } from "./disk-sync";
import type { SseBroker } from "./sse";
import type { RepoRegistry } from "./registry";
import { formatActivity, type ToolInput } from "./activity";

// Tool names that count as "the agent is editing this file" for the
// frontend's tile-pulse and lastEditAt timestamp. Read-only tools
// (Read, Grep, Glob, Bash) intentionally don't trigger a pulse.
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit"]);

export type LifecycleEvent =
  | {
      type: "agent-start";
      sessionId: string;
      cwd: string;
      tool_use_id: string;
      subagent_type?: string;
      description?: string;
      run_in_background?: boolean;
    }
  | {
      type: "agent-stop";
      sessionId: string;
      cwd: string;
      tool_use_id: string;
      agentId?: string; // background spawn returns child agentId
      output_file?: string;
      transcript_path?: string;
    }
  | {
      type: "subagent-stop";
      sessionId: string;
      cwd: string;
      agent_id: string;
    }
  | {
      type: "touch";
      sessionId: string;
      cwd: string;
      agent_id?: string;
      agent_type?: string;
      tool_name?: string;
      tool_input?: ToolInput;
      transcript_path?: string;
    }
  | {
      type: "idle";
      sessionId: string;
      cwd: string;
      agent_id?: string;
      hook_event_name?: string;
    }
  | { type: "session-start"; sessionId: string; cwd: string };

export type SessionInfo = {
  sessionId: string;
  cwd: string;
  repoName: string;
  startedAt: number;
  lastActiveAt: number;
  agentCount: number;
};

type LifecycleHooks = {
  onBackgroundTranscript?: (
    targetKey: string,
    transcriptPath: string,
    cwd: string,
  ) => void;
  onMainTranscript?: (sessionId: string, transcriptPath: string) => void;
  stopWatchersFor?: (targetKey: string) => void;
};

export class Lifecycle {
  // Keyed by `${sessionId}:${id}` — the composite makes "main" unique per
  // session, and lookups can scope by sessionId without a nested map.
  private agents = new Map<string, ActiveAgent>();

  constructor(
    private disk: DiskSync,
    private sse: SseBroker,
    private registry: RepoRegistry,
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
        const parsed = ActiveAgentSchema.safeParse(JSON.parse(raw));
        if (!parsed.success) continue; // skip pre-multi-repo-format files
        const a = parsed.data;
        this.agents.set(keyFor(a.sessionId, a.id), a);
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

  payload(): AgentsPayload {
    return { agents: this.snapshot(), repos: this.repos() };
  }

  /**
   * Authoritative repo list for the frontend's switcher. Joins the
   * persistent registry (so registered-but-inactive repos show up)
   * with live counts derived from the in-memory agent map.
   */
  repos(): RepoSummary[] {
    const counts = this.activeCounts();
    const out: RepoSummary[] = [];
    const seen = new Set<string>();
    for (const r of this.registry.list()) {
      const c = counts.get(r.path);
      out.push({
        repoPath: r.path,
        repoName: r.name,
        sessionCount: c?.sessionCount ?? 0,
        agentCount: c?.agentCount ?? 0,
        lastActiveAt: c?.lastActiveAt ?? 0,
      });
      seen.add(r.path);
    }
    // A live repo that isn't registered yet (race with auto-register, or
    // a stale agent file) still shows up so the switcher doesn't lose
    // it. The registry.touch() in the route handler usually covers this.
    for (const [repoPath, c] of counts) {
      if (seen.has(repoPath)) continue;
      out.push({
        repoPath,
        repoName: path.basename(repoPath) || repoPath,
        sessionCount: c.sessionCount,
        agentCount: c.agentCount,
        lastActiveAt: c.lastActiveAt,
      });
    }
    return out.sort((a, b) => {
      // Repos with active agents float to the top, then by recency.
      if (a.agentCount !== b.agentCount) return b.agentCount - a.agentCount;
      return b.lastActiveAt - a.lastActiveAt;
    });
  }

  /** Lifecycle-derived view: only repos with at least one live agent. */
  activeRepos(): RepoSummary[] {
    const out: RepoSummary[] = [];
    for (const [repoPath, c] of this.activeCounts()) {
      out.push({
        repoPath,
        repoName: path.basename(repoPath) || repoPath,
        sessionCount: c.sessionCount,
        agentCount: c.agentCount,
        lastActiveAt: c.lastActiveAt,
      });
    }
    return out.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  }

  private activeCounts(): Map<
    string,
    { sessionCount: number; agentCount: number; lastActiveAt: number; sessions: Set<string> }
  > {
    const byRepo = new Map<
      string,
      { sessionCount: number; agentCount: number; lastActiveAt: number; sessions: Set<string> }
    >();
    for (const a of this.agents.values()) {
      if (!a.cwd) continue;
      const last = a.lastActiveAt ?? a.startedAt;
      const cur = byRepo.get(a.cwd);
      if (!cur) {
        byRepo.set(a.cwd, {
          sessionCount: 1,
          agentCount: 1,
          lastActiveAt: last,
          sessions: new Set([a.sessionId]),
        });
      } else {
        cur.agentCount += 1;
        cur.sessions.add(a.sessionId);
        cur.sessionCount = cur.sessions.size;
        cur.lastActiveAt = Math.max(cur.lastActiveAt, last);
      }
    }
    return byRepo;
  }

  sessions(): SessionInfo[] {
    const bySession = new Map<string, SessionInfo>();
    for (const a of this.agents.values()) {
      const cur = bySession.get(a.sessionId);
      if (!cur) {
        bySession.set(a.sessionId, {
          sessionId: a.sessionId,
          cwd: a.cwd,
          repoName: path.basename(a.cwd) || a.cwd,
          startedAt: a.startedAt,
          lastActiveAt: a.lastActiveAt ?? a.startedAt,
          agentCount: 1,
        });
      } else {
        cur.startedAt = Math.min(cur.startedAt, a.startedAt);
        cur.lastActiveAt = Math.max(
          cur.lastActiveAt,
          a.lastActiveAt ?? a.startedAt,
        );
        cur.agentCount += 1;
      }
    }
    return Array.from(bySession.values()).sort(
      (a, b) => b.lastActiveAt - a.lastActiveAt,
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
        this.handleSessionStart(event);
        break;
    }
    this.broadcast();
  }

  private handleAgentStart(
    e: Extract<LifecycleEvent, { type: "agent-start" }>,
  ): void {
    const now = nowSeconds();
    const agent: ActiveAgent = {
      id: e.tool_use_id,
      sessionId: e.sessionId,
      cwd: e.cwd,
      subagent_type: e.subagent_type ?? "unknown",
      description: e.description ?? "",
      startedAt: now,
      lastActiveAt: now,
      kind: e.run_in_background ? "background" : "foreground",
    };
    this.agents.set(keyFor(agent.sessionId, agent.id), agent);
    this.disk.scheduleWrite(agent);
  }

  private handleAgentStop(
    e: Extract<LifecycleEvent, { type: "agent-stop" }>,
  ): void {
    const key = keyFor(e.sessionId, e.tool_use_id);
    const agent = this.agents.get(key);
    if (!agent) return;
    if (agent.kind === "foreground") {
      this.removeAgent(key);
      return;
    }
    // Background: record the child's agentId, leave the file in place.
    // SubagentStop will clean up later via agentId match.
    if (e.agentId) {
      const updated = { ...agent, agentId: e.agentId };
      this.agents.set(key, updated);
      this.disk.scheduleWrite(updated);
    }
    if (e.output_file && e.transcript_path && this.hooks.onBackgroundTranscript) {
      this.hooks.onBackgroundTranscript(key, e.output_file, agent.cwd);
    }
  }

  private handleSubagentStop(
    e: Extract<LifecycleEvent, { type: "subagent-stop" }>,
  ): void {
    for (const [key, agent] of this.agents) {
      if (agent.sessionId !== e.sessionId) continue;
      if (agent.id === "main") continue;
      if (agent.agentId === e.agent_id) {
        this.removeAgent(key);
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
        sessionId: e.sessionId,
        cwd: e.cwd,
        activity,
        filePath,
        toolName: e.tool_name,
        transcriptPath: e.transcript_path,
      });
      return;
    }

    let agent = this.findByAgentId(e.sessionId, e.agent_id);
    if (!agent) {
      agent = this.findOldestUnbound(e.sessionId, e.agent_type);
      if (agent) {
        agent.agentId = e.agent_id;
      }
    }
    if (!agent) return;

    const now = nowSeconds();
    const updated: ActiveAgent = {
      ...agent,
      status: "active",
      lastActiveAt: now,
    };
    if (activity) updated.currentActivity = activity;
    if (filePath) updated.currentPath = filePath;
    if (e.tool_name) updated.currentTool = e.tool_name;
    if (filePath) {
      updated.pathHistory = appendPathHistory(agent.pathHistory, filePath, now);
    }
    if (e.tool_name && EDIT_TOOLS.has(e.tool_name)) {
      updated.lastEditAt = now;
    }

    this.agents.set(keyFor(updated.sessionId, updated.id), updated);
    this.disk.scheduleWrite(updated);
  }

  private upsertMain(opts: {
    sessionId: string;
    cwd: string;
    activity: string;
    filePath: string;
    toolName?: string;
    transcriptPath?: string;
  }): void {
    const now = nowSeconds();
    const key = keyFor(opts.sessionId, "main");
    const existing = this.agents.get(key);
    const next: ActiveAgent = existing
      ? { ...existing, status: "active", lastActiveAt: now, cwd: opts.cwd || existing.cwd }
      : {
          id: "main",
          sessionId: opts.sessionId,
          cwd: opts.cwd,
          subagent_type: "main",
          description: "Claude (main)",
          startedAt: now,
          lastActiveAt: now,
          status: "active",
        };
    if (opts.activity) next.currentActivity = opts.activity;
    if (opts.filePath) next.currentPath = opts.filePath;
    if (opts.toolName) next.currentTool = opts.toolName;
    if (opts.filePath) {
      next.pathHistory = appendPathHistory(existing?.pathHistory, opts.filePath, now);
    }
    if (opts.toolName && EDIT_TOOLS.has(opts.toolName)) {
      next.lastEditAt = now;
    }

    this.agents.set(key, next);
    this.disk.scheduleWrite(next);

    if (opts.transcriptPath && this.hooks.onMainTranscript) {
      this.hooks.onMainTranscript(opts.sessionId, opts.transcriptPath);
    }
  }

  private handleIdle(e: Extract<LifecycleEvent, { type: "idle" }>): void {
    const now = nowSeconds();
    if (!e.agent_id || e.hook_event_name === "Stop") {
      const key = keyFor(e.sessionId, "main");
      const main = this.agents.get(key);
      if (main) {
        const updated = { ...main, status: "idle" as const, lastActiveAt: now };
        this.agents.set(key, updated);
        this.disk.scheduleWrite(updated);
      }
      return;
    }
    const agent = this.findByAgentId(e.sessionId, e.agent_id);
    if (!agent) return;
    const updated = { ...agent, status: "idle" as const, lastActiveAt: now };
    this.agents.set(keyFor(updated.sessionId, updated.id), updated);
    this.disk.scheduleWrite(updated);
  }

  private handleSessionStart(
    e: Extract<LifecycleEvent, { type: "session-start" }>,
  ): void {
    // Clear ONLY this session's agents — other sessions in other repos (or
    // other sessions in the same repo) keep their state.
    for (const [key, agent] of this.agents) {
      if (agent.sessionId !== e.sessionId) continue;
      this.disk.scheduleDelete(agent);
      this.hooks.stopWatchersFor?.(key);
      this.agents.delete(key);
    }
  }

  /** Called by transcript watchers — same single-writer guarantee. */
  applyTranscriptUpdate(
    targetKey: string,
    fields: Partial<ActiveAgent>,
  ): void {
    const agent = this.agents.get(targetKey);
    if (!agent) return;
    const updated = { ...agent, ...fields, lastActiveAt: nowSeconds() };
    this.agents.set(targetKey, updated);
    this.disk.scheduleWrite(updated);
    this.broadcast();
  }

  /** Same single-writer for transcript-driven idle flips. */
  markIdleIfPresent(targetKey: string): void {
    const agent = this.agents.get(targetKey);
    if (!agent || agent.status === "idle") return;
    const updated = { ...agent, status: "idle" as const };
    this.agents.set(targetKey, updated);
    this.disk.scheduleWrite(updated);
    this.broadcast();
  }

  has(targetKey: string): boolean {
    return this.agents.has(targetKey);
  }

  /** Composite key for transcripts.ts to compose when needed. */
  static key(sessionId: string, id: string): string {
    return keyFor(sessionId, id);
  }

  /**
   * Reap subagent entries that were created by `agent-start` but never
   * received a single tool-use touch. The most common cause is a human
   * rejecting an `Agent` tool spawn at the Claude Code prompt — no
   * agent-stop or SubagentStop fires for a rejected spawn, so the
   * entry would otherwise stick forever. `lastActiveAt === startedAt`
   * is the reliable proxy for "never ran" since handleTouch always
   * bumps lastActiveAt. Skips main and background agents (the latter
   * are reaped by SubagentStop via agentId match).
   */
  sweepZombies(maxAgeSeconds: number): void {
    const now = nowSeconds();
    const toRemove: string[] = [];
    for (const [key, agent] of this.agents) {
      if (agent.id === "main") continue;
      if (agent.kind !== "foreground") continue;
      if (agent.lastActiveAt !== agent.startedAt) continue;
      if (now - agent.startedAt < maxAgeSeconds) continue;
      toRemove.push(key);
    }
    if (toRemove.length === 0) return;
    for (const key of toRemove) this.removeAgent(key);
    this.broadcast();
  }

  private removeAgent(key: string): void {
    const agent = this.agents.get(key);
    this.agents.delete(key);
    if (agent) this.disk.scheduleDelete(agent);
    this.hooks.stopWatchersFor?.(key);
  }

  private findByAgentId(
    sessionId: string,
    agentId: string,
  ): ActiveAgent | undefined {
    for (const a of this.agents.values()) {
      if (a.sessionId !== sessionId) continue;
      if (a.id === "main") continue;
      if (a.agentId === agentId) return a;
    }
    return undefined;
  }

  private findOldestUnbound(
    sessionId: string,
    subagentType: string | undefined,
  ): ActiveAgent | undefined {
    let oldest: ActiveAgent | undefined;
    for (const a of this.agents.values()) {
      if (a.sessionId !== sessionId) continue;
      if (a.id === "main") continue;
      if (a.agentId) continue;
      if (subagentType && a.subagent_type !== subagentType) continue;
      if (!oldest || a.startedAt < oldest.startedAt) oldest = a;
    }
    return oldest;
  }

  private broadcast(): void {
    this.sse.broadcast(this.payload());
  }
}

function keyFor(sessionId: string, id: string): string {
  return `${sessionId}:${id}`;
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

// Append a visited path to the trail. Skips consecutive duplicates so a
// chatty Edit→Edit→Edit on the same file doesn't pad the history with
// identical points (the trail's purpose is movement, not repetition).
// Trims to CONSTELLATION.PATH_HISTORY_MAX entries, dropping the oldest.
function appendPathHistory(
  prev: ActiveAgent["pathHistory"],
  path: string,
  ts: number,
): ActiveAgent["pathHistory"] {
  const list = prev ? [...prev] : [];
  const last = list[list.length - 1];
  if (last && last.path === path) return list;
  list.push({ path, ts });
  if (list.length > CONSTELLATION.PATH_HISTORY_MAX) {
    list.splice(0, list.length - CONSTELLATION.PATH_HISTORY_MAX);
  }
  return list;
}
