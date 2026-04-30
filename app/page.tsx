import { scanProject } from "@/lib/scan";

export default async function HomePage() {
  const tree = await scanProject();
  return (
    <main className="p-8">
      <h1 className="text-lg">Constellation — codebase visualizer</h1>
      <p className="mt-2 text-sm text-zinc-500">
        Scanned {tree.groups.length} directories,{" "}
        {tree.groups.reduce((n, g) => n + g.files.length, 0)} files. Visualizer
        next.
      </p>
    </main>
  );
}
