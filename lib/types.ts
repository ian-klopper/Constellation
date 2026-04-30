/**
 * Shared types for the visualizer: the directory/file tree shape returned by
 * the scanner, the SymbolKind discriminator that drives Glyph rendering, and
 * the ActiveAgent record served by /api/agents.
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
};
