---
title: Description truncation and tile line-clamp math both broke at the premise level
date: 2026-04-30
category: ui-bugs
module: visualizer/scanner-and-treemap-tiles
problem_type: ui_bug
component: tooling
severity: medium
symptoms:
  - "Tiles with ample vertical space ended in '…' mid-sentence (scanner-injected truncation, not visual line-clamp)"
  - "Hover panel never displayed full descriptions despite scrolling and ample height; plan requirement R4 was unsatisfiable"
  - "At specific tile heights, a 2px sliver of an extra clamped line was visible below the ellipsis because border-box borders weren't subtracted"
root_cause: logic_error
resolution_type: code_fix
tags:
  - line-clamp
  - box-model
  - border-box
  - content-shaping
  - description-truncation
  - treemap
  - premise-level-bug
  - code-review-blind-spot
---

# Description truncation and tile line-clamp math both broke at the premise level

## Problem

Two user-visible layout bugs survived a 9-reviewer `/ce:review` pass on the visualizer tile description + click-to-pin feature. Bug 1: the file scanner pre-truncated every description at 240 chars before any renderer saw it, so tiles with vertical room to spare showed a scanner-injected ellipsis with empty space below, and the hover panel — which is supposed to show the full description — received the same amputated string. Bug 2: the line-clamp math that decides how many lines fit in a tile forgot that `border-box` sizing means the squarify-supplied height includes the article's 1px top and 1px bottom borders, so at certain tile heights `floor()` over-counted by one and a 2px sliver of the next line bled through `overflow: hidden` beneath the ellipsis.

## Symptoms

- Tiles with 70–80% vertical space empty still ended in "…" mid-sentence (e.g. `daemon/transcripts.ts` showed "...no concurrent file writes p…" with the rest of the description simply absent from the data).
- Hover panel, which scrolls and has room for unlimited text, also showed the truncated 240-char version — the remainder of the description never reached the client.
- At specific tile heights, a faint 2px fragment of a line was visible below the ellipsis dot, appearing as overflow text bleeding through the container.

## What Didn't Work

- **9-reviewer `/ce:review`** (correctness, kieran-typescript, julik-frontend-races, adversarial, and five others) caught 13 real issues but missed both bugs. Reviewers checked the line-clamp implementation against the plan; neither the plan nor the implementation flagged that the description data was already truncated before it reached any renderer. Reviewers reading code cannot see a 2px sliver of overflow.
- **The brainstorm session that produced the requirements doc** (session history) diagnosed the visible truncation as a pure render-side problem — "a plain `<p>` with no `line-clamp`" on the tile, "pushed below the fold" on the panel. The scanner-side `clamp()` was never on the radar. Every downstream artifact (requirements doc, plan, implementation, review) inherited that wrong premise.
- **CLAUDE.md itself documented "truncates at ~240 chars" as expected behavior** (session history). The clamp had been introduced earlier in the full-overhaul refactor (commit `08ecd80` — "Decompose scanProject into pure phases") and the project doc had codified it. Reviewers treated the cap as spec-compliant because the spec said so. The spec was the bug.
- **Commit `e3f4b03`** ("Fix tile description ellipsis and hover-panel path truncation") pinned the header height via inline style and replaced `truncate` with `break-all` on path lists — both correct improvements, but neither addressed the two actual root causes. It was a surface-level diagnosis the user caught with screenshots.

## Solution

**Bug 1 — remove the scan-time cap in `lib/scan/descriptions.ts`**

```ts
// Before:
const DESCRIPTION_MAX_LEN = 240;
function clamp(s: string): string | undefined {
  if (!s) return undefined;
  return s.length > DESCRIPTION_MAX_LEN
    ? s.slice(0, DESCRIPTION_MAX_LEN - 3).trimEnd() + "…"
    : s;
}
// Used as:
return clamp(body.split(/\s@\w/)[0].trim());

// After:
return nonEmpty(body.split(/\s@\w/)[0].trim());
// where nonEmpty is just: return s ? s : undefined;
```

No length cap at scan time. The tile applies `WebkitLineClamp: lines` at render time; the hover panel's existing `overflow-y: auto` already handles long content.

