---
date: 2026-04-30
topic: visualizer-text-and-pin
---

# Visualizer text rendering and click-to-pin

## Problem Frame

The treemap visualizer has three related text-display problems that get in the way of skimming the codebase:

1. **In-tile descriptions slice mid-line.** File tiles render their JSDoc-derived description in a plain `<p>` inside an `overflow-hidden` parent. When the description is taller than the tile, it gets cut flat at the bottom — half a line of text, no ellipsis, no signal that there's more. Visible in the user's first screenshot ("filesystem when overy" cut at the tile's bottom edge).

2. **Hover-card descriptions appear cut off.** The floating `HoverPanel` has `overflow-y-auto` and `maxHeight: 600px`, but the panel is `pointer-events-none`, so the wheel doesn't scroll inside it — it scrolls the page behind it, leaving the user no obvious way to reveal hidden content. Long descriptions also get pushed below the visible area when followed by long Exports/Imports/Imported-by lists.

3. **No way to keep a panel open while the mouse moves.** Today the only way to see a file's full info is to keep the cursor over its tile. Concrete workflows blocked by hover-only:
   - Reading a long description without losing it when the mouse drifts.
   - Selecting / copying text from the description (impossible while it's a hover tooltip).
   - Comparing one file's tile-coloring (input/output highlights) to a second file by looking back and forth.

   The user wants click-to-pin alongside hover so the panel survives mouse movement and the panel itself becomes interactive.

## Requirements

**In-tile text (R1–R3)**

- **R1.** A file tile's description MUST never be visually clipped mid-line. It either fits cleanly, or the last visible line ends with `…`. The number of visible lines is computed as `floor(availableHeight / lineHeight)` so the parent's height boundary aligns with a line break (i.e., measure-then-clamp, not a fixed line cap).
- **R2.** When the tile is too short for even one full line, the description is hidden entirely and only the filename header is shown.
- **R3.** The filename header continues to truncate to a single line with `…`.

**Hover panel (R4–R6a)**

- **R4.** The hover panel MUST always show the entire description for the hovered file, with no truncation of the description text.
- **R5.** The panel scrolls as one block — description and lists share a single scroll container. The panel opens scrolled to the top, so the description is fully visible on first display. If total content exceeds the panel's height cap, the user scrolls to reveal the rest.
- **R6.** The panel MUST be pointer-interactive: pointer events enabled, mouse wheel scrolls inside the panel (not the page), and text inside is selectable.
- **R6a.** Cross-element hover survival: moving the cursor from a tile onto the panel MUST NOT dismiss the panel. The hovered-file selection persists while the cursor is over either the tile or the panel.

**Click to pin (R7–R14)**

- **R7.** Clicking a file tile pins that file's panel. The panel anchors at the click position, **clamped to the viewport** so it never extends past any edge (with the existing `VIEWPORT_PADDING` margin).
- **R8.** While a panel is pinned, hover does NOT change selection. The import-graph highlight (blue inputs / amber outputs / dimmed unrelated) freezes on the pinned file. Mousing over other tiles changes nothing visually until the pin is released.
- **R9.** Clicking the same tile again unpins.
- **R10.** Clicking a different tile while pinned re-pins to the new tile (anchored at the new click position, clamped same as R7). The transition reuses the same panel element — no close-and-reopen flash.
- **R11.** Clicking "empty space" unpins. Empty space = any click whose event target is not (a) a tile element registered in `TileRegistry`, (b) inside the `HoverPanel`, or (c) an `AgentOverlay` icon. Pressing `Esc` also unpins.
- **R12.** A pinned tile gets a distinct ring-border state so the user can see which tile is pinned even if the panel scrolls out of sight or the cursor moves far away.
- **R13.** The pinned panel grows a small close (X) button in its top-right corner. Clicking it unpins. (Alternative to Esc / click-same-tile / click-empty-space.)
- **R14.** `AgentOverlay` icons MUST NOT capture clicks — they use `pointer-events: none` (or equivalent) so click events propagate to the tile beneath. This preserves one click meaning across the visualizer; future agent-specific gestures use a modifier or a separate element.

## Success Criteria

- Walking the treemap at any tile size, no description shows a half-cut line — only full lines or full lines ending in `…`.
- For every file, the hover panel displays the full description on first open. The panel only scrolls if its content genuinely exceeds the height cap; the user never has to scroll to *find* the description.
- Clicking a tile pins the panel; moving the mouse anywhere — including onto the panel itself or onto another tile — does not dismiss it.
- Esc, the close (X) button, click-same-tile, and click-on-truly-empty-space all unpin reliably.
- Pin/unpin transitions are instant — no "double panel" frame where two panels appear momentarily during a re-pin.

## Scope Boundaries

- Not building a side-by-side / two-panel comparison view. One pinned panel at a time.
- Not adding keyboard navigation between tiles. `Esc` is the only new keybinding.
- Not adding a pinned-files tray, history, or persistence across reloads. Pin state is in-memory only.
- Not changing tile font size, line-height, or text content — only the truncation rule.
- Not redesigning the panel's information architecture (Exports / Imports from / Imported by sections stay).
- Bare-click on a tile is committed to "pin the panel." Future "click to open file in editor" or "click to focus agent" features will need a modifier (cmd/alt-click) or a different click target — they cannot reclaim the bare-click gesture without breaking this feature.
- Click-vs-drag-vs-text-select disambiguation uses default browser click semantics. If unintended pins from drag-releases become a real problem, address in a follow-up.
- Touch-device interaction is desktop-shaped; phone/tablet behavior is out of scope.
- Keyboard accessibility (Tab into panel, focus trap, screen-reader path) is a future enhancement; not blocking.

## Key Decisions

- **Pin position: clamp to viewport.** Same approach the hover panel already uses for horizontal flipping, generalized to all edges. Predictable; matches the project's preference for boring, well-trodden patterns.
- **Scroll model: whole panel scrolls together.** Description sits at the top of one scroll region. Simpler layout than sticky/hybrid; satisfies "description visible on first display" because the panel opens scrolled to top.
- **Pin visual signal: ring border on tile + close (X) on panel.** Both signals together — the tile state survives panel scroll or occlusion, the close button is an obvious dismiss affordance for users who don't know Esc.
- **Pin suppresses everything hover-driven.** Once pinned, neither the panel selection nor the import-graph highlight responds to hover. Chosen for predictability — the alternative ("panel pinned, highlights still hover") creates two coordinated UI states the user has to track, which is the bug that "predictability" should be solving. Justified on first principles (single source of attention) rather than by analogy.
- **Agent icons pass clicks through.** One click meaning across the visualizer. Future agent-specific gestures will use modifiers or a dedicated element.
- **Pin state lives in `HoverContext`.** Add `pinnedPath: string | null` and `setPinned` to the existing context (`components/HoverContext.tsx` already exists as a standalone file). The existing `inputs`/`outputs` derivation in `Visualizer` switches from `hoveredPath` to `pinnedPath ?? hoveredPath`. State is keyed by file path, not DOM node, so it survives SSE-driven re-renders.
- **Tile truncation: measure then clamp.** Compute `lines = floor((tileH - LABEL_HEIGHT - 2*paddingY) / DESCRIPTION_LINE_HEIGHT)` and pass as `WebkitLineClamp`. Add a `DESCRIPTION_LINE_HEIGHT` (px) constant to `lib/constants.ts` rather than relying on Tailwind class resolution at runtime. This is what guarantees R1 — pure CSS line-clamp alone doesn't, because tile pixel heights rarely divide evenly into line-height.
- **No close-and-reopen flicker on re-pin.** R10 transitions reuse the same panel element; the underlying `pinnedPath` swap is a single React state change.

## Dependencies / Assumptions

- Existing files affected:
  - `components/TreemapNode.tsx` — line-clamp computation per tile, ring-border state for pinned tile, click handler.
  - `components/HoverPanel.tsx` — drop `pointer-events-none`, viewport clamping (vertical edges too), close (X) button, hover-survival on the panel itself, scroll-as-one-block.
  - `components/Visualizer.tsx` — pin state in context, document-level click handler for empty-space dismiss, Esc keybinding, derive `inputs`/`outputs` from `pinnedPath ?? hoveredPath`.
  - `components/HoverContext.tsx` — extend `HoverContextValue` with `pinnedPath` and `setPinned`.
  - `components/AgentOverlay.tsx` and/or `components/AgentIcon.tsx` — set `pointer-events: none` on icons.
  - `lib/constants.ts` — add `DESCRIPTION_LINE_HEIGHT` (px) for the line-clamp math; possibly raise or drop `HARD_MAX_H` so a tall description has room to show.
- `-webkit-line-clamp` is acceptable (works in Chromium, Safari, Firefox 68+ — every browser the project supports). It is paired with the measured line count to keep R1's mid-line guarantee, since line-clamp alone does not.
- Pin state is keyed by file path so re-renders driven by SSE agent updates don't drop it.

## Outstanding Questions

### Resolve Before Planning

*(none — proceed to planning)*

### Deferred to Planning

- [Affects R12] Exact ring-border color/width — visual detail; pick to match existing Tailwind palette during planning.
- [Affects R13] Close (X) button placement (inside top-right vs. outside the panel) and whether it's hover-revealed or always-visible.
- [Affects R5] Whether to raise or remove the existing `HARD_MAX_H = 600` cap. With proper internal scroll the cap is less critical; planning to pick based on how it feels.
- [Affects R7] What happens to a pinned panel when the treemap reflows (window resize) and the pinned tile moves or disappears — re-anchor to tile via `TileRegistry`, dismiss, or leave at original coordinates. Default position: re-anchor; planning to confirm.
- [Affects R6a] Implementation mechanism for cross-element hover survival — guard the tile's `onMouseLeave` against the panel as `relatedTarget`, or keep the panel's own enter/leave wired to the same hover state. Multiple valid implementations.
- [Affects R10] Whether re-pin keeps focus on the same panel DOM node (no remount) or re-creates it. Guard against double-panel flash during the transition.

## Next Steps

`-> /ce:plan` for structured implementation planning
