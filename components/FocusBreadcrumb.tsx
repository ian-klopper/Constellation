/**
 * Header breadcrumb that appears when the user has drilled into a
 * subdirectory. Shows the repo name and each path segment as clickable
 * buttons, letting the user jump back up the focus chain. Renders nothing
 * when the whole repo is in view.
 */
"use client";

import { useFocusContext } from "./FocusContext";

export function FocusBreadcrumb({ rootName }: { rootName: string }) {
  const { focusPath, segments, setFocusPath } = useFocusContext();

  if (!focusPath) return null;

  return (
    <nav
      aria-label="Focus path"
      className="flex items-center gap-1 min-w-0"
    >
      {/* Repo root — always navigates back to full-repo view */}
      <button
        type="button"
        onClick={() => setFocusPath(null)}
        className="block truncate min-w-0 max-w-[12rem] text-[11px] uppercase tracking-wider text-zinc-400 hover:text-zinc-600 transition-colors cursor-pointer"
      >
        {rootName}
      </button>

      {segments.map((seg, i) => {
        const isLast = i === segments.length - 1;
        const segPath = segments.slice(0, i + 1).join("/");
        return (
          <span key={segPath} className="flex items-center gap-1 min-w-0">
            <span className="text-zinc-400 shrink-0">/</span>
            {isLast ? (
              <span className="block truncate min-w-0 max-w-[12rem] text-[11px] uppercase tracking-wider text-zinc-500">
                {seg}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setFocusPath(segPath)}
                className="block truncate min-w-0 max-w-[12rem] text-[11px] uppercase tracking-wider text-zinc-400 hover:text-zinc-600 transition-colors cursor-pointer"
              >
                {seg}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
