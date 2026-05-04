# Focus on a section of the codebase

## Problem
The visualizer always shows the whole repo at once. On non-trivial codebases that means lots of small tiles competing for screen space — the area the user actually cares about right now is cramped, hard to read, and surrounded by visual noise. Today there's no way to say "just show me this part."

## Outcome
The user picks a section of the visualization and the view re-presents that section as the subject — its contents get the full canvas, the layout is recomputed for the focused scope, and live agent activity inside that section continues to play. Backing out returns to the previous scope without losing context. The transition feels like the visualization re-organizing itself around the user's attention, not like enlarging a snapshot.

## Users
Anyone using Constellation to navigate or watch agent activity in a repo big enough that the full-repo view is cluttered.

## Acceptance criteria
- [ ] User can pick any section of the visualization and have the view focus on just that section.
- [ ] The focused view uses the full canvas to lay out the chosen section's contents — proportions, density, and which child tiles are visible are recomputed for the focused scope, not inherited from the parent view.
- [ ] User can back out to the previous scope and return to where they were (no full reset).
- [ ] User can tell at a glance where in the overall repo they are currently focused.
- [ ] Live agent activity (icons, trails, tile pulses, activity rail) inside the focused section keeps appearing during focus.
- [ ] Agent activity occurring outside the focused section does not silently disappear — the user is at minimum signalled that something is happening elsewhere.
- [ ] Entering and leaving focus is animated in a way that conveys re-layout, not photographic zoom.

## Out of scope
- Persisted "favorite sections" or saved workspaces.
- Side-by-side comparison of two focused sections.
- Editing or running code from the focused view.
- Focus state syncing across multiple browser tabs.

## Constraints
- The home page must still default to the whole-repo scope; focus is opt-in.
- The existing SSE / live-agent overlay path must keep working unchanged inside focus mode — focus can't fork the live update plumbing.
- Focus state is scoped to the currently displayed repo; switching repos via `RepoSwitcher` should not carry focus across.

## Open questions
- What does "doesn't feel like a generic zoom" actually look like? Candidates: a fresh squarified treemap of just the focused subtree (re-layout), an animated unfold where the focused tile expands and its siblings slide off, a different layout style for sub-views (e.g. nested tree), or a hybrid. Each implies a different feel and different implementation cost.
- How does the user pick a section — click a directory tile, double-click, a dedicated affordance on hover, breadcrumb, search, keyboard?
- Is focus single-level (one section at a time) or recursive (focus inside an already-focused section)?
- Should the focused view be linkable via URL so the user can share "this section" with a teammate?
- How should off-focus agent activity be surfaced — a peripheral indicator on the activity rail, a toast, an auto-defocus on activity, or something else?
