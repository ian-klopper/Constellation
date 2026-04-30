/**
 * The shared "shapes" the rest of the app passes around — what a file looks
 * like in the project map, what kinds of things a file can share with other
 * files (component, hook, type, etc.), and what a running Claude agent looks
 * like. If you change a shape here, every file that touches that data will
 * notice.
 */
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

export type ActiveAgent = {
  id: string;
  subagent_type: string;
  description: string;
  startedAt: number;
  lastActiveAt?: number;
  agentId?: string;
  currentPath?: string;
  kind?: "foreground" | "background";
  status?: "active" | "idle";
  currentActivity?: string;
  currentMessage?: string;
};
