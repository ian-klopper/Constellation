---
title: Visualizer text rendering and click-to-pin
type: feat
status: active
date: 2026-04-30
origin: docs/brainstorms/visualizer-text-and-pin-requirements.md
---

# Visualizer text rendering and click-to-pin

## Overview

Fix three text-rendering problems in the treemap visualizer and add a click-to-pin gesture so the hover panel can survive mouse movement. Today's behavior: tiles slice descriptions mid-line with no ellipsis, the hover panel is `pointer-events-none` so it can't be scrolled, and the panel dismisses the moment the cursor leaves the source tile. After this work: tiles show as many full lines as fit (or hide the description entirely), the panel is interactive and clamped to the viewport, and clicking a tile pins the panel until the user dismisses it.

## Problem Frame

See origin doc. Three concrete pains for the user (an amateur dev dogfooding Constellation while working in Claude Code):
- Reading file descriptions in tiles is broken when the text gets clipped mid-line.
- The hover panel hides content behind a scrollbar the user can't actually use.
- Hover-only means descriptions can't be selected or copied, and any mouse movement dismisses the panel before the user can interact with it (e.g., to scroll a long description or read an import-list entry). Comparing two files side-by-side is **not** in scope here — that's a future feature; the present scope is making one panel survive long enough to be useful.

## Requirements Trace

Carried verbatim from origin doc. All numbering matches `docs/brainstorms/visualizer-text-and-pin-requirements.md`.

- R1. Tile description never clipped mid-line; uses `floor(availableHeight / lineHeight)` as the line clamp.
- R2. Hide description entirely when no full line fits.
- R3. Filename header continues to truncate to one line with `…`.
- R4. Hover panel always shows the entire description; no description truncation.
- R5. Panel scrolls as one block; opens scrolled to top so the description is visible on first display.
- R6. Panel is pointer-interactive (wheel scroll, text selection).
- R6a. Cross-element hover survival: cursor moving from tile onto panel does not dismiss the panel.
- R7. Click pins the panel at the click position, **clamped to the viewport**.
- R8. While pinned, hover does not change selection; import-graph highlight freezes on the pinned file.
- R9. Click same tile again → unpin.
- R10. Click a different tile → re-pin (no close-and-reopen flash).
- R11. Click empty space (not a tile, not the panel, not an `AgentOverlay` icon) → unpin. Esc also unpins.
- R12. Pinned tile gets a distinct ring-border state.
- R13. Pinned panel grows a close (X) button.
- R14. `AgentOverlay` icons are click-transparent.

## Scope Boundaries

Carried from origin doc:
- One pinned panel at a time (no side-by-side comparison view).
- No keyboard navigation between tiles; `Esc` is the only new keybinding.
- No persistence across reloads — pin is in-memory only.
- No tile font-size / line-height changes — only truncation rule.
- No panel info-architecture redesign.
- Bare-click on a tile is committed to "pin"; future "click to open file" features will use modifiers or a different element.
- Default browser click semantics for click-vs-drag-vs-text-select; address only if it becomes a real problem.
- Touch / mobile interaction out of scope. On touch devices, click-to-pin will function (tap = synthetic click), but hover behavior won't and the close (X) button is the only documented dismiss path. We don't intentionally test or polish touch — but we don't break it either.
- Keyboard accessibility (Tab, focus trap, screen-reader path) is a future enhancement, not blocking. Tiles in this release are pointer-only: there is no `tabIndex` or `onKeyDown` on `FileTile`.

## Context & Research

### Relevant Code and Patterns

- `components/TreemapNode.tsx` — recursive treemap renderer; the `FileTile` sub-component owns hover state class and renders the `<p>` with the description.
- `components/HoverPanel.tsx` — floating panel with cursor-anchored positioning, horizontal edge-flip, vertical max-height. Today renders with `pointer-events-none` and reads `mousePos` from props.
- `components/HoverContext.tsx` — already a standalone file (verified). Owns `hoveredPath`, `inputs`, `outputs`, `setHover`. Pin state extends this contract.
- `components/Visualizer.tsx` — owns `mousePos` local state (intentionally not in context, to avoid re-rendering every tile on mousemove); derives `inputs`/`outputs` via `useMemo` from `hoveredPath`. Wires up the `ResizeObserver` and the `<HoverContext.Provider>`.
- `components/TileRegistry.tsx` — `useRegisterTile(node.path)` registers each tile DOM element. Tiles also still carry the `data-path` attribute as a redundant escape hatch (per CLAUDE.md). For R11's empty-space detection we'll use `el.closest('[data-path]')` — no new TileRegistry export needed.
- `components/AgentOverlay.tsx` — already wraps in `pointer-events-none fixed inset-0 z-50` (verified).
- `components/AgentIcon.tsx` — currently sets `pointer-events-auto` on its root `<div>` (verified, line 32). **This is the only element above tiles that captures clicks.** R14 reduces to removing that class.
- `components/AgentBubble.tsx` — already `pointer-events-none` (verified). No change needed.
- `lib/constants.ts` — already centralizes UI sizing/timing. New `DESCRIPTION_LINE_HEIGHT` and `FILE_TILE_HEADER_HEIGHT` constants go under `TREEMAP`. Existing `HOVER_PANEL.HARD_MAX_H = 600` is preserved; raising it can wait until we see how the panel feels.

### Institutional Learnings

None — this project has no `docs/solutions/`. First time through this kind of refactor.

### External References

