/**
 * Tiny Server-Sent Events broadcaster. The daemon's lifecycle reducer
 * emits a full snapshot on every change; this fan-outs that snapshot
 * to every connected client. /api/agents/stream pipes through to here.
 */
import type { ServerResponse } from "node:http";
import type { ActiveAgent } from "@/lib/types";

const KEEPALIVE_MS = 25_000;

export class SseBroker {
  private clients = new Set<ServerResponse>();
  private keepalive: NodeJS.Timeout;

  constructor() {
    this.keepalive = setInterval(() => this.ping(), KEEPALIVE_MS);
  }

  add(res: ServerResponse, snapshot: ActiveAgent[]): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    this.clients.add(res);
    this.send(res, "snapshot", snapshot);
    res.on("close", () => this.clients.delete(res));
  }

  broadcast(snapshot: ActiveAgent[]): void {
    for (const res of this.clients) this.send(res, "snapshot", snapshot);
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
