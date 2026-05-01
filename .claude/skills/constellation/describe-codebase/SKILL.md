---
name: constellation:describe-codebase
description: Walk the current repo and add a 1–2 sentence intent-focused header comment to every file Constellation visualizes that doesn't already have one. Use when the visualizer's tiles are showing as text-blank, or after pulling new files into a Constellation-managed repo. Never overwrites existing headers; leaves all changes unstaged for user review.
---

# describe-codebase

Fill in the leading-comment headers Constellation extracts as tile descriptions. Read each candidate file, write a confident 1–2 sentence intent description, prepend it in the right comment syntax for the file's language. Process one file at a time; do not bulk-rewrite. Leave every change unstaged — the user reviews with `git diff` and commits at their own pace, never `git add`. Never call into Constellation's TypeScript code: this skill must work in repos where Constellation isn't installed.

## File enumeration

Walk the cwd. Skip a file entirely if any of these patterns match (mirrors Constellation's `IGNORE` list in `lib/scan/discover.ts`):

- `node_modules/`, `.next/`, `dist/`, `out/`, `build/`, `.git/`, `.constellation/`, `.claude/worktrees/` anywhere in the path
- `.claude/settings.local.json`, `next-env.d.ts`, `*.tsbuildinfo`, `.DS_Store`
- `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lockb`
- Binary-ish: `*.png`, `*.jpg`, `*.jpeg`, `*.gif`, `*.ico`, `*.svg`, `*.webp`, `*.bmp`, `*.woff`, `*.woff2`, `*.ttf`, `*.eot`, `*.otf`, `*.pdf`, `*.zip`, `*.gz`, `*.tar`, `*.exe`, `*.dmg`

Otherwise consider the file only if its extension is one Constellation extracts headers from: `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.css`, `.scss` (JSDoc); `.sh` (shell `#`); `.md` (first paragraph). Other extensions don't get headers — Constellation shows just the filename.

## Has-header detection

For each candidate, decide whether it already has a header in the matching format. Rules below match `lib/scan/descriptions.ts` byte for byte; do not relax them.

| Extension | Has-matching-header rule |
|---|---|
| `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.css`, `.scss` | File begins (after optional whitespace) with `/**` and contains a `*/` close. |
| `.sh` | After an optional shebang line (`#!...`) and any blank lines, the next non-blank line starts with `#` (and isn't `#!`). |
| `.md` | The file contains at least one non-empty paragraph that does **not** start with `#`. |

If the rule above matches, skip with `kept (existing header)`. If the file has a leading comment in a *non-matching* format (e.g., a `.ts` file starting with `// …`), also skip with `skipped: existing-non-matching-header` — do not convert it. If no leading comment at all, queue for description.

## Generating the description

Read the file (or as much as you need), then write 1–2 sentences focused on **intent** — what the file is for, who calls it, what a future reader needs to know to orient themselves. Do not restate what the code does; the code does that itself.

- **Bad:** "Exports a function called `add` that takes two numbers and returns their sum." / "Utility module."
- **Good:** "Cursor-anchored floating panel that shows the active tile's description, exports, and import lists. Pin-mode keeps it visible after the cursor leaves; hover-mode follows the pointer."

If after reading the file you genuinely cannot tell what its intent is — too thin, too tangled, or you'd be guessing — record `__SKIP_UNCERTAIN__` for that file and move on. A wrong description is worse than no description for the vibecoder this map is built for.

## Writing the description

Wrap the description in the right comment syntax and prepend it. If the description spans two sentences, keep them on one line inside the comment body — the extractor joins multi-line bodies with single spaces.

| Extension | Format |
|---|---|
| `.ts`/`.tsx`/`.js`/`.jsx`/`.mjs`/`.cjs`/`.css`/`.scss` | `/**\n * <description>\n */\n` then existing contents. |
| `.sh` (with shebang) | Preserve the shebang exactly; insert `# <description>\n\n` between it and the rest. |
| `.sh` (no shebang) | `# <description>\n\n` then existing contents. |
| `.md` (with heading) | Description as a paragraph immediately after the first heading. |
| `.md` (no heading) | Description as the first paragraph. |

Preserve EOF discipline: if the original file ended with exactly one newline, so does the rewrite; if it had no trailing newline, neither does the rewrite. Don't introduce trailing whitespace.

## Final output

After processing every candidate file, print:

```
describe-codebase summary
─────────────────────────
described:    <N> files
skipped:      <M> files
  existing-header:              <count>
  existing-non-matching-header: <count>
  uncertain:                    <count>
unchanged:    <K> files (unsupported extension or matched IGNORE)

All changes are unstaged. Run `git diff` to review, then `git add` what you want to keep.
```

Then stop. Do not commit, do not stage, do not open the visualizer — those are the user's decisions.
