/**
 * Tiny HTTP server (Node built-in, no Express) exposing the daemon's
 * event sink, the snapshot API, the SSE stream, and a health probe.
 * The hook shims POST events; /api/agents/stream pipes through to /agents/stream.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Lifecycle, LifecycleEvent } from "./lifecycle";
import type { SseBroker } from "./sse";

export type Server = ReturnType<typeof startServer>;

export function startServer(
  port: number,
  lifecycle: Lifecycle,
  sse: SseBroker,
) {
  const server = createServer(async (req, res) => {
    try {
      await route(req, res, lifecycle, sse);
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
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const route = `${req.method} ${url.pathname}`;

  if (route === "GET /health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (route === "GET /agents") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ agents: lifecycle.snapshot() }));
    return;
  }

  if (route === "GET /agents/stream") {
    sse.add(res, lifecycle.snapshot());
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
  switch (name) {
    case "agent-start":
      return {
        type: "agent-start",
        tool_use_id: str(payload.tool_use_id),
        subagent_type: pickStr(payload, ["tool_input", "subagent_type"]),
        description: pickStr(payload, ["tool_input", "description"]),
        run_in_background:
          pickBool(payload, ["tool_input", "run_in_background"]) ?? false,
      };
    case "agent-stop":
      return {
        type: "agent-stop",
        tool_use_id: str(payload.tool_use_id),
        agentId: pickStr(payload, ["tool_response", "agentId"]) || undefined,
        output_file:
          pickStr(payload, ["tool_response", "outputFile"]) || undefined,
        transcript_path: str(payload.transcript_path) || undefined,
        cwd: str(payload.cwd) || undefined,
      };
    case "subagent-stop":
      return {
        type: "subagent-stop",
        agent_id: str(payload.agent_id),
      };
    case "touch":
      return {
        type: "touch",
        agent_id: str(payload.agent_id) || undefined,
        agent_type: str(payload.agent_type) || undefined,
        tool_name: str(payload.tool_name) || undefined,
        tool_input: (payload.tool_input ?? null) as Record<string, unknown> | null,
        cwd: str(payload.cwd) || undefined,
        transcript_path: str(payload.transcript_path) || undefined,
      };
    case "idle":
      return {
        type: "idle",
        agent_id: str(payload.agent_id) || undefined,
        hook_event_name: str(payload.hook_event_name) || undefined,
      };
    case "session-start":
      return { type: "session-start" };
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
