---
title: "LOD slider only culled directory children, not individual tiles"
date: 2026-05-01
category: ui-bugs
module: components/TreemapNode.tsx
problem_type: ui_bug
component: tooling
severity: medium
related_components:
  - components/LodContext.tsx
  - components/Visualizer.tsx
tags:
  - treemap
  - lod
  - render-gate
  - react
  - hook-ordering
  - recursion
  - zoom
symptoms:
  - "LOD slider visibly changed some tiles but small file tiles inside larger directories never disappeared at any slider value"
  - "Once a parent directory's inner rect cleared the threshold, every child rendered unconditionally regardless of its own size"
  - "Slider felt like it 'didn't affect all the boxes' even though the threshold value was reaching the component"
root_cause: logic_error
resolution_type: code_fix
---

# LOD slider only culled directory children, not individual tiles

## Problem

The user-controlled detail slider in Constellation's treemap visualizer was supposed to hide tiles below a configurable pixel floor, but small file tiles tucked inside larger directories never disappeared regardless of slider position. The user reported it as "the LOD setting is working but seems to not be affecting all the boxes."

## Symptoms

- Moving the detail slider all the way toward "less detail" still left tiny tiles visible inside larger directories.
- The slider *did* visibly cull entire directory branches when those branches' inner area dropped below the floor — so the feature looked partially functional, which made the bug easy to miss.
- The behavior was independent of zoom: whether zoomed in or out, the same per-directory pattern held.

## What Didn't Work

The original gate was a *parent-expansion* check inside `components/TreemapNode.tsx` — roughly `inner.w >= minRender && inner.h >= minRender && children.length > 0` — used to decide whether to call `squarify` and recurse. It's an obvious thing to write: "if this directory's interior is too small to bother laying out, collapse the whole subtree." That framing is correct *as an efficiency story* (skip squarify, skip the recursion) but it answers the wrong question for the user. The user's mental model of a "minimum tile size" is per-tile, not per-subtree: any individual rectangle below the floor should disappear, full stop. Once a parent cleared the gate, every child rendered unconditionally — so a 600×400 directory containing thirty 4×4 file tiles still rendered all thirty. The gate was load-bearing for performance but invisible for the user-facing knob.

There was no prior failed-debugging attempt to surface here — the bug was caught through user testing of the freshly-shipped LOD slider, not from a misdirected investigation. (session history)

## Solution

Diff from commit `36f0c59` on `components/TreemapNode.tsx`. Add a per-tile gate at the top of `TreemapNodeImpl`:

```ts
// Per-tile LOD gate. A tile (file *or* directory) below this floor is
// skipped entirely — its area becomes empty space inside its parent.
// The root (depth = 0) is exempt so the visualization is never empty.
const tooSmall =
  depth > 0 &&
  (w * committedZoom < minRender || h * committedZoom < minRender);
```

File branch:

```ts
if (node.kind === "file") {
  if (tooSmall) return null;
  return <FileTile node={node} style={style} h={h} />;
}
```

Children-expansion gate now folds in `tooSmall` so squarify short-circuits:

```ts
const canRender =
  !tooSmall &&
  renderW >= minRender &&
  renderH >= minRender &&
  node.children.length > 0;
```

Directory-branch early return *after* the `useMemo` for `childRects`:

```ts
// Per-tile gate fires *after* useMemo so the hook order stays stable
// for this instance across re-renders (squarify above no-ops via the
// canRender check, so no real work is wasted).
if (tooSmall) return null;
```

## Why This Works

The gate now fires at *every* node in the recursion, not just at the parent's decision to expand. Each `TreemapNode` self-checks its own `w` and `h` (scaled by `committedZoom`, matching the existing zoom-aware gate) and bails when either dimension drops below `minRender`. Three details earn their keep:

- **`depth > 0` exemption.** If the root tile itself fell below the floor, the whole visualization would render as empty space. Exempting depth 0 guarantees at least one tile is always drawn.
- **`tooSmall` folded into `canRender`.** A directory whose own tile clears the floor but whose inner area doesn't still shows just its label. Adding `!tooSmall` here also lets squarify short-circuit on tiles we're about to skip — no wasted layout work on a node that's about to return null.
- **Hook-ordering trap.** The directory branch already calls `useMemo` for `childRects`. React's rules of hooks require the same hooks to run in the same order on every render of a given component instance. Returning `null` *before* `useMemo` on a "too small" frame, then later returning the full tree on a "big enough" frame, would change the hook count between renders and crash. The fix lands the directory-branch early return *after* `useMemo`. The file branch has no `useMemo`, so its early return goes inline before `<FileTile>` — still after every hook for that branch. (session history confirmed this constraint was recognized during implementation, not retrofitted afterward.)

## Prevention

A reviewer should ask:

- *Where exactly does this gate fire — at the parent or per-tile?* For recursive renderers, "the parent decides whether to recurse" culls subtrees but cannot cull individual leaves. A user-facing minimum-size knob almost always wants per-tile semantics. Verify the gate fires at every level of the hierarchy, not just at the recursion entry point.
- *If I'm bailing early in a memo'd component, do my hooks still run in the same order?* Any conditional `return null` in a component that calls `useMemo` / `useState` / `useEffect` must sit *after* all hooks for the branch it lives in. Audit hook ordering whenever you add an early return.
- *Am I culling the symptom (subtree size) or the cause (individual tile size)?* The original gate culled subtrees because that's the natural place to short-circuit `squarify`. The user's complaint was about individual tiles. When efficiency framing and user-facing framing diverge, you usually need both gates — one for work avoidance, one for correctness — exactly as this fix landed.

A practical guardrail: when adding a recursive render gate, write down (in the code or a PR comment) what each level of the gate is responsible for. "Parent gate skips squarify; per-tile gate hides individual tiles" reads back differently from "gate skips children" and forces the author to think about both axes.

## Related Issues

- Peer doc, same component, different bug class: [`docs/solutions/ui-bugs/description-truncation-and-line-clamp-math-2026-04-30.md`](./description-truncation-and-line-clamp-math-2026-04-30.md). Shares the prevention rule "verify visually on the running surface; reviewers can miss visual bugs."
- Origin plan: [`docs/plans/2026-05-01-001-feat-zoom-and-lod-plan.md`](../../plans/2026-05-01-001-feat-zoom-and-lod-plan.md). The plan called for a zoom-aware `MIN_RENDER` cull but implicitly assumed it already gated per-tile; this fix completes that intent.
- Origin requirements: [`docs/brainstorms/zoom-and-lod-requirements.md`](../../brainstorms/zoom-and-lod-requirements.md).
- Earlier feature commit that introduced the zoom-aware gate (which this fix sits on top of): `70683d8 Make MIN_RENDER cull zoom-aware (Unit 6)`. The fix landed as `36f0c59 Apply LOD gate per tile, not just per directory expansion`.
