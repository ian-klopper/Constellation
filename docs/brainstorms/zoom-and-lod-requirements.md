---
date: 2026-05-01
topic: zoom-and-lod
---

# Treemap zoom and Level-of-Detail (LOD)

## Problem Frame

The visualizer renders the codebase as a single static squarified treemap that fills the viewport. On Constellation itself (~80 files) that works fine — every file is a readable rectangle. With the v1 onboarding flow now pointing the visualizer at sibling repos, the typical target is much larger. On the user's Parsley codebase, fit-to-viewport leaves individual files smaller than the existing 8 px `MIN_RENDER` cull, so most tiles are dropped and the user sees mostly directory-colored void with a handful of the largest files.

There is no current way to focus on a region — growing the browser window only buys back a few pixels. We need a navigation primitive (zoom + pan) that progressively reveals smaller files as the user focuses in, and hides them again as they pull back.

```
  fit (zoom = 1×)              zoom = 2× toward cursor
  ┌───────────────────┐        ┌───────────────────┐
  │ src/   ▮ ▮         │        │ src/    ▮ ▮ ▯ ▯  │
  │  (most files       │   →    │   ▮  ▮ ▯ ▯ ▯ ▯ ▯ │
  │   culled,           │        │   ▮▯▯▯▯▯▯▯▯▯▯▯  │
  │   directory bg)     │        │   ▯▯▯▯▯▯▯▯▯▯▯▯  │
  └───────────────────┘        └───────────────────┘
   only big tiles render        smaller tiles emerge
```

## Requirements

**Zoom navigation (R1–R5)**

- **R1.** Mouse scroll wheel over the treemap zooms toward the cursor. Each detent is a smooth multiplicative step. The world point under the cursor stays fixed on screen — i.e., zoom is cursor-anchored, not viewport-center-anchored.
- **R2.** Click-drag in empty space pans the canvas. "Empty space" = a mousedown not on a registered tile / hover panel / agent overlay (the same positive-safelist used by `PinController` today). Click-drag that starts on a tile remains the existing pin gesture; the tile-pin vs. pan disambiguation reuses the existing 4-px pointer-distance guard.
- **R3.** Zoom is bounded. Minimum zoom = "fit to viewport" (the layout fills the available canvas exactly, no smaller). Maximum zoom is bounded by a soft cap so the user cannot zoom infinitely into pixels.
- **R4.** Pan is bounded. The user cannot pan such that the layout leaves the viewport entirely; at least some portion of the canvas is always visible.
- **R5.** A keyboard shortcut resets zoom + pan to fit-to-viewport.

**Level-of-Detail (R6–R9)**

