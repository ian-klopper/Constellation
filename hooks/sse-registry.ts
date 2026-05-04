/**
 * Module-level shared EventSource pool. Multiple hook instances that
 * want the same SSE URL share one connection — keyed by URL (so the
 * `?repo=` query string naturally produces distinct connections per
 * repo). Browsers cap localhost HTTP/1.1 at 6 concurrent connections;
 * with five SSE consumers per tab we were saturating the pool and
 * starving Next.js's RSC payload fetch on RepoSwitcher arrow clicks.
 *
 * Subscribers refcount. The connection opens on first subscribe and
 * closes after a 100 ms grace period when refcount hits zero — long
 * enough to swallow React 19 StrictMode dev double-mounts and brief
 * route-transition unmount/remounts without tearing down the socket.
 *
 * Latest payload per (url, event) is cached so a subscriber that
 * mounts after the first event has already arrived gets a synchronous
 * replay through onMessage instead of staring at empty state until the
 * next event.
 */
"use client";

const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 10_000;
const CLOSE_GRACE_MS = 100;

type Listener = {
  event: string;
  onMessage: (data: unknown) => void;
  onError?: () => void;
  onOpen?: () => void;
};

type Conn = {
  url: string;
  source: EventSource | null;
  listeners: Set<Listener>;
  attached: Map<string, (e: MessageEvent) => void>;
  cache: Map<string, unknown>;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  closeTimer: ReturnType<typeof setTimeout> | null;
  backoff: number;
};

const conns = new Map<string, Conn>();

export type SubscribeOpts<T> = {
  url: string;
  event: string;
  onMessage: (data: T) => void;
  onError?: () => void;
  onOpen?: () => void;
};

export function subscribeSSE<T>(opts: SubscribeOpts<T>): () => void {
  const conn = ensureConn(opts.url);
  if (conn.closeTimer) {
    clearTimeout(conn.closeTimer);
    conn.closeTimer = null;
  }

  const listener: Listener = {
    event: opts.event,
    onMessage: opts.onMessage as (data: unknown) => void,
    onError: opts.onError,
    onOpen: opts.onOpen,
  };
  conn.listeners.add(listener);

  ensureEventAttached(conn, opts.event);

  // Replay the most recent payload for this event so a freshly-mounted
  // subscriber doesn't have to wait for the next event to populate.
  const cached = conn.cache.get(opts.event);
  if (cached !== undefined) opts.onMessage(cached as T);

  if (!conn.source && !conn.reconnectTimer) {
    openSource(conn);
  }

  return () => {
    conn.listeners.delete(listener);
    if (conn.listeners.size > 0) return;
    conn.closeTimer = setTimeout(() => {
      if (conn.listeners.size > 0) return;
      teardown(conn);
      conns.delete(conn.url);
    }, CLOSE_GRACE_MS);
  };
}

// Coalesce concurrent fetches to the same URL into one network round-trip.
// Used by useAgentStream's fallback poll: multiple consumers all hitting
// /api/agents on a daemon-down error event become one fetch.
const inflight = new Map<string, Promise<unknown>>();
export async function fetchOnce<T>(url: string): Promise<T | null> {
  const existing = inflight.get(url) as Promise<T | null> | undefined;
  if (existing) return existing;
  const p = (async (): Promise<T | null> => {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) return null;
      return (await r.json()) as T;
    } catch {
      return null;
    } finally {
      inflight.delete(url);
    }
  })();
  inflight.set(url, p as Promise<unknown>);
  return p;
}

function ensureConn(url: string): Conn {
  const existing = conns.get(url);
  if (existing) return existing;
  const c: Conn = {
    url,
    source: null,
    listeners: new Set(),
    attached: new Map(),
    cache: new Map(),
    reconnectTimer: null,
    closeTimer: null,
    backoff: INITIAL_BACKOFF_MS,
  };
  conns.set(url, c);
  return c;
}

function ensureEventAttached(conn: Conn, event: string): void {
  if (conn.attached.has(event)) return;
  const handler = (e: MessageEvent) => {
    let data: unknown;
    try {
      data = JSON.parse(e.data);
    } catch {
      return;
    }
    conn.cache.set(event, data);
    for (const l of conn.listeners) {
      if (l.event === event) l.onMessage(data);
    }
  };
  conn.attached.set(event, handler);
  if (conn.source) conn.source.addEventListener(event, handler);
}

function openSource(conn: Conn): void {
  const src = new EventSource(conn.url);
  conn.source = src;
  src.onopen = () => {
    conn.backoff = INITIAL_BACKOFF_MS;
    for (const l of conn.listeners) l.onOpen?.();
  };
  src.onerror = () => {
    src.close();
    if (conn.source === src) conn.source = null;
    if (conn.listeners.size === 0) return;
    for (const l of conn.listeners) l.onError?.();
    if (conn.reconnectTimer) return;
    const delay = conn.backoff;
    conn.backoff = Math.min(conn.backoff * 2, MAX_BACKOFF_MS);
    conn.reconnectTimer = setTimeout(() => {
      conn.reconnectTimer = null;
      if (conn.listeners.size === 0) return;
      openSource(conn);
    }, delay);
  };
  for (const [event, handler] of conn.attached) {
    src.addEventListener(event, handler);
  }
}

function teardown(conn: Conn): void {
  if (conn.source) {
    conn.source.close();
    conn.source = null;
  }
  if (conn.reconnectTimer) {
    clearTimeout(conn.reconnectTimer);
    conn.reconnectTimer = null;
  }
  conn.attached.clear();
  conn.cache.clear();
  conn.backoff = INITIAL_BACKOFF_MS;
}
