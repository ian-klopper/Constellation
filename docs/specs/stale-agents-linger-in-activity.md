# Stale agents linger in the activity rail after they stop

## Problem
The activity rail keeps showing agents and their last actions even when no agent is actually running anymore. The count in the rail header (e.g. "4") stays inflated, and entries for finished or crashed sessions sit there indefinitely. The user can't tell at a glance whether work is happening *now* or whether they're looking at a ghost from a previous session.

## Outcome
When no agent is running, the activity rail is empty and its count reads zero. When an agent stops — cleanly or via crash, kill, or hook failure — its entry disappears from the rail within a short, predictable window. The rail's contents always reflect what is actually live.

## Acceptance criteria
- [ ] After every agent in the current repo has stopped, the activity rail shows zero entries and a zero count without requiring a page reload.
- [ ] When a single agent stops while others are still running, only that agent's entry is removed; the rest remain.
- [ ] If an agent dies without sending a clean stop signal (crash, SIGKILL, daemon restart, machine sleep), its entry is cleared automatically within a bounded time after its last activity.
- [ ] Reloading the page in a state where no agents are running shows an empty rail, not a snapshot of the last session.
- [ ] Switching repos in the visualizer shows only the destination repo's live agents — entries from the previous repo do not bleed across.

## Out of scope
- Redesigning what the activity rail displays per agent (icon, label, action text).
- Showing a history of recently-finished agents elsewhere in the UI.
- Changes to the trail/tile-pulse overlays on the treemap itself, except where they share the same liveness signal as the rail.

## Constraints
- The fix must preserve the existing invariant that a dead daemon is a silent no-op for Claude Code sessions — nothing in this work can make hook shims block or fail.
- Lifecycle state must remain owned by the daemon as the single writer. The web layer reads; it does not invent or mutate liveness.
- Multi-repo and multi-session correctness must not regress: clearing a stale agent in one repo or session must not clear a live one elsewhere.

## Open questions
- What is the right staleness window for a crashed/abandoned agent before its entry is auto-cleared — seconds, or tens of seconds?
- Should the rail visibly mark an entry as "going stale" before removing it, or just disappear it silently?
- Is the bug primarily missing stop events, missing heartbeats, or the UI ignoring them when they arrive? (The planner should confirm before choosing a mechanism.)
