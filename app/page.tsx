/**
 * The home page — the only page in the app. Reads the whole project on the
 * server, then hands the result to the map and the live-agent display.
 */
import { scanProject, countTree } from "@/lib/scan";
import { Visualizer } from "@/components/Visualizer";
import { ActiveAgents } from "@/components/ActiveAgents";
import { AgentOverlay } from "@/components/AgentOverlay";

export default async function HomePage() {
  const tree = await scanProject();
  const stats = countTree(tree.tree);
  return (
    <main className="flex h-screen flex-col">
      <header className="border-b border-zinc-200 px-6 py-3 text-[11px] uppercase tracking-wider text-zinc-500">
        Constellation — {stats.dirs} directories, {stats.files} files,{" "}
        {stats.lines} lines
      </header>
      <ActiveAgents />
      <div className="min-h-0 flex-1">
        <Visualizer tree={tree} />
      </div>
      <AgentOverlay />
    </main>
  );
}
