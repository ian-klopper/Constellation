/**
 * Tiny HTTP server (Node built-in, no Express) exposing the daemon's
 * event sink, the snapshot API, the SSE stream, and a health probe.
 * The hook shims POST events; /api/agents/stream pipes through to /agents/stream.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import type { Lifecycle, LifecycleEvent } from "./lifecycle";
import type { SseBroker } from "./sse";
import type { RepoRegistry } from "./registry";

export type Server = ReturnType<typeof startServer>;

export type ServerMeta = {
  port: number;
  startedAt: number;
};

export function startServer(
  port: number,
  lifecycle: Lifecycle,
  sse: SseBroker,
  registry: RepoRegistry,
) {
  const meta: ServerMeta = { port, startedAt: Date.now() };
  const server = createServer(async (req, res) => {
    try {
      await route(req, res, lifecycle, sse, registry, meta);
    } catch (err) {
      console.warn("[daemon] route error:", err);
      if (!res.headersSent) {
        res.writeHead(500).end();
      }
    }
  });
  server.listen(port, "127.0.0.1");
  return server;
}

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  lifecycle: Lifecycle,
  sse: SseBroker,
  registry: RepoRegistry,
  meta: ServerMeta,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const route = `${req.method} ${url.pathname}`;

  if (route === "GET /health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        uptime: Math.floor((Date.now() - meta.startedAt) / 1000),
        agentCount: lifecycle.snapshot().length,
        port: meta.port,
      }),
    );
    return;
  }

  if (route === "GET /agents") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(lifecycle.payload()));
    return;
  }

  if (route === "GET /agents/stream") {
    sse.add(res, lifecycle.payload());
    return;
  }

  if (route === "GET /sessions") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ sessions: lifecycle.sessions() }));
    return;
  }

  if (route === "GET /repos") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ repos: lifecycle.repos() }));
    return;
  }

  if (route === "GET /repos/active") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ repos: lifecycle.activeRepos() }));
    return;
  }

  if (route === "POST /repos/register") {
    const body = await readBody(req);
    const payload = safeJson(body);
    const repoPath = typeof payload.path === "string" ? payload.path : "";
    if (!repoPath || !path.isAbsolute(repoPath)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "path must be absolute" }));
      return;
    }
    const created = registry.register(repoPath, "manual");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, created }));
    sse.broadcast(lifecycle.payload());
    return;
  }

  if (route === "POST /repos/unregister") {
    const body = await readBody(req);
    const payload = safeJson(body);
    const repoPath = typeof payload.path === "string" ? payload.path : "";
    if (!repoPath) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "path required" }));
      return;
    }
    const removed = registry.unregister(repoPath);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, removed }));
    sse.broadcast(lifecycle.payload());
    return;
  }

  if (req.method === "POST" && url.pathname.startsWith("/event/")) {
    const eventName = url.pathname.slice("/event/".length);
    const body = await readBody(req);
    const payload = body ? safeJson(body) : {};
    const event = mapEvent(eventName, payload);
    if (!event) {
      res.writeHead(400).end();
      return;
    }
    // Auto-register the cwd before applying the event so the lifecycle
    // reducer's broadcast already reflects the new entry.
    if (event.cwd) registry.touch(event.cwd);
    lifecycle.applyEvent(event);
    res.writeHead(204).end();
    return;
  }

  res.writeHead(404).end();
}

function mapEvent(
  name: string,
  payload: Record<string, unknown>,
): LifecycleEvent | null {
  // session_id and cwd ride on every Claude Code hook stdin payload — pull
  // them out once and tag every event so the lifecycle reducer can
  // namespace state by (sessionId, agentId) and so each agent carries its
  // owning repo path for the frontend to filter on.
  const sessionId = str(payload.session_id);
  const cwd = str(payload.cwd);
  if (!sessionId) {
    // No session_id ⇒ not a real Claude Code event. Defensive: reject so a
    // stray request doesn't end up as an unowned agent.
    return null;
  }
  switch (name) {
    case "agent-start":
      return {
        type: "agent-start",
        sessionId,
        cwd,
        tool_use_id: str(payload.tool_use_id),
        subagent_type: pickStr(payload, ["tool_input", "subagent_type"]),
        description: pickStr(payload, ["tool_input", "description"]),
        run_in_background:
          pickBool(payload, ["tool_input", "run_in_background"]) ?? false,
      };
    case "agent-stop":
      return {
        type: "agent-stop",
        sessionId,
        cwd,
        tool_use_id: str(payload.tool_use_id),
        agentId: pickStr(payload, ["tool_response", "agentId"]) || undefined,
        output_file:
          pickStr(payload, ["tool_response", "outputFile"]) || undefined,
        transcript_path: str(payload.transcript_path) || undefined,
      };
    case "subagent-stop":
      return {
        type: "subagent-stop",
        sessionId,
        cwd,
        agent_id: str(payload.agent_id),
      };
    case "touch":
      return {
        type: "touch",
        sessionId,
        cwd,
        agent_id: str(payload.agent_id) || undefined,
        agent_type: str(payload.agent_type) || undefined,
        tool_name: str(payload.tool_name) || undefined,
        tool_input: (payload.tool_input ?? null) as Record<string, unknown> | null,
        transcript_path: str(payload.transcript_path) || undefined,
      };
    case "idle":
      return {
        type: "idle",
        sessionId,
        cwd,
        agent_id: str(payload.agent_id) || undefined,
        hook_event_name: str(payload.hook_event_name) || undefined,
      };
    case "session-start":
      return { type: "session-start", sessionId, cwd };
    default:
      return null;
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function safeJson(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function pickStr(obj: Record<string, unknown>, path: string[]): string {
  let cur: unknown = obj;
  for (const k of path) {
    if (cur && typeof cur === "object" && k in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[k];
    } else return "";
  }
  return typeof cur === "string" ? cur : "";
}

function pickBool(obj: Record<string, unknown>, path: string[]): boolean | null {
  let cur: unknown = obj;
  for (const k of path) {
    if (cur && typeof cur === "object" && k in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[k];
    } else return null;
  }
  return typeof cur === "boolean" ? cur : null;
}
