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
  path: string;
  symbols: SymbolNode[];
};

export type DirectoryGroup = {
  name: string;
  files: FileNode[];
};

export type CodebaseTree = {
  root: string;
  groups: DirectoryGroup[];
};

export type ActiveAgent = {
  id: string;
  subagent_type: string;
  description: string;
  startedAt: number;
  lastActiveAt?: number;
  agentId?: string;
  currentPath?: string;
};
