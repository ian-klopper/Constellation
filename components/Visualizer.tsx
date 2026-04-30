import { DirectoryRegion } from "./DirectoryRegion";
import type { CodebaseTree } from "@/lib/types";

export function Visualizer({ tree }: { tree: CodebaseTree }) {
  return (
    <div className="flex flex-col">
      {tree.groups.map((group) => (
        <DirectoryRegion key={group.name} group={group} />
      ))}
    </div>
  );
}
