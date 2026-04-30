/**
 * Streams Claude Code's per-agent JSONL transcripts and forwards every
 * surfaced tool_use (and, for the main agent, every assistant text block)
 * into the lifecycle reducer. Replaces agent-watch.sh and agent-main-watch.sh
 * — same logic, no shell, no separate process per agent, no pgrep dedup.
 */
import { promises as fs, watch as fsWatch } from "node:fs";
import path from "node:path";
import type { ActiveAgent } from "@/lib/types";
import type { Lifecycle } from "./lifecycle";
import { formatActivity, type ToolInput } from "./activity";

const WATCH_TOOLS = new Set([
  "Read", "Edit", "Write", "MultiEdit",
  "Bash", "Grep", "Glob", "Task", "Agent",
  "WebFetch", "WebSearch",
]);
const FILE_TOOLS = new Set(["Read", "Edit", "Write", "MultiEdit"]);
const BG_IDLE_AFTER_MS = 3_000;
const POLL_MS = 1_000;

type Stop = () => void;

export class TranscriptWatcher {
  private background = new Map<string, Stop>(); // targetId → stopper
  private main: { path: string; stop: Stop } | null = null;

  constructor(private lifecycle: Lifecycle) {}

  watchBackground(targetId: string, transcriptPath: string, cwd: string): void {
    this.background.get(targetId)?.();
    let stopped = false;
    let offset = 0;
    let lastActivityMs = Date.now();
    let isIdle = false;

    const tick = async () => {
      if (stopped) return;
      if (!this.lifecycle.has(targetId)) {
        this.stopBackground(targetId);
        return;
      }
      try {
        const stat = await fs.stat(transcriptPath);
        if (stat.size > offset) {
          const content = await readSlice(transcriptPath, offset, stat.size);
          offset = stat.size;
          const update = lastToolUpdate(content, cwd);
          if (update) {
            this.lifecycle.applyTranscriptUpdate(targetId, update);
            lastActivityMs = Date.now();
            isIdle = false;
          }
        }
        if (
          !isIdle &&
          Date.now() - lastActivityMs >= BG_IDLE_AFTER_MS
        ) {
          this.lifecycle.markIdleIfPresent(targetId);
          isIdle = true;
        }
      } catch {
        // transcript may not exist yet; retry next tick
      }
    };

    const interval = setInterval(tick, POLL_MS);
    this.background.set(targetId, () => {
      stopped = true;
      clearInterval(interval);
    });
  }

  watchMain(transcriptPath: string): void {
    if (this.main && this.main.path === transcriptPath) return;
    this.main?.stop();

    let stopped = false;
    let offset = 0;

    const tick = async () => {
      if (stopped) return;
      if (!this.lifecycle.has("main")) {
        this.stopMain();
        return;
      }
      try {
        const stat = await fs.stat(transcriptPath);
        if (stat.size > offset) {
          const content = await readSlice(transcriptPath, offset, stat.size);
          offset = stat.size;
          const update = mainUpdate(content);
          if (update && Object.keys(update).length > 0) {
            this.lifecycle.applyTranscriptUpdate("main", update);
          }
        }
      } catch {
        // not yet
      }
    };

    const interval = setInterval(tick, POLL_MS);
    this.main = {
      path: transcriptPath,
      stop: () => {
        stopped = true;
        clearInterval(interval);
      },
    };
  }

  stopFor(id: string): void {
    if (id === "main") this.stopMain();
    else this.stopBackground(id);
  }

  closeAll(): void {
    for (const [, stop] of this.background) stop();
    this.background.clear();
    this.stopMain();
  }

  private stopBackground(id: string): void {
    this.background.get(id)?.();
    this.background.delete(id);
  }

  private stopMain(): void {
    this.main?.stop();
    this.main = null;
  }
}

async function readSlice(
  filePath: string,
  start: number,
  end: number,
): Promise<string> {
  const fh = await fs.open(filePath, "r");
  try {
    const length = end - start;
    const buf = Buffer.alloc(length);
    await fh.read(buf, 0, length, start);
    return buf.toString("utf8");
  } finally {
    await fh.close();
  }
}

type ParsedTool = { name: string; input: ToolInput };

function parseLines(content: string): unknown[] {
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((v) => v !== null);
}

function latestTool(content: string): ParsedTool | null {
  const lines = parseLines(content);
  let latest: ParsedTool | null = null;
  for (const line of lines) {
    const obj = line as Record<string, unknown>;
    const message = obj.message as Record<string, unknown> | undefined;
    const items = (message?.content as unknown[] | undefined) ?? [];
    for (const item of items) {
      const t = item as Record<string, unknown>;
      if (t.type !== "tool_use") continue;
      const name = typeof t.name === "string" ? t.name : "";
      if (!WATCH_TOOLS.has(name)) continue;
      const input = (t.input ?? {}) as ToolInput;
      latest = { name, input };
    }
  }
  return latest;
}

function latestAssistantText(content: string): string | null {
  const lines = parseLines(content);
  let latest: string | null = null;
  for (const line of lines) {
    const obj = line as Record<string, unknown>;
    if (obj.type !== "assistant") continue;
    const message = obj.message as Record<string, unknown> | undefined;
    const items = (message?.content as unknown[] | undefined) ?? [];
    for (const item of items) {
      const t = item as Record<string, unknown>;
      if (t.type === "text" && typeof t.text === "string") latest = t.text;
    }
  }
  return latest;
}

function lastToolUpdate(
  content: string,
  cwd: string,
): Partial<ActiveAgent> | null {
  const tool = latestTool(content);
  if (!tool) return null;
  const update: Partial<ActiveAgent> = {
    status: "active",
    currentActivity: formatActivity(tool.name, tool.input),
  };
  if (FILE_TOOLS.has(tool.name) && tool.input) {
    const fp = (tool.input as Record<string, unknown>).file_path;
    if (typeof fp === "string" && fp) {
      update.currentPath =
        cwd && fp.startsWith(cwd + "/") ? fp.slice(cwd.length + 1) : fp;
    }
  }
  return update;
}

function mainUpdate(content: string): Partial<ActiveAgent> {
  const update: Partial<ActiveAgent> = {};
  const tool = latestTool(content);
  if (tool) {
    const formatted = formatActivity(tool.name, tool.input);
    if (formatted) update.currentActivity = formatted;
  }
  const text = latestAssistantText(content);
  if (text) {
    update.currentMessage = firstSentence(text);
  }
  return update;
}

function firstSentence(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const match = cleaned.match(/^[^.!?]*[.!?]/);
  if (match) return match[0].slice(0, 80);
  return cleaned.slice(0, 80);
}

// Suppress "unused" for fsWatch — the API is here for future fs.watch upgrade
// without changing the import surface. (fs.stat polling is more reliable on
// macOS for append-only logs in 2026 than fs.watch's "rename" event.)
void fsWatch;
