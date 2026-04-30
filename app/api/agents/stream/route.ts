/**
 * Server-Sent Events endpoint that pipes the daemon's lifecycle stream
 * through to the browser. If the daemon is down (no listener on the
 * configured port), responds 503 — the frontend falls back to polling
 * /api/agents in that case, so live agent visibility just degrades
 * gracefully instead of breaking.
 */
import { loadConfig } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const config = loadConfig();
  const upstream = `http://127.0.0.1:${config.daemon.port}/agents/stream`;

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstream, {
      signal: request.signal,
      cache: "no-store",
    });
  } catch {
    return new Response("daemon unavailable", { status: 503 });
  }

  if (!upstreamRes.ok || !upstreamRes.body) {
    return new Response("daemon error", { status: 502 });
  }

  return new Response(upstreamRes.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