None — this is internal UI work with no security, payment, or external-API surface. The local patterns (React function components, Tailwind utility classes, Context for shared state, ResizeObserver for measurement) are well established. Tailwind v4 ships built-in `line-clamp-N` utilities, but R1's clamp value is per-tile dynamic (Tailwind can't safelist arbitrary integers), so we use inline `style={{ WebkitLineClamp }}` instead — established pattern, no new mechanism.

### Project-Specific Constraint

**No test runner is configured in this project** (per `CLAUDE.md`: "No test runner yet"). `package.json` has no `test` script. This plan therefore does not specify Jest/Vitest test files. Each unit's test scenarios are framed as manual browser-verification cases the implementer (or user) walks through in the dev server. If a test runner is added later, these scenarios are already specific enough to translate into RTL/Vitest cases.

## Key Technical Decisions

- **Pin state lives in `HoverContext`, not a new context.** Adds two fields: `pinnedPath: string | null` and `setPinned(path | null, pos?)`. `Visualizer` derives `inputs`/`outputs` from `pinnedPath ?? hoveredPath`. Single source of truth, no prop drilling, minimal change to existing wiring.
- **`mousePos` stays in `Visualizer` local state for hover, but `pinnedPos` joins `HoverContext`.** `mousePos` updates on every mousemove and would re-render every tile if it lived in context (existing comment in `HoverContext.tsx` explains this). `pinnedPos` only changes on pin events — context is fine.
- **Tile line-clamp uses pinned line-height.** Set `leading-[14px]` on the description `<p>` (replacing Tailwind's `leading-snug`, whose 1.375 ratio at 11px renders ~15px and would make `floor(h / 14)` over-promise). Pair with `DESCRIPTION_LINE_HEIGHT = 14` and a separate `FILE_TILE_HEADER_HEIGHT` constant (~24px, measure to confirm) — do NOT reuse the directory `LABEL_HEIGHT = 16`, which is for directory headers, not the file tile's own header.
- **Panel scroll reset uses `useEffect`, not `key={file.path}`.** A `key`-driven remount destroys the panel's DOM element on every file change, which causes a guaranteed visible flash on every hover transition AND violates R10's no-flash promise on re-pin. Instead: keep the panel mounted, hold a `ref` to the scrollable inner div, and `scrollRef.current.scrollTo(0, 0)` from a `useEffect` keyed on `file.path`.
- **`panelHovered` lives in a `useRef`, not in context.** Adding it to context would re-render every tile on each panel enter/leave (with hundreds of tiles, that's a perceptible stutter). A `useRef<boolean>` in `Visualizer`, passed via a stable `panelHoveredRef` prop or read imperatively in the tile's `onMouseLeave`, has zero render cost.
- **R11 "empty space" via inline `closest('[data-path]')`.** A document-level click handler walks `event.target.closest('[data-path]')` and bails when it finds a tile, the panel, or an agent element. No new TileRegistry export needed; `data-path` is already the redundant escape hatch CLAUDE.md describes for exactly this kind of lookup.
- **Document-level handlers attach once, gate via ref.** The `keydown` (Esc) and `click` (empty-space) listeners are mounted once on `Visualizer` mount with empty deps, and read `pinnedPath` via a ref inside the handler. This avoids attach/detach churn each time `pinnedPath` changes, eliminates StrictMode double-attachment concerns, and removes the dependence on `e.stopPropagation()` to control the document handler's behavior. (`stopPropagation` does NOT prevent native `window.addEventListener` from firing — `closest('[data-path]')` is the actual safety mechanism.)
- **Pointer-distance guard on the document click handler.** Track `pointerdown` coords; if the subsequent `click` event's coords differ by more than ~4px (browser native click-drag threshold), ignore it. This prevents trackpad scroll-release synthetic clicks from spuriously unpinning.
- **Pin auto-clears when its target file disappears.** A `useEffect` watches `(pinnedPath, filesByPath)` and calls `setPinned(null)` if `filesByPath.get(pinnedPath)` is undefined. Handles HMR-style scan re-runs and any future edits that delete files mid-session.
- **Pin position re-anchors on viewport resize.** When the viewport changes size, the pinned panel re-runs its viewport-clamping with the original `pinnedPos`. The pinned tile may also have moved due to treemap reflow; if `TileRegistry.get(pinnedPath)` returns a still-mounted element, re-read its `getBoundingClientRect()` and use the rect's center as the new anchor. If the tile is gone, the auto-clear effect above handles it.
- **In-place pin transition uses one panel element, swap props.** R10 re-pin doesn't unmount/remount the panel — `<HoverPanel>` stays in the tree, its `file` and `pinnedPos` props change in one render. Combined with `useEffect`-driven scroll reset (above), no flash.
- **Agent icons use plain class removal, not class addition.** R14 = remove `pointer-events-auto` from the AgentIcon `<div>`'s className. The container (`AgentOverlay`) and the bubble (`AgentBubble`) are already `pointer-events-none`. Adding `pointer-events-none` to the icon would conflict with the existing `pointer-events-auto` on the same element; remove the `auto` class instead.
- **Pinned-tile ring uses `outline`, not Tailwind's `ring`.** The tile's `<article>` has `overflow-hidden`, which clips `box-shadow`-based rings on tile boundaries. `outline outline-2 outline-sky-500 -outline-offset-2` paints reliably on all four edges.
- **Close (X) button is always visible when pinned.** Hover-revealed close is an anti-pattern for ephemeral panels — users won't hover-discover an affordance they don't know exists. Always-visible at the panel's top-right (inside the panel bounds).
- **Hover panel uses zero cursor offset; pin keeps the 16px offset.** In hover mode, the panel's edge touches the cursor (offset = 0) so there's no gap for the cursor to traverse — `relatedTarget`-based hover survival works reliably. In pin mode, the panel anchors at the click point with the existing 16px offset so it doesn't cover the click target.

## Open Questions

### Resolved During Planning

- *Q: Where does pin state live?* → `HoverContext` (key decision above).
- *Q: How is "empty space" defined for R11?* → Inline `closest('[data-path]')` walk in the document handler, plus exclusions for the panel and any element inside `AgentOverlay`.
- *Q: How is R1's mid-line guarantee enforced?* → Pinned `leading-[14px]` + JS-computed `floor(availH / 14)` line clamp passed as inline style.
- *Q: How does scroll reset coexist with the no-flash R10?* → `useEffect`-driven `scrollTop = 0`; never use `key={file.path}`.
- *Q: How does the document handler avoid being defeated by React's synthetic event ordering?* → Mount-once pattern with ref-based gating, plus `closest('[data-path]')` as the positive safelist for tiles.
- *Q: Does the pinned panel re-anchor on viewport resize?* → Yes — re-clamp `pinnedPos` and re-read tile rect via `TileRegistry`.

### Deferred to Implementation

- Exact ring-border color/width (R12). Pick during implementation by trying 1-2 Tailwind utility combinations against the existing palette (`zinc-400/600`, `emerald-500`, `sky-500`).
- Close (X) button styling — icon glyph (`×` vs `✕` vs an SVG), size, hover state. Always-visible at top-right is the placement decision.
- Whether to bump `HOVER_PANEL.HARD_MAX_H = 600` to a viewport-derived value once we see how full descriptions render. Default for this work: leave as 600.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
HoverContextValue {
  // existing
  hoveredPath: string | null
  inputs: Set<string>
  outputs: Set<string>
  setHover(path, pos?)
  // new
  pinnedPath: string | null
  pinnedPos:  { x, y } | null
  setPinned(path, pos?)   // null clears
}

Visualizer
├─ useState pinnedPath, pinnedPos                       (lives in context provider value)
├─ useRef panelHoveredRef = false                       (no-render flag)
├─ useRef pinnedPathRef = pinnedPath                    (kept in sync via useEffect)
├─ useEffect mount-once: window.addEventListener('keydown') -> if 'Escape' setPinned(null)
├─ useEffect mount-once: window.addEventListener('pointerdown' + 'click') -> distance guard + closest('[data-path]') / data-hover-panel / agent-overlay walk
├─ useEffect on (pinnedPath, filesByPath) -> if !filesByPath.has(pinnedPath) setPinned(null)
├─ useEffect on (resize): recompute pinnedPos from TileRegistry.get(pinnedPath).getBoundingClientRect()
├─ inputs/outputs/file = useMemo derive from activePath = pinnedPath ?? hoveredPath
└─ <HoverPanel
     file = filesByPath.get(activePath)
     pos  = pinnedPath ? pinnedPos : mousePos
     pinned = pinnedPath !== null
     onClose = () => setPinned(null)
     panelHoveredRef = panelHoveredRef
   />

TreemapNode / FileTile
├─ onClick(e) -> setPinned(node.path === pinnedPath ? null : node.path, {x,y})
├─ onMouseEnter / onMouseMove -> setHover(node.path, pos)  (no-op effect when pinnedPath, since derive uses pinned ?? hovered)
├─ onMouseLeave(e) -> if !pinned && !panelHoveredRef.current && !relatedTarget?.closest('[data-hover-panel]') -> setHover(null)
├─ className: pinned ? "tile-pinned" : existing hover/input/output/dim
└─ description: <p style={{ display:'-webkit-box', WebkitBoxOrient:'vertical', WebkitLineClamp: lines, overflow:'hidden' }} className="leading-[14px]" >

HoverPanel  (data-hover-panel attribute on root)
├─ clamp left + top into viewport (existing horizontal logic + new vertical)
├─ remove pointer-events-none
├─ scrollRef ref on inner content; useEffect resets scrollTop on file.path change
├─ onMouseEnter/Leave toggle panelHoveredRef.current (no React state)
├─ if pinned -> render close (X) button (always visible, top-right)
└─ early-return guard updated: `if (!file || (!mousePos && !pinnedPos)) return null`

AgentIcon
└─ remove `pointer-events-auto` from root <div>'s className
```

## Implementation Units

- [ ] **Unit 1: Tile description measure-then-clamp**

**Goal:** Make tile descriptions never clip mid-line. Compute the maximum number of full lines that fit and clamp with `…`. Hide entirely when zero lines fit.

**Requirements:** R1, R2, R3.

**Dependencies:** None.

**Files:**
- Modify: `lib/constants.ts` — add `DESCRIPTION_LINE_HEIGHT` (14, px) and `FILE_TILE_HEADER_HEIGHT` (~24, px — measure to confirm in DevTools) under `TREEMAP`.
- Modify: `components/TreemapNode.tsx` (the `FileTile` function) — switch the description's leading from `leading-snug` to `leading-[14px]` (so line-height matches the constant exactly), compute `lines` from the tile's pixel height, render the description with inline style for `WebkitLineClamp` + `display: -webkit-box` + `WebkitBoxOrient: vertical`, and skip the `<p>` when `lines < 1`.

**Approach:**
- Add `DESCRIPTION_LINE_HEIGHT = 14` and `FILE_TILE_HEADER_HEIGHT = 24` to `TREEMAP` in `lib/constants.ts`. Verify the header height in DevTools (it's `text-[11px]` + `py-1` + `border-b 1px`); adjust the constant if measurement differs.
- In `FileTile`: change the description's class to include `leading-[14px]` (drop `leading-snug`). This pins line-height to exactly 14px, making `floor(h / 14)` precise.
- Compute available space:
  ```ts
  const paddingY = 6;  // matches Tailwind py-1.5
  const availableH = h - FILE_TILE_HEADER_HEIGHT - 2 * paddingY;
  const lines = Math.floor(availableH / DESCRIPTION_LINE_HEIGHT);
  ```
- Replace the current `showDescription = h >= DESC_MIN_HEIGHT && node.description` with `lines >= 1 && node.description`.
- Inline style on the `<p>`:
  ```ts
  style={{
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: lines,
    overflow: 'hidden',
  }}
  ```
- The existing `DESC_MIN_HEIGHT` constant is now redundant — leave it for the same commit and remove in a tiny follow-up if cruft.

**Patterns to follow:**
- The `<header>` already uses Tailwind's `truncate` for single-line ellipsis (R3). Don't touch it.
- `lib/constants.ts` already groups numeric constants under named exports — add to `TREEMAP`.
- HoverPanel.tsx is implicitly a client component (rendered from `Visualizer`, which has `"use client"`); no `"use client"` directive needs to be added to TreemapNode just for the new inline style, but adding one isn't harmful.
- Tailwind v4 ships built-in `line-clamp-N` utilities, but they take static integers — they can't be `line-clamp-{lines}` because Tailwind can't safelist arbitrary numbers. Inline `WebkitLineClamp` style is the correct mechanism for a per-tile dynamic clamp.

**Test scenarios:** *(manual browser verification — no test runner)*
- **Happy path** — Open the visualizer; pick a tile with a description longer than ~3 lines (e.g., `lib/scan/imports.ts`, or any other tile with a long JSDoc header). Verify the description is either fully visible OR ends with `…` on the last line. No half-cut lines anywhere.
- **Edge case** — Find a tile so short only the filename shows. Verify no `<p>` is rendered (DOM inspection). No partial-line residue.
- **Edge case** — Find a tile that fits exactly N lines. Verify N lines are visible without ellipsis (no spurious `…`).
- **Edge case** — Resize the browser window to make tiles smaller. Tiles re-render; the line-clamp re-computes; same guarantee holds.
- **Edge case** — File with no description (markdown / lockfile / dotfile) — header-only tile, no errors.

**Verification:**
- Walking around the treemap at the default and a smaller window size, every tile that shows description text shows full lines or full lines ending in `…`. No half-cut lines exist.

---

- [ ] **Unit 2: Hover panel — pointer-interactive, viewport clamping, useEffect scroll reset**

**Goal:** Make the hover panel scrollable by the user (mouse wheel, scrollbar drag) and ensure it never overflows the viewport on any axis. On hover/file change, reset scroll to top so the description is visible by default — but never via remount, to preserve R10's no-flash promise.

**Requirements:** R4, R5, R6, plus the viewport-clamp shared with R7.

**Dependencies:** Unit 1 is independent — can ship in any order. Unit 5 (pin) reuses this clamping math; Unit 2 must precede Unit 5.

**Files:**
- Modify: `components/HoverPanel.tsx` — drop `pointer-events-none`, extend vertical positioning to clamp into the viewport, use `effectiveOffset = pinned ? CURSOR_OFFSET : 0` so the panel touches the cursor in hover mode, add a `data-hover-panel` attribute on the root, add a ref-driven `useEffect` to reset `scrollTop` on file change. Update the early-return guard to `if (!file || (!mousePos && !pinnedPos)) return null` (the `pinnedPos` parameter is wired in Unit 5 — for now, accept either, leaving room for the new prop).

**Approach:**
- Remove `pointer-events-none` from the panel's outer `<div>` className.
- Today's positioning logic flips horizontally near the right edge. Add a vertical analog: compute `top` from the click/cursor coords, then `top = Math.max(VIEWPORT_PADDING, Math.min(top, winH - VIEWPORT_PADDING - estimatedHeight))`. Reuse the existing `flipUp` machinery for the bottom-flip case where flipping above the cursor produces a better fit.
- Single scrolling region: the existing `overflow-y-auto` on the outer `<div>` is correct.
- Add `data-hover-panel` (boolean attribute) on the panel's root for the document handler and tile mouseleave to identify it via `closest()`.
- Scroll reset:
  ```ts
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo(0, 0);
  }, [file?.path]);
  // attach scrollRef to the inner div with overflow-y-auto
  ```
- **Do NOT use `key={file.path}` on the inner div.** A keyed remount destroys the DOM element on every file change, causing visible flicker and breaking R10. The `useEffect` pattern preserves element identity.

**Patterns to follow:**
- Existing horizontal edge-flip in `HoverPanel.tsx` is the template for the vertical clamp.
- `VIEWPORT_PADDING` and `MIN_BELOW_BEFORE_FLIP` constants in `lib/constants.ts:HOVER_PANEL` already establish the geometry pattern.

**Test scenarios:** *(manual browser verification)*
- **Happy path** — Hover any tile. Panel appears at cursor; mouse-wheel inside the panel scrolls the panel content (not the page). Text inside is selectable.
- **Edge case** — Hover near right edge — flips left (existing behavior, no regression).
- **Edge case** — Hover near bottom edge — flips above the cursor, fits within viewport.
- **Edge case** — Hover near top with a tall panel — clamps to viewport top with `VIEWPORT_PADDING`.
- **Edge case** — Switch hover from a short-description file to a long-description file rapidly. Panel does NOT remount (DOM node identity preserved); `scrollTop` resets to 0 each time.
- **Edge case** — File with very long description AND many imports. Panel hits its max height; content scrolls inside.

**Verification:**
- Panel is wheel-scrollable, never overflows viewport, opens at scrollTop=0 on first display, and the same DOM node is reused across hover changes (verify in React DevTools).

---

- [ ] **Unit 3: Cross-element hover survival**

**Goal:** Allow the cursor to move from a tile onto the panel without dismissing it.

**Requirements:** R6a.

**Dependencies:** Unit 2 (panel must be pointer-interactive and have `data-hover-panel`).

**Files:**
- Modify: `components/Visualizer.tsx` — add `panelHoveredRef = useRef(false)`; pass it as a prop to `HoverPanel`.
- Modify: `components/HoverPanel.tsx` — accept `panelHoveredRef` prop; `onMouseEnter={() => panelHoveredRef.current = true}` / `onMouseLeave` toggling the ref.
- Modify: `components/TreemapNode.tsx` — in `FileTile`'s `onMouseLeave`, also accept `panelHoveredRef` (plumbed via context or prop). Use a `relatedTarget?.closest('[data-hover-panel]')` check for the primary path and `panelHoveredRef.current` as fallback for `relatedTarget === null` cases.

**Approach:**
- The `panelHoveredRef` is intentionally NOT in context — adding context state would re-render every tile on each panel enter/leave (with hundreds of tiles, that's perceptible stutter). A ref is read imperatively in the leave handler, zero render cost.
- Plumb the ref into the tile via the existing `HoverContext` (add a `panelHoveredRef: MutableRefObject<boolean>` field — refs in context don't cause re-renders) OR pass it through one extra context field that itself doesn't change. Easiest: add a non-reactive escape hatch to `HoverContextValue`:
  ```ts
  type HoverContextValue = {
    ...
    panelHoveredRef: { current: boolean };
  };
  ```
- The tile's `onMouseLeave`:
  ```ts
  onMouseLeave={(e) => {
    if (pinnedPath !== null) return;  // pin overrides hover entirely
    const goingToPanel = (e.relatedTarget as Element | null)?.closest('[data-hover-panel]');
    if (goingToPanel) return;
    if (panelHoveredRef.current) return;  // catches null relatedTarget cases
    setHover(null);
  }}
  ```

**Patterns to follow:**
- Refs through context is a standard React pattern when you need a non-reactive shared value.

**Test scenarios:** *(manual browser verification)*
- **Happy path** — Hover a tile, slowly move cursor onto the panel. Panel stays.
- **Happy path** — Hover panel, scroll inside. Panel stays.
- **Happy path** — Cursor from panel back onto same tile, then to a different tile. Panel updates correctly.
- **Edge case** — Cursor from panel to truly empty space (off the visualizer entirely). Panel dismisses.
- **Edge case** — Move cursor very fast off the tile to outside the window. `relatedTarget` may be `null`; the `panelHoveredRef` fallback keeps the panel visible if the cursor is over the panel, otherwise dismisses.
- **Cross-browser** — Test rapid mouse movement between tile and panel in Chrome, Firefox, Safari. Verify hover doesn't drop unexpectedly.

**Verification:**
- Cursor moves between any tile and the panel without dismissing the panel.

---

- [ ] **Unit 4: Pin state in HoverContext + import-graph derivation + visible probe**

**Goal:** Add the in-memory state machine for pin: a single source of truth in context, with `Visualizer`'s `inputs`/`outputs` derivation switched to use the pinned file when one exists. Includes the auto-clear effect for missing files. Includes a visible probe (a small `data-pinned` indicator) so the implementer can verify wiring without React DevTools — removed in Unit 5 once the click handler exists.

**Requirements:** R8 (the import-graph freezing portion). Foundation for R7, R9, R10. R12 (ring border, also lands here since it only depends on `pinnedPath`).

**Dependencies:** None.

**Files:**
- Modify: `components/HoverContext.tsx` — add `pinnedPath: string | null`, `pinnedPos: {x:number,y:number} | null`, `setPinned(path, pos?)`, and the non-reactive `panelHoveredRef` field.
- Modify: `components/Visualizer.tsx` — add `useState` for `pinnedPath` and `pinnedPos`; build `setPinned` callback; update `useMemo` for `inputs`/`outputs`/`file` to read `activePath = pinnedPath ?? hoveredPath`; add a `useEffect((pinnedPath, filesByPath) => { if (pinnedPath && !filesByPath.has(pinnedPath)) setPinned(null) })`. Pass new fields through `hoverValue`.
- Modify: `components/TreemapNode.tsx` — `FileTile` reads `pinnedPath` from `useHover()` and adds a `tile-pinned` className when `pinnedPath === node.path`.
- Modify: `app/globals.css` (or wherever `tile-hovered`/`tile-input`/`tile-output`/`tile-dim` are defined — find via grep) — add `.tile-pinned { outline: 2px solid var(--tw-color-sky-500); outline-offset: -2px; }` (or the Tailwind utility equivalent applied via class). Use `outline`, NOT `ring`, because the tile has `overflow-hidden` which clips `box-shadow`-based rings.

**Approach:**
- `HoverContextValue` becomes:
  ```ts
  type HoverContextValue = {
    hoveredPath: string | null;
    pinnedPath: string | null;
    pinnedPos: { x: number; y: number } | null;
    inputs: Set<string>;
    outputs: Set<string>;
    setHover: (path: string | null, pos?: Point) => void;
    setPinned: (path: string | null, pos?: Point) => void;
    panelHoveredRef: { current: boolean };
  };
  ```
- `Visualizer` derives the active file once: `const activePath = pinnedPath ?? hoveredPath`. The existing `useMemo` for `inputs/outputs/hoveredFile` keys on this single derived value (not on the two raw paths) so a re-pin can't flicker through an empty-set frame.
- Auto-clear effect:
  ```ts
  useEffect(() => {
    if (pinnedPath && !filesByPath.has(pinnedPath)) setPinned(null);
  }, [pinnedPath, filesByPath]);
  ```
- Visible-probe (temporary, removed in Unit 5): in `Visualizer`, render `{pinnedPath && <div className="fixed top-2 left-2 z-50 rounded bg-sky-500 px-2 py-1 text-[11px] text-white">PINNED: {pinnedPath}</div>}`. Lets the amateur implementer see pin state without React DevTools while wiring is live.
- Tile className adds `tile-pinned` when `pinnedPath === node.path`. Pinned takes precedence over hover/input/output/dim states.
- `tile-pinned` style in CSS: `outline: 2px solid <accent>; outline-offset: -2px` so the outline draws inside the tile boundary and isn't clipped by the directory border or sibling tiles.

**Patterns to follow:**
- Existing `useMemo` in `Visualizer.tsx` for derived state.
- Existing context shape in `HoverContext.tsx` — keep the same provider/hook style.
- Existing `tile-hovered`/`tile-input`/`tile-output`/`tile-dim` CSS classes show the tile-state pattern.

**Test scenarios:** *(manual browser verification)*
- **Happy path** — No regressions in hover. Hovering tiles still highlights inputs/outputs/dim/unrelated correctly.
- **Visible probe** — In React DevTools (or via the temporary indicator above), set `pinnedPath = 'lib/scan.ts'`. Verify (1) the visible probe shows the path, (2) `inputs`/`outputs` switch to that file's import graph and STAY THERE while the cursor moves around, (3) `lib/scan.ts`'s tile shows the ring outline.
- **Auto-clear** — Set `pinnedPath` to a path that doesn't exist (e.g., 'no-such-file.ts'). Verify it clears within one render via the auto-clear effect.
- Then `setPinned(null)` and verify hover behavior fully resumes and the ring goes away.

**Verification:**
- `pinnedPath` and `setPinned` exist in context. Hover behavior unchanged when `pinnedPath === null`. Setting `pinnedPath` programmatically: freezes the highlight, paints the ring on the pinned tile, and shows the visible probe. Auto-clears when target doesn't exist.

---

- [ ] **Unit 5: Click-to-pin gestures and dismiss (R7, R9, R10, R11, R13)**

**Goal:** Wire user-facing pin behavior: click a tile to pin, click same tile to unpin, click different tile to re-pin, click outside or press Esc to unpin, close (X) button on the pinned panel as another dismiss affordance. Includes viewport-resize re-anchoring. Removes the temporary visible-probe from Unit 4.

**Requirements:** R7, R9, R10, R11, R13.

**Dependencies:** Unit 2 (panel clamping + interactivity), Unit 4 (state plumbing + tile-pinned ring).

**Files:**
- Modify: `components/TreemapNode.tsx` — `FileTile` gains an `onClick` handler.
- Modify: `components/Visualizer.tsx` — document-level `keydown` (Esc) and `pointerdown`/`click` listeners with mount-once + ref-based gating + pointer-distance guard. Resize-listener for re-anchoring. Pass `pinnedPos` and `pinned` and `onClose` into `<HoverPanel>`. Remove the temporary visible-probe from Unit 4.
- Modify: `components/HoverPanel.tsx` — accept `pinned: boolean` and `onClose` props. When pinned, render a close (X) button (always visible, top-right). When pinned, position from `pinnedPos`; when not, position from `mousePos`.

**Approach:**

Tile click handler:
```ts
onClick={(e) => {
  // No e.stopPropagation() here — relying on closest('[data-path]') in
  // the document handler instead. (stopPropagation wouldn't stop the
  // window-level listener anyway.)
  const isCurrentlyPinned = pinnedPath === node.path;
  setPinned(isCurrentlyPinned ? null : node.path, { x: e.clientX, y: e.clientY });
}}
```

Mount-once handlers in `Visualizer`:
```ts
const pinnedPathRef = useRef(pinnedPath);
useEffect(() => { pinnedPathRef.current = pinnedPath; }, [pinnedPath]);

useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && pinnedPathRef.current !== null) setPinned(null);
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, [setPinned]);

useEffect(() => {
  let downPos: { x: number; y: number } | null = null;
  const onDown = (e: PointerEvent) => { downPos = { x: e.clientX, y: e.clientY }; };
  const onClick = (e: MouseEvent) => {
    if (pinnedPathRef.current === null) return;
    if (downPos && Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 4) return;  // drag/scroll-release guard
    const target = e.target as Element;
    if (target.closest('[data-path]')) return;       // tile (its own onClick already ran)
    if (target.closest('[data-hover-panel]')) return; // panel
    if (target.closest('[data-agent-overlay]')) return; // any descendant of AgentOverlay's container
    setPinned(null);
  };
  window.addEventListener('pointerdown', onDown);
  window.addEventListener('click', onClick);
  return () => {
    window.removeEventListener('pointerdown', onDown);
    window.removeEventListener('click', onClick);
  };
}, [setPinned]);
```

Note: `AgentOverlay`'s root `<div>` should also gain a `data-agent-overlay` attribute (or use its existing `pointer-events-none` to verify clicks never originate from it post-Unit-6). Since AgentIcon clicks pass through after Unit 6, the only way a click can target an agent element is if there's an interactive child (none today); the `[data-agent-overlay]` check is defensive.

Resize re-anchor effect:
```ts
useEffect(() => {
  if (!pinnedPath) return;
  const onResize = () => {
    const tileEl = registry.get(pinnedPath);
    if (!tileEl) return;  // auto-clear effect handles deletion
    const rect = tileEl.getBoundingClientRect();
    setPinned(pinnedPath, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  };
  window.addEventListener('resize', onResize);
  return () => window.removeEventListener('resize', onResize);
}, [pinnedPath, setPinned]);
```

Close button: small `<button>` in the top-right of `HoverPanel`'s root, rendered only when `pinned`. `aria-label="Close panel"`. Tailwind: `absolute top-1 right-1 text-zinc-400 hover:text-zinc-700 text-base leading-none`. Click calls `onClose()`.

Re-pin (R10): tile's onClick swaps `pinnedPath` and `pinnedPos` in one `setPinned` call. The `<HoverPanel>` is the same JSX element across renders, so its DOM node persists; `useEffect`-driven scroll reset (Unit 2) brings the new file's content to scrollTop=0 without remount. No flash.

**Patterns to follow:**
- Existing `useEffect` cleanup-pair pattern in `Visualizer.tsx` (the `ResizeObserver` setup is the canonical example).
- The `data-path` attribute already established for tiles is the lookup hook; `data-hover-panel` and `data-agent-overlay` are added by analogy.

**Test scenarios:** *(manual browser verification)*
- **Happy path R7** — Click a tile. Panel appears at click position, pinned. Mouse moves away — panel stays.
- **Happy path R9** — Click the same tile again. Panel disappears. Hover behavior resumes.
- **Happy path R10** — Click tile A (pinned). Click tile B. Panel swaps to B's contents at B's click position. Same panel DOM node (verify in DevTools); no flash.
- **Happy path R11 / Esc** — Pin a tile. Press `Esc`. Panel unpins. Pin a tile. Click the page background outside any tile/panel/agent (e.g., the gap above the visualizer header). Panel unpins.
- **Happy path R13** — Pin a tile. Click the close (X) button. Panel unpins.
- **Edge case** — Click on the panel itself while pinned (e.g., click on a path in the Imports list). Panel does NOT unpin.
- **Edge case** — Pin tile A, hover tile B. Tile B's tile-coloring does NOT change — import-graph highlight stays frozen on A.
- **Edge case** — Pin a tile, scroll the panel with the mouse wheel. Pin stays.
- **Edge case** — Pin a tile, then trackpad-scroll the page. The `pointerdown`-to-`click` distance guard rejects the scroll-release synthetic click; pin stays.
- **Edge case** — Pin near right edge / bottom edge / corner. Panel clamps into viewport (Unit 2 logic).
- **Edge case (re-anchor)** — Pin a tile, then resize the browser window. Panel anchors to the tile's new position via `TileRegistry`. If the tile is reflowed off-screen entirely, the panel ends up with the tile's new (potentially partially-visible) rect; if the tile is removed from the tree, the auto-clear effect from Unit 4 kicks in.
- **Edge case (state precision)** — Pin tile A. Click tile A again. Verify (in React DevTools) `pinnedPath` transitions A → null. Click a third time. Verify it transitions null → A.
- **Edge case (StrictMode)** — Run `npm run dev`, which uses Next.js + React StrictMode dev double-mount. Verify Esc/click handlers register exactly once after the double-invoke (the empty-deps useEffect handles it correctly).

**Verification:**
- All gesture types produce correct pin/unpin transitions. Highlight freezes on pinned file. Re-pin doesn't flash. Trackpad scroll doesn't unpin. Resize re-anchors to the tile.

---

- [ ] **Unit 6: Agent-icon click pass-through (R14)**

**Goal:** Make agent icons click-transparent so tile clicks under them pin the underlying tile.

**Requirements:** R14.

**Dependencies:** None — independently shippable (could land before Unit 1 if convenient).

**Files:**
- Modify: `components/AgentIcon.tsx` — remove `pointer-events-auto` from the root `<div>`'s className.
- Modify: `components/AgentOverlay.tsx` — add `data-agent-overlay` attribute to the root `<div>` (defensive marker for the empty-space exclusion check in Unit 5).

**Approach:**
- Verified state of the codebase: `AgentOverlay` container is already `pointer-events-none`; `AgentBubble` is already `pointer-events-none`; `AgentIcon` explicitly opts back in with `pointer-events-auto` on its root `<div>` (line 32). That `pointer-events-auto` is the only thing capturing clicks above tiles.
- The fix: delete the `pointer-events-auto` class from the AgentIcon className. With it gone, the icon's parent (`pointer-events-none` from AgentOverlay) governs again, and clicks pass through to the tile beneath.
- DO NOT add `pointer-events-none` to the icon. Adding both classes to the same element creates a Tailwind conflict resolved by class ordering — fragile. Just remove the `auto`.
- AgentBubble keeps its existing `pointer-events-none` (no change). Bubble clicks were already pass-through; the prior plan's worry that bubbles could swallow clicks was based on a misreading of the codebase.

**Patterns to follow:**
- The codebase already has a layered pointer-events strategy (`pointer-events-none` on the overlay container; opt-in `pointer-events-auto` on interactive children). The fix is to acknowledge that the icon doesn't need to opt back in for the visualizer's purposes.

**Test scenarios:** *(manual browser verification)*
- **Happy path R14** — Start a Claude Code session that uses tools on this repo so an agent icon appears on the visualizer. Move cursor over the icon. Click directly on the icon. The underlying tile pins (ring border appears, panel opens at the click point).
- **Edge case** — Click on the agent's bubble (the text). Click passes through to the tile beneath; tile pins. (Bubble was already `pointer-events-none`.)
- **Edge case** — Pin a tile that has an agent icon visually overlapping. The ring border on the tile is visible (z-index check — agent overlay is `z-50`, tile ring is rendered as `outline` on the tile element which is below the overlay; the ring should still paint inside the tile boundary thanks to `outline-offset: -2px`).

**Verification:**
- Clicks on agent icons land on the tile beneath, triggering pin behavior.

---

## System-Wide Impact

- **Interaction graph:** New document-level `keydown` (Escape), `pointerdown`, and `click` (empty-space) listeners on `window`. Mounted once at `Visualizer` mount with empty deps. Cleanup in `useEffect` return.
- **Error propagation:** No new failure modes — all changes are local UI state. No async, no fetches.
- **State lifecycle risks:** Pin state survives SSE-driven re-renders (it's in `HoverContext` and keyed by file path, not DOM). Pin auto-clears when its target file disappears from `filesByPath` (e.g., HMR scan re-run, file deletion). Resize re-anchors the panel to the tile's current rect via `TileRegistry`.
- **API surface parity:** No external API changes. `HoverContextValue` is internal — only consumed by components in `components/`.
- **Integration coverage:** Cross-layer behavior to verify manually:
  - Agent activity continues to work normally while a tile is pinned (icons still move, bubbles still update).
  - The treemap reflows on viewport resize without stranding the pinned panel.
  - Pinning a file then triggering a Claude Code agent that reads/writes that file: agent overlay still renders, pin state survives.
- **Unchanged invariants:** Existing hover behavior, tile-coloring rules, agent overlay positioning, treemap layout math (`squarify`), scanner output — none of these change. Behavioral changes: (1) tile description rendering, (2) panel pointer-events + scroll-reset, (3) pin layer, (4) AgentIcon pointer-events.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `DESCRIPTION_LINE_HEIGHT` and the actual rendered line-height drift apart silently. | Pinning the description's leading to `leading-[14px]` makes line-height deterministic; the constant matches the class. Any future change to one must change the other in the same commit. |
| Document-level click handler interferes with future clickable UI (e.g., a header button). | Handler only fires `setPinned(null)` and only runs when `pinnedPath !== null`. Doesn't `stopPropagation` (which wouldn't help anyway for window-level listeners). The `closest('[data-path]')` / `[data-hover-panel]` / `[data-agent-overlay]` exclusions are positive safelists. New clickable UI just needs its own `data-*` marker (and an entry in the safelist) if it should not unpin. |
| `relatedTarget` is `null` on rapid mouseouts in some browsers. | `panelHoveredRef.current` fallback in the tile's `onMouseLeave` handles it. |
| Pin lost during full Visualizer re-mount (HMR during dev). | Acceptable for dev; in prod no full remounts are expected. If it becomes annoying, persist to `sessionStorage` (deferred). |
| Tailwind v4 `outline` utility resolves differently than expected on the pinned tile. | Easy to verify in DevTools; if the outline looks off, switch to a `style={{ outline: ... }}` inline override on the tile. |
| Pointer-distance guard rejects a real click that happens to involve a few pixels of mouse movement (precise mice can wobble). | 4px threshold matches browser native click-drag detection; if false-rejects appear, raise to 6px. |

## Documentation / Operational Notes

- Update `CLAUDE.md`'s "Current snapshot" → `components/` description to mention `HoverContext` extension and click-to-pin once landed. Existing prose for `Visualizer.tsx` and `HoverPanel.tsx` will need a touch-up for the new behaviors.
- No migrations. No env vars. No CI changes. Local-only feature.
- Verify on the dev server (`npm run dev`) before declaring done.

## Sources & References

- **Origin document:** `docs/brainstorms/visualizer-text-and-pin-requirements.md`
- Related code:
  - `components/TreemapNode.tsx` (`FileTile`)
  - `components/HoverPanel.tsx`
  - `components/HoverContext.tsx`
  - `components/Visualizer.tsx`
  - `components/TileRegistry.tsx`
  - `components/AgentIcon.tsx`, `components/AgentOverlay.tsx`, `components/AgentBubble.tsx`
  - `lib/constants.ts` (`TREEMAP`, `HOVER_PANEL`)
- Related PRs/issues: none.
- External docs: none.
