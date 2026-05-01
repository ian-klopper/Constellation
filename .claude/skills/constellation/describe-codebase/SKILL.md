---
name: constellation:describe-codebase
description: Walk the current repo and add a 1–2 sentence intent-focused header comment to every file Constellation visualizes that doesn't already have one. Use when the visualizer's tiles are showing as text-blank, or after pulling new files into a Constellation-managed repo. Never overwrites existing headers; leaves all changes unstaged for user review.
---

# describe-codebase

You are filling in the leading-comment headers that Constellation extracts as tile descriptions. The user's visualizer is showing blank tiles because their files don't have those headers yet. Your job is to read each file, write a confident 1–2 sentence description of its intent (what it's for, who calls it), and prepend that description in the right comment syntax for the file's language.

## Hard rules

1. **Never overwrite an existing header.** If a file already has a leading comment block in the matching format for its language (see *Has-header detection*), skip it — even if the existing description seems weak. The user owns those.
2. **Confident or omit.** If, after reading the file, you cannot honestly describe its intent in one or two sentences, skip it. Output `__SKIP_UNCERTAIN__` to your scratch state for that file and move on. A wrong description is worse than no description for the vibecoder this map is built for.
3. **Leave everything unstaged.** Do not run `git add`. The user will `git diff`, decide what to keep, and commit themselves.
4. **One file at a time.** Do not bulk-rewrite. Read → describe → write → next.
5. **Never call into Constellation's TypeScript code.** This skill must work in any repo, including ones where Constellation isn't installed. The detection rules below are duplicated from `lib/scan/descriptions.ts` on purpose.

## File enumeration

Walk the current working directory. For each file, decide:

**Skip the file entirely if** any of these patterns match (these mirror Constellation's `IGNORE` list in `lib/scan/discover.ts`):

- `node_modules/` anywhere in the path
- `.next/`, `dist/`, `out/`, `build/` anywhere in the path
- `.git/` anywhere in the path
- `.constellation/` anywhere in the path
- `.claude/worktrees/` anywhere in the path
- `.claude/settings.local.json`
- `next-env.d.ts`
- `*.tsbuildinfo`
- `.DS_Store`
- `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lockb`
- Binary-ish: `*.png`, `*.jpg`, `*.jpeg`, `*.gif`, `*.ico`, `*.svg`, `*.webp`, `*.bmp`, `*.woff`, `*.woff2`, `*.ttf`, `*.eot`, `*.otf`, `*.pdf`, `*.zip`, `*.gz`, `*.tar`, `*.exe`, `*.dmg`

**Otherwise consider the file only if its extension is one Constellation extracts headers from:**

- `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.css`, `.scss` — JSDoc-style (`/** … */`)
- `.sh` — shell comments (`#`)
- `.md` — first paragraph below any heading

Files with other extensions (JSON, lockfiles, dotfiles, etc.) do **not** get headers. Constellation shows just the filename for those.

## Has-header detection

For each candidate file, decide whether it already has a header in the matching format. The rules below match `lib/scan/descriptions.ts` byte for byte; do not relax them.

| Extension | Has-matching-header rule |
|---|---|
| `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.css`, `.scss` | File begins (after optional whitespace) with `/**` and contains a `*/` close. |
| `.sh` | After an optional shebang line (`#!...`) and any blank lines, the next non-blank line starts with `#` (and isn't `#!`). |
| `.md` | The file contains at least one non-empty paragraph that does **not** start with `#` (i.e. there's body text somewhere, not just headings). |

If the file matches the rule above, **skip it** — log `kept (existing header)` and move on.

If the file has a leading comment block in a *non-matching* format (e.g., a `.ts` file that starts with a single-line `// …` comment instead of `/** … */`), **also skip it** — log `skipped: existing-non-matching-header`. Do not try to convert it; the user wrote it that way for a reason.

If the file has no leading comment at all, queue it for description.

## Generating the description

For each queued file, read the entire file (or as much as you need), then write a 1–2 sentence description focused on **intent**:

- What is this file for?
- Who calls it / when does it fire?
- What's the one thing a future reader needs to know to orient themselves?

**Bad:**

- "This file exports a function called `add` that takes two numbers and returns their sum." *(describes what; the code does that)*
- "Utility module." *(no information)*
- "The user can pass any value." *(implementation detail, not intent)*

**Good:**

- "Cursor-anchored floating panel that shows the active tile's description, exports, and import lists. Pin-mode keeps it visible after the cursor leaves; hover-mode follows the pointer."
- "Reads `constellation.config.json` once per process and hands the parsed shape to every server-side caller — single source of truth for the daemon port and watched-tools list."
- "Walks the project root and splits files into TS sources (which feed ts-morph) and everything else."

If after reading the file you genuinely cannot tell what its intent is — the file is too thin, too tangled, or you'd be guessing — record `__SKIP_UNCERTAIN__` for that file and move on. Do not write a description you'd be embarrassed to defend.

## Writing the description

Wrap the description in the comment syntax for the file's extension and prepend it:

**`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.css`, `.scss`** — JSDoc block at the very top of the file:

```
/**
 * <description>
 */
<existing file contents>
```

If the description spans two sentences, keep them on one line inside the JSDoc body (the extractor joins multi-line bodies with single spaces anyway):

```
/**
 * <sentence one>. <sentence two>.
 */
<existing file contents>
```

**`.sh`** — comment block immediately after the shebang (or at the top if there's no shebang):

```
#!/usr/bin/env bash
# <description>

<existing file contents minus the shebang>
```

If there's no shebang:

```
# <description>

<existing file contents>
```

Preserve the shebang exactly; insert one blank line between the comment block and the next line of real code.

**`.md`** — paragraph immediately after the first heading (or at the top if there's no heading):

```
# Existing Heading

<description>

<rest of existing markdown>
```

If the file has no heading at all, put the description as the first paragraph:

```
<description>

<existing markdown>
```

## EOF discipline

- If the original file ended with exactly one newline, the rewritten file ends with exactly one newline.
- If it had no trailing newline, neither does the rewrite.
- Do not introduce trailing whitespace.

## Final output

After processing every candidate file, print a summary in this format:

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
