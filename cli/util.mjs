// Shared helpers for the constellation CLI subcommands.
import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// macOS's /tmp is a symlink to /private/tmp, and many users have
// symlinked work dirs. Canonicalize so the path the CLI sends matches
// what process.cwd() will produce inside Claude Code hooks.
export function canonicalCwd() {
  return realpathSync(process.cwd());
}

export function userDir() {
  const env = process.env.CONSTELLATION_USER_DIR;
  if (env && env !== "") {
    if (!path.isAbsolute(env)) {
      throw new Error(`CONSTELLATION_USER_DIR must be absolute; got ${env}`);
    }
    return env;
  }
  return path.join(os.homedir(), ".constellation");
}

export function userConfigPath() {
  return path.join(userDir(), "config.json");
}

export function userPidPath() {
  return path.join(userDir(), "daemon.pid");
}

export function userLogPath() {
  return path.join(userDir(), "logs", "daemon.log");
}

export function userWebLogPath() {
  return path.join(userDir(), "logs", "web.log");
}

export function loadConfig(installRoot) {
  // Mirror lib/config.ts: prefer the user file, seed from bundled defaults.
  const target = userConfigPath();
  if (existsSync(target)) {
    return JSON.parse(readFileSync(target, "utf8"));
  }
  const bundled = path.join(installRoot, "constellation.config.json");
  if (!existsSync(bundled)) {
    throw new Error(
      `User config missing at ${target} and no bundled defaults at ${bundled}.`,
    );
  }
  return JSON.parse(readFileSync(bundled, "utf8"));
}

export async function ensureDir(p) {
  await mkdir(p, { recursive: true });
}

// POST a JSON body to the local daemon and return the parsed response.
// Throws with a helpful message if the daemon isn't running.
export async function postDaemon(installRoot, route, body, { timeoutMs = 1500 } = {}) {
  const config = loadConfig(installRoot);
  const url = `http://127.0.0.1:${config.daemon.port}${route}`;
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new Error(
      `Couldn't reach the Constellation daemon at ${url}. ` +
        `Is it running? (${err?.message ?? err})`,
    );
  }
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* leave parsed null */
  }
  if (!res.ok) {
    const detail = parsed?.error ?? text ?? `HTTP ${res.status}`;
    throw new Error(`${route} failed: ${detail}`);
  }
  return parsed;
}

export async function getDaemon(installRoot, route, { timeoutMs = 1500 } = {}) {
  const config = loadConfig(installRoot);
  const url = `http://127.0.0.1:${config.daemon.port}${route}`;
  let res;
  try {
    res = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new Error(
      `Couldn't reach the Constellation daemon at ${url}. ` +
        `Is it running? (${err?.message ?? err})`,
    );
  }
  if (!res.ok) {
    throw new Error(`${route} returned HTTP ${res.status}`);
  }
  return await res.json();
}

export function isAbsoluteRepo(p) {
  return typeof p === "string" && p.length > 0 && path.isAbsolute(p);
}

// Open a URL in the user's default browser. Detached + unref so the CLI
// can exit immediately without leaving zombie children. Same platform
// dispatch as `cli/open.mjs`; extracted so `add` can auto-open the
// dashboard before the long describe run.
export function openInBrowser(url) {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  const proc = spawn(cmd, [url], { stdio: "ignore", detached: true });
  proc.unref();
}

// Fire-and-forget POST to the daemon. Silent on connection refused so
// the caller still works when the daemon is down — same invariant the
// hook shims rely on. Returns nothing; failures are swallowed.
export async function postDaemonNoThrow(installRoot, route, body, { timeoutMs = 500 } = {}) {
  try {
    const config = loadConfig(installRoot);
    const url = `http://127.0.0.1:${config.daemon.port}${route}`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    // Daemon down or slow — describe still works, just no live updates.
  }
}

export function relTime(unixSeconds) {
  if (!unixSeconds) return "never";
  const delta = Math.floor(Date.now() / 1000) - unixSeconds;
  if (delta < 60) return "just now";
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}
