import { scanProject } from "@/lib/scan";
import { Visualizer } from "@/components/Visualizer";

export default async function HomePage() {
  const tree = await scanProject();
  return (
    <main>
      <header className="border-b border-zinc-200 px-6 py-3 text-[11px] uppercase tracking-wider text-zinc-500">
        Constellation — {tree.groups.length} directories,{" "}
        {tree.groups.reduce((n, g) => n + g.files.length, 0)} files
      </header>
      <Visualizer tree={tree} />
    </main>
  );
}
