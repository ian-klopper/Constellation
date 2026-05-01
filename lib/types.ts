/**
 * The shared "shapes" the rest of the app passes around — what a file looks
 * like in the project map, what kinds of things a file can share with other
 * files (component, hook, type, etc.), and what a running Claude agent looks
 * like. If you change a shape here, every file that touches that data will
 * notice.
 */
import { z } from "zod";

export type SymbolKind =
  | "component"
  | "route"
  | "action"
  | "function"
  | "hook"
  | "type"
  | "const";

export type SymbolNode = {
  name: string;
  kind: SymbolKind;
};

export type FileNode = {
  kind: "file";
  path: string;
  name: string;
  lines: number;
  symbols: SymbolNode[];
  description?: string;
  imports: string[];
  importedBy: string[];
};

export type DirectoryNode = {
  kind: "directory";
  path: string;
  name: string;
  children: TreeNode[];
  totalLines: number;
};

export type TreeNode = FileNode | DirectoryNode;

export type CodebaseTree = {
  root: string;
  tree: DirectoryNode;
};

// Lifecycle-file shape written by the daemon and read by /api/agents.
// Every agent belongs to a Claude Code session (sessionId, from the hook
// stdin) running in a specific repo (cwd, absolute path). Two parallel
// sessions in the same repo each get their own "main" without colliding —
// the daemon namespaces by (sessionId, id) internally and on disk.
//
// The frontend shape (DisplayAgent) extends this with mountedAt/removingAt
// for fade animation — that's a client-only concern and stays in
// components/AgentOverlay.tsx.
export const ActiveAgentSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  cwd: z.string(),
  subagent_type: z.string(),
  description: z.string(),
  startedAt: z.number(),
  lastActiveAt: z.number().optional(),
  agentId: z.string().optional(),
  currentPath: z.string().optional(),
  kind: z.enum(["foreground", "background"]).optional(),
  status: z.enum(["active", "idle"]).optional(),
  currentActivity: z.string().optional(),
  currentMessage: z.string().optional(),
});

export type ActiveAgent = z.infer<typeof ActiveAgentSchema>;

// One row in the top-left repo switcher. Derived from the lifecycle
// snapshot: any repo with at least one active agent shows up here.
export type RepoSummary = {
  repoPath: string;
  repoName: string;
  sessionCount: number;
  agentCount: number;
  lastActiveAt: number;
};

// What the SSE stream and /api/agents return. Wrapping agents alongside
// repos lets the client keep the switcher list in sync with no extra
// poll.
export type AgentsPayload = {
  agents: ActiveAgent[];
  repos: RepoSummary[];
};
