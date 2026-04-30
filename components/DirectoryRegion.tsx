import { FileCard } from "./FileCard";
import type { DirectoryGroup } from "@/lib/types";

const TINTS: Record<string, string> = {
  app: "bg-[#eef2f7]",
  components: "bg-[#e7eee2]",
  lib: "bg-[#f5f5f4]",
  supabase: "bg-[#f3edd9]",
  trigger: "bg-[#f0d9d9]",
};

export function DirectoryRegion({ group }: { group: DirectoryGroup }) {
  const tint = TINTS[group.name] ?? "bg-zinc-50";
  return (
    <section className={`relative ${tint} px-6 pt-10 pb-6`}>
      <div className="absolute right-6 top-3 text-[11px] font-medium tracking-wider uppercase text-zinc-500">
        {group.name}/
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
        {group.files.map((file) => (
          <FileCard key={file.path} file={file} />
        ))}
      </div>
    </section>
  );
}