**Bug 2 — subtract border height in `lib/constants.ts` + `components/TreemapNode.tsx`**

```ts
// Added to lib/constants.ts (TREEMAP object):
ARTICLE_BORDER_Y: 2,  // 1px top + 1px bottom border on <article>

// Updated math in TreemapNode.tsx:
// Before:
const availableH = h - FILE_TILE_HEADER_HEIGHT - DESCRIPTION_PADDING_Y;
// After:
// h is the full article box (border-box), so the borders count against
// the content area.
const availableH =
  h - FILE_TILE_HEADER_HEIGHT - DESCRIPTION_PADDING_Y - ARTICLE_BORDER_Y;
```

Derivation: `total = top-border(1) + header(24) + desc-padding(12) + N×14 + bottom-border(1) ≤ h` → `N ≤ (h − 38) / 14`, not `(h − 36) / 14`.

Both fixes shipped in commit `d846895`.

## Why This Works

**Bug 1** — a shared utility was pre-shaping content for the smallest consumer (a tile's typical height). Every consumer downstream — including the hover panel, which has a totally different vertical envelope — received that already-truncated string. Removing the cap restores the maximal raw form; each consumer applies its own display-time policy. The scan-time value is now a source of truth, not a presentation decision.

**Bug 2** — Tailwind's default is `box-sizing: border-box`. The `border` utilities add visual width/height to the element but subtract from the content area. When pixel math operates against squarify-supplied dimensions (which describe the full box), it must explicitly subtract every border and padding at every level the dimension flows through. Adding `ARTICLE_BORDER_Y` as a named constant makes the ledger visible to future readers; burying `2` in the formula would hide the reason.

Both bugs belong to the same class: an **upstream assumption** (descriptions are pre-truncated; borders don't affect available content height) that was invisible to reviewers because every downstream implementation looked correct *given the assumption*.

## Prevention

- **Keep content-shaping utilities maximal at the source.** A scan-time clamp that looks "short enough for everyone" forecloses divergent presentations. If two consumers have different vertical envelopes, let each clamp at display time — don't make them share a single pre-truncated value.
- **When pixel math interacts with the CSS box model, subtract borders and paddings at every level the dimension flows through.** Name each contribution as a constant (`ARTICLE_BORDER_Y`, `DESCRIPTION_PADDING_Y`) so the arithmetic reads as a ledger, not a magic number.
- **After any `/ce:review` that claims "Ready," run the app visually.** Nine reviewers read code and plans; none of them can see a 2px sliver under an ellipsis or empty space beneath a mid-sentence "…". Manual visual verification on the running surface is irreplaceable for layout bugs.
- **When the user follows up with screenshots after a "Ready" verdict, treat the screenshots as bug reports, not feature requests.** Trace to root cause; don't apply surface-level fixes that address the visual presentation without identifying the data-flow or math error driving it.
- **When a CLAUDE.md / AGENTS.md statement encodes a *spec decision* that downstream code conforms to, audit those statements during planning for any new feature whose requirements might invalidate the decision.** The "truncates at ~240 chars" line in CLAUDE.md was load-bearing for the scanner's behavior; the new R4 requirement (full descriptions in the panel) silently contradicted it, but no one reviewed the contradiction.

## Related Issues

- `docs/plans/2026-04-30-001-feat-visualizer-text-and-pin-plan.md` — original 6-unit feature plan whose R4 requirement ("hover panel always shows the entire description") the scan-time `clamp()` was silently violating. Plan never questioned the existing scanner behavior.
- `docs/brainstorms/visualizer-text-and-pin-requirements.md` — requirements brainstorm that diagnosed the truncation as a render-side-only problem (session history); set the wrong premise the rest of the workflow inherited.
- Commit `08ecd80` — earlier "Decompose scanProject into pure phases" refactor that introduced the `clamp()` helper that caused Bug 1.
- Commit `e3f4b03` — prior misdiagnosis fix (path truncation + header height inline style); correct work, orthogonal to the two bugs documented here.
- Commit `d846895` — the actual fix for both bugs documented here.
- CLAUDE.md "Source layout → File descriptions" needs updating: the line "truncates at ~240 chars" is no longer accurate after `d846895`. Truncation is now display-time only.
