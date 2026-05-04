# Replace the activity sidebar with a compact agent dock

## Problem
The activity sidebar takes up too much screen real estate next to the treemap, and most of what it shows duplicates information that's already visible on the map (agents pinned to their tiles). The only agents that genuinely need a dedicated home are the ones that have nowhere on the map to land — they're either between files or working on something that doesn't map to a single tile.

## Outcome
The wide activity sidebar is gone. In its place, a small, unobtrusive dock holds only the agents that don't currently have a file to latch onto. Agents working on a specific file continue to appear on top of that file's tile as they do today. When an agent loses its anchor file, it slides into the dock; when it picks one back up, it leaves the dock and reattaches to the tile.

## Acceptance criteria
- [ ] The full-height activity sidebar no longer appears next to the treemap.
- [ ] A small dock is visible somewhere on the page, sized so it doesn't crowd the treemap the way the old sidebar did.
- [ ] Agents that are currently associated with a file in the visible repo appear on that file's tile (unchanged from today).
- [ ] Agents that are *not* associated with any visible file — idle, between tools, or working on something off-map — appear in the dock.
- [ ] When an agent transitions from "no file" to "has a file," its representation moves out of the dock and onto the tile (and vice versa) without the user having to refresh.
- [ ] Each dock entry shows enough to tell agents apart at a glance (e.g. avatar/initial, status, recent activity hint) but is meaningfully more compact than a sidebar row.
- [ ] Hovering or clicking a docked agent reveals the same level of detail the sidebar previously offered (so removing the sidebar doesn't lose information, just relocates it on demand).
- [ ] An empty dock is either hidden entirely or collapses to a tiny resting state — it should not occupy meaningful space when no agents need it.

## Out of scope
- Changing how agents that *are* on a tile look or behave.
- Redesigning the trail/road-routing animation between agents and tiles.
- Adding new lifecycle states or telemetry beyond what already determines "has a file vs. doesn't."
- A persistent activity log or history view — the dock is for *currently* unanchored agents, not a feed.

## Constraints
- Must continue to work for multi-agent, multi-session, multi-repo cases — several agents can be in the dock simultaneously, possibly from different sessions.
- Live updates must keep using the existing SSE stream; no new polling.
- A dead daemon must still leave the page usable — the dock degrades the same way the sidebar did (silent no-op, not a crash).

## Open questions
- Where should the dock live — bottom edge, a corner, or floating? The brief says "smaller" but not "where."
- What's the rule for "no appropriate file"? Candidates: agent has no current tool target, agent's target file is outside the visible repo, or agent's target doesn't resolve to a tile on the current treemap. Pick one and document it, or treat all three as dock-worthy.
- Should the dock have a max size before it scrolls or wraps, and what happens when many agents pile up at once?
