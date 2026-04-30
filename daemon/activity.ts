/**
 * Verbatim TS port of .claude/hooks/lib/activity.sh's format_activity.
 * One source of truth for the bubble strings the visualizer shows above
 * each agent icon. Output is a single line, <= 60 chars.
 */
import path from "node:path";

const MAX_LEN = 60;

export type ToolInput = Record<string, unknown> | null | undefined;

export function formatActivity(toolName: string, input: ToolInput): string {
  const out = formatRaw(toolName, input ?? {});
  return out.length > MAX_LEN ? out.slice(0, MAX_LEN) : out;
}

function formatRaw(name: string, input: Record<string, unknown>): string {
  const filePath = str(input.file_path);
  switch (name) {
    case "Read":
      return filePath ? `Reading ${path.basename(filePath)}` : "Reading";
    case "Edit":
    case "MultiEdit":
      return filePath ? `Editing ${path.basename(filePath)}` : "Editing";
    case "Write":
      return filePath ? `Writing ${path.basename(filePath)}` : "Writing";
    case "Bash": {
      const cmd = str(input.command);
      if (!cmd) return "Running";
      const trimmed = cmd.replace(/\n/g, " ").slice(0, 40);
      return `Running \`${trimmed}\``;
    }
    case "Grep": {
      const pattern = str(input.pattern);
      return pattern ? `Searching for "${pattern}"` : "Searching";
    }
    case "Glob": {
      const pattern = str(input.pattern);
      return pattern ? `Listing ${pattern}` : "Listing";
    }
    case "Task":
    case "Agent": {
      const stype = str(input.subagent_type);
      const desc = str(input.description);
      if (stype && desc) return `Spawning ${stype}: ${desc}`;
      if (stype) return `Spawning ${stype}`;
      return "Spawning agent";
    }
    case "WebFetch": {
      const url = str(input.url);
      if (!url) return "Fetching the web";
      const host = url.replace(/^https?:\/\//, "").split("/")[0];
      return host ? `Fetching ${host}` : "Fetching the web";
    }
    case "WebSearch":
      return "Searching the web";
    case "":
      return "";
    default:
      return name;
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
