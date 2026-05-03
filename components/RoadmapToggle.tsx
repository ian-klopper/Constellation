/**
 * Header-mounted "Roadmap" button. Click to drop a panel that surfaces
 * the project's roadmap.json: the one-line right_now, the goal lists
 * grouped by horizon, and recently_shipped. Lower-priority sections
 * (known issues, open questions, anti-goals, parked ideas) render at
 * the bottom in muted tone — present but not loud. Closes on Escape
 * and on outside click.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import type {
  GoalItem,
  IdeaItem,
  Roadmap,
  ShippedItem,
} from "@/lib/roadmap";

const STATUS_TINT: Record<GoalItem["status"], string> = {
  queued: "bg-zinc-100 text-zinc-600",
  in_progress: "bg-emerald-100 text-emerald-700",
  blocked: "bg-amber-100 text-amber-800",
};

const STATUS_LABEL: Record<GoalItem["status"], string> = {
  queued: "queued",
  in_progress: "in progress",
  blocked: "blocked",
};

export function RoadmapToggle({ data }: { data: Roadmap }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (containerRef.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded px-2 py-1 uppercase tracking-wider hover:bg-zinc-100 hover:text-zinc-700"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        Roadmap
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Project roadmap"
          className="absolute right-0 top-[calc(100%+8px)] z-50 max-h-[70vh] w-[28rem] overflow-y-auto rounded-md border border-zinc-200 bg-white p-4 text-sm normal-case tracking-normal text-zinc-800 shadow-lg"
        >
          <RightNow text={data.right_now} />
          <GoalSection title="Next few days" items={data.short_term} />
          <GoalSection title="Next few weeks" items={data.mid_term} />
          <GoalSection title="Long term" items={data.long_term} />
          <ShippedSection items={data.recently_shipped} />
          <IdeaSection
            title="Known issues"
            items={data.known_issues}
            tone="zinc"
          />
          <IdeaSection
            title="Open questions"
            items={data.open_questions}
            tone="zinc"
          />
          <IdeaSection
            title="Anti-goals"
            items={data.anti_goals}
            tone="zinc"
          />
          <IdeaSection
            title="Parked ideas"
            items={data.parked_ideas}
            tone="zinc"
          />
        </div>
      )}
    </div>
  );
}

function RightNow({ text }: { text: string }) {
  return (
    <section className="mb-4">
      <SectionLabel>Right now</SectionLabel>
      <p className="mt-1 text-zinc-900">{text}</p>
    </section>
  );
}

function GoalSection({
  title,
  items,
}: {
  title: string;
  items: GoalItem[];
}) {
  if (items.length === 0) return null;
  return (
    <section className="mb-4">
      <SectionLabel>{title}</SectionLabel>
      <ul className="mt-1 space-y-2">
        {items.map((item) => (
          <li key={item.id}>
            <div className="flex items-start gap-2">
              <StatusBadge status={item.status} />
              <span className="flex-1">{item.title}</span>
            </div>
            {item.notes && (
              <p className="mt-1 ml-[4.25rem] text-xs text-zinc-500">
                {item.notes}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ShippedSection({ items }: { items: ShippedItem[] }) {
  if (items.length === 0) return null;
  return (
    <section className="mb-4">
      <SectionLabel>Recently shipped</SectionLabel>
      <ul className="mt-1 space-y-2">
        {items.map((item) => (
          <li key={item.id} className="flex items-start gap-2">
            <span className="w-[5.5rem] shrink-0 tabular-nums text-xs text-zinc-500">
              {item.shipped_at}
            </span>
            <span className="flex-1 text-zinc-700">{item.title}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function IdeaSection({
  title,
  items,
  tone,
}: {
  title: string;
  items: IdeaItem[];
  tone: "zinc";
}) {
  if (items.length === 0) return null;
  return (
    <section className="mb-3">
      <SectionLabel>{title}</SectionLabel>
      <ul
        className={`mt-1 space-y-1 text-xs ${
          tone === "zinc" ? "text-zinc-500" : ""
        }`}
      >
        {items.map((item, i) => (
          <li key={`${item.title}-${i}`}>
            <span>{item.title}</span>
            {item.notes && (
              <span className="text-zinc-400"> — {item.notes}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[10px] uppercase tracking-wider text-zinc-500">
      {children}
    </h3>
  );
}

function StatusBadge({ status }: { status: GoalItem["status"] }) {
  return (
    <span
      className={`inline-flex w-16 shrink-0 justify-center rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${STATUS_TINT[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
