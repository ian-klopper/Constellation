/**
 * Server-Sent Events endpoint that pipes the daemon's per-file
 * description-update stream through to the browser. Forwards the
 * incoming `?repo=<absolute-path>` query so the daemon's broker can
 * pre-filter to the visualized repo. If the daemon is down, responds
 * 503 — the frontend keeps showing whatever was server-rendered, just
 * without live pop-in. Same graceful-degradation invariant as the
 * agents stream proxy.
 */
import { loadConfig } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const config = loadConfig();
  const url = new URL(request.url);
  const repo = url.searchParams.get("repo");
  const upstream =
    `http://127.0.0.1:${config.daemon.port}/descriptions/stream` +
    (repo ? `?repo=${encodeURIComponent(repo)}` : "");

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
