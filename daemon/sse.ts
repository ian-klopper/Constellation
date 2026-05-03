/**
 * Tiny Server-Sent Events broadcaster. The daemon's lifecycle reducer
 * emits a full payload (agents + repo summaries) on every change; this
 * fan-outs that payload to every connected client. /api/agents/stream
 * pipes through to here. A second instance (DescriptionsBroker) does the
 * same job for /event/description-update fan-out — separate so agent
 * stream subscribers don't see description traffic and vice versa.
 */
import type { ServerResponse } from "node:http";
import type { AgentsPayload } from "../lib/types";

const KEEPALIVE_MS = 25_000;

export class SseBroker {
  private clients = new Set<ServerResponse>();
  private keepalive: NodeJS.Timeout;

  constructor() {
    this.keepalive = setInterval(() => this.ping(), KEEPALIVE_MS);
  }

  add(res: ServerResponse, payload: AgentsPayload): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    this.clients.add(res);
    this.send(res, "snapshot", payload);
    res.on("close", () => this.clients.delete(res));
  }

  broadcast(payload: AgentsPayload): void {
    for (const res of this.clients) this.send(res, "snapshot", payload);
  }

  close(): void {
    clearInterval(this.keepalive);
    for (const res of this.clients) res.end();
    this.clients.clear();
  }

  private send(
    res: ServerResponse,
    event: string,
    data: unknown,
  ): void {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      this.clients.delete(res);
    }
  }

  private ping(): void {
    for (const res of this.clients) {
      try {
        res.write(`: ping\n\n`);
      } catch {
        this.clients.delete(res);
      }
    }
  }
}

export type DescriptionUpdate = {
  cwd: string;
  path: string;
  description: string;
};

// Same shape as SseBroker, but per-subscriber repo filtering: a client
// passes ?repo=<absolute-path> when subscribing, and we only forward
// updates whose canonicalized cwd matches. Keeps the server-side logic
// simple (no per-client state on the publish path other than the filter)
// and matches how the visualizer scopes by ?repo= already.
export class DescriptionsBroker {
  private subscribers = new Set<{ res: ServerResponse; repo: string | null }>();
  private keepalive: NodeJS.Timeout;

  constructor() {
    this.keepalive = setInterval(() => this.ping(), KEEPALIVE_MS);
  }

  add(res: ServerResponse, repoFilter: string | null): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const sub = { res, repo: repoFilter };
    this.subscribers.add(sub);
    // Initial comment so EventSource fires `open` immediately and the
    // client knows the connection is live before any updates arrive.
    try {
      res.write(`: connected\n\n`);
    } catch {
      this.subscribers.delete(sub);
    }
    res.on("close", () => this.subscribers.delete(sub));
  }

  publish(update: DescriptionUpdate): void {
    for (const sub of this.subscribers) {
      if (sub.repo && sub.repo !== update.cwd) continue;
      this.send(sub.res, "description", update);
    }
  }

  close(): void {
    clearInterval(this.keepalive);
    for (const sub of this.subscribers) sub.res.end();
    this.subscribers.clear();
  }

  private send(
    res: ServerResponse,
    event: string,
    data: unknown,
  ): void {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      // Drop the dead subscriber; close handler will clean up the Set.
    }
  }

  private ping(): void {
    for (const sub of this.subscribers) {
      try {
        sub.res.write(`: ping\n\n`);
      } catch {
        this.subscribers.delete(sub);
      }
    }
  }
}