- **R6.** A tile is rendered only if its **rendered** size (layout px × current zoom) clears a minimum threshold in both width and height. Tiles below threshold are not rendered, and their layout area is left to their parent directory's tile, which fills it with its own background color (no synthetic "+N hidden" placeholder).
- **R7.** Zooming in promotes previously-culled tiles into rendered ones the moment their rendered size crosses the threshold. Zooming out demotes them back. The transition is per-tile and discrete (a tile either renders or it doesn't), driven entirely by the threshold check.
- **R8.** A tile's filename and description continue to gate on rendered vertical space, so the existing per-tile line-clamp math (`floor(availableHeight / DESCRIPTION_LINE_HEIGHT)`) keeps working under zoom — text becomes more legible, and more description lines fit, as the user zooms in.
- **R9.** The squarified layout is computed once per viewport size, not once per zoom step. Zoom is a visual transformation; tile positions and sizes in layout-space do not change as the user zooms.

**Overlay and panel anchoring (R10–R13)**

- **R10.** Agent overlay icons stay at a fixed screen size at all zoom levels. Their anchor on screen tracks the underlying tile's post-transform screen position and re-anchors on every zoom/pan change.
- **R11.** The hover panel continues to anchor to either the cursor (hover mode) or the pinned tile's screen rect (pin mode), and stays correctly positioned through zoom and pan. The pinned-mode anchor recomputes from the tile's `getBoundingClientRect()` on every zoom/pan change — not from cached click coordinates — so the panel slides with its tile instead of staying frozen at the original click position.
- **R12.** Pin state survives zoom and pan operations — pinning a tile and then zooming or panning does not unpin.
- **R13.** If a pinned tile is culled by LOD (e.g., user zooms out below its visibility threshold), the pin state is preserved but the hover panel is hidden until the tile renders again. The pinned-tile ring border has no visible effect while the tile is culled, since the tile is not in the DOM. "Culled" is detected by checking whether `pinnedPath` is currently registered in `TileRegistry` — culled tiles never call `useRegisterTile`, so the registry is the authoritative signal.

**State and reflow (R14–R15)**

- **R14.** Zoom + pan state is in-memory only and resets to fit-to-viewport on page reload.
- **R15.** When the viewport resizes (window or container resize), the squarified layout is recomputed against the new size. Current zoom and pan are preserved as numeric values, then re-clamped against the new bounds (so a previously-valid pan position that's now out of bounds snaps back inside).

## Success Criteria

- On a Parsley-scale codebase, the user can zoom in on any region and progressively see smaller files. Navigation is scroll-to-zoom + drag-to-pan, no other UI affordance required.
- At fit-to-viewport zoom (the initial state), the visualizer looks identical to the current behavior — no visible regression on Constellation itself.
- Zoom and pan feel smooth — comparable to scrolling a long web page. No visible re-layout flash on every detent.
- Pinning a tile, then zooming or panning, keeps the pinned panel anchored to that tile through the whole gesture.
- Agent icons stay readable at all zoom levels and remain anchored to the correct tile.

## Scope Boundaries

- Not adding click-to-drill-in or directory-fills-viewport navigation. Pan + zoom is the only navigation primitive.
- Not adding a minimap. The whole-codebase overview is "zoom out to fit."
- Not persisting zoom/pan state across reloads, browser tabs, or sessions.
- Not changing the squarified layout algorithm. Layout still computes once per viewport size; only the `MIN_RENDER` cull becomes zoom-aware.
- Not re-tessellating the layout at higher zoom levels. The set of tile positions stays stable as the user zooms — what changes is which ones render.
- Not adding "stay visible always" overrides for individual tiles (e.g., the pinned tile or agent-occupied tile staying rendered through zoom-out). Cull is purely size-driven.
- Not adding pinch-zoom or two-finger gestures. Mouse-wheel zoom only; trackpad scroll is treated as a wheel event.
- Not adding scroll-wheel modifier semantics (e.g., shift-scroll for horizontal pan). Plain scroll = zoom; nothing else.
- Not redesigning the hover panel or agent overlay. Only their anchoring is updated to handle zoom/pan.
- Not addressing touch-device interaction.

## Key Decisions

- **Visual zoom via CSS transform on a wrapper, not layout recomputation per step.** A `transform: translate(...) scale(...)` on a wrapper around the existing `<TreemapNode>` root scales the whole layout visually. **Why:** GPU-accelerated, smooth at every zoom level, zero per-step re-squarify cost (which on Parsley-scale repos would visibly stutter); squarified layouts are not stable under area changes, so re-tessellating per step would shuffle tiles around and disorient the user.
- **LOD via a zoom-aware extension of the existing `MIN_RENDER` threshold.** The recursion/render gate in `components/TreemapNode.tsx:67-68` becomes a check in *rendered* px (layout × zoom) instead of layout px. **Why:** reuses the cull primitive that already exists; no new concept introduced. The current behavior is exactly the new behavior at zoom = 1.
- **Hidden tiles' area is absorbed silently by the parent directory.** No "+N hidden" placeholder, no aggregated synthetic tile. **Why:** matches the user's "small files hidden inside bigger files" intent, minimizes visual noise, and the directory-colored block already implicitly signals "there's stuff here, zoom in to see it."
- **Mouse model: scroll = zoom toward cursor, click-drag empty space = pan.** Single-button-mouse friendly; cursor-anchored zoom is the standard map-app convention; click-drag pan is discoverable without a tutorial.
- **Click-drag pan vs. tile-click pin uses the existing 4-px pointer-distance guard.** A mousedown that moves >4 px before mouseup is a pan gesture; ≤4 px stays a click (pin). The guard already lives in `PinController` for trackpad scroll-release synthetic clicks — same code path.
- **Agent icons stay screen-size by rendering *outside* the transformed wrapper.** They already use `getBoundingClientRect()` to anchor, which returns post-transform screen coords for free. The only change is broadening the recompute trigger in `useAgentPositions` to fire on zoom/pan changes alongside resize/scroll.
- **Pan clamp: hard clamp at gesture time, leaving at least some of the layout in view.** No rubber-band/elastic edges; predictable and matches the project's preference for boring, well-trodden patterns.
- **Reset behavior: snap to fit (zoom = 1, pan = 0) on the reset shortcut.** Animated easing is a planning-time polish call, not a requirement.

## Dependencies / Assumptions

- Existing files affected:
  - `components/Visualizer.tsx` — owns new `zoom` / `pan` state, attaches wheel and pointerdown handlers, renders the transformed wrapper.
  - `components/TreemapNode.tsx` — `MIN_RENDER` gate switches from layout-px to rendered-px (multiplied by zoom).
  - `lib/constants.ts` — `MIN_RENDER` retained; likely add `ZOOM_MIN`, `ZOOM_MAX`, `ZOOM_STEP` (and possibly `PAN_CLAMP_MARGIN`).
  - `hooks/useAgentPositions.ts` — extend recompute trigger set to include zoom/pan changes (currently fires on registry / agent list / resize / scroll).
  - `components/PinController.tsx` — verify that pin-anchor re-anchoring on viewport changes also fires on zoom/pan; the `data-path` / `data-hover-panel` / `data-agent-overlay` positive-safelist for empty-space detection extends naturally to "is this mousedown a pan or a pin."
  - `components/HoverPanel.tsx` — must render as a **sibling** of the transformed wrapper, not a descendant. Per the CSS Transforms spec, a transformed ancestor becomes the containing block for `position: fixed` descendants, which would cause the panel's `left`/`top` to resolve in scaled-and-translated coords instead of viewport coords. Move the panel out alongside `AgentOverlay`. Pin-mode anchor recomputes per R11.
  - **Squarify result memoization** — `components/TreemapNode.tsx` currently calls `squarify()` inline per render (no memo). R9's "computed once per viewport size" invariant requires memoizing the squarify result against `(tree, viewport size)` so adding zoom/pan state to `Visualizer` does not re-tessellate on every wheel detent. Either lift squarify out of `TreemapNode` into a memo at `Visualizer` level, or wrap the existing inline call in `useMemo`.
- Verified against the codebase:
  - `MIN_RENDER: 8` exists in `lib/constants.ts` and gates recursion in `components/TreemapNode.tsx:67-68`.
  - All tiles use `position: absolute` with px coords from `lib/treemap.ts`'s squarify, so a single CSS transform on a wrapper scales them all uniformly.
  - `useAgentPositions` already subscribes to registry / agent-list / resize / scroll for re-anchoring; adding zoom/pan triggers is an extension, not a rewrite.
  - No zoom/pan state exists anywhere today — net new.
- Unverified assumption: on Parsley-scale repos (thousands of `position: absolute` tile elements under one transformed wrapper), the GPU transform path stays smooth across the full zoom range. Worth measuring during planning before committing to the CSS-transform approach as final.

## Outstanding Questions

### Resolve Before Planning

*(none — proceed to planning)*

### Deferred to Planning

- [Affects R3] Exact `ZOOM_MAX` value — soft cap (8× / 16× / higher). Pick during planning by feel; should be raisable later.
- [Affects R5] Specific reset key binding — `0`, `f`, both, or something else. Trivial detail; pick during planning.
- [Affects R6][Technical] Whether to introduce a *second*, higher threshold for showing tile **content** (filename + description) separate from rendering the tile at all — i.e., render an empty colored block at low rendered size, fill in label/description above a higher rendered size. Current behavior (single threshold + line-clamp gating on rendered height) may be sufficient. Evaluate once R8 is implemented and visible.
- [Affects R8][Needs research] Whether the per-tile line-clamp computed in layout-px is "correct enough" under CSS transform (the text scales with zoom, so MORE characters fit on a line at higher zoom but the **count** of lines clamped is unchanged). MVP behavior is acceptable; planning to decide whether to make line-count zoom-aware so zooming in shows literally more description content, not just bigger text.
- [Affects R10][Technical] Implementation mechanism for invalidating agent and panel anchors on every zoom/pan change without thrashing — probably a single rAF-throttled subscription from the Visualizer's zoom/pan state. Planning to design.
- [Affects R4] Exact pan clamp distance and whether the clamp engages during the gesture or only at gesture-end. Start with engage-during-gesture.
- [Affects R5] Whether the reset is animated (eased ~150 ms) or instant. Polish, not a requirement.

## Next Steps

`-> /ce:plan` for structured implementation planning.
