---
title: Richer file-description detection (directive-aware preamble + per-format extractors + sidecar)
type: feat
status: active
date: 2026-05-01
deepened: 2026-05-01
---

# Richer file-description detection

## Overview

Constellation's tile descriptions are extracted by `lib/scan/descriptions.ts`, which today only knows three formats (JSDoc on `.ts`/`.tsx`/`.js`/`.jsx`/`.mjs`/`.cjs`/`.css`/`.scss`, leading `#` block on `.sh`, first paragraph after a heading on `.md`) and assumes the description sits at byte 0. Two real-world cases break this:

1. **Mandatory framework directives steal line 1.** `'use client';`, `'use server';`, `// @vitest-environment node`, `// @ts-nocheck`, `// eslint-disable-next-line ...`, and `.mjs`/`.cjs` shebangs all have to appear before any executable code, so the user-authored JSDoc that follows is invisible to the current `^\s*\/\*\*` regex.
2. **Whole file types have no detection.** `.sql` (line-comment `--` and block-comment `/* */`), `.yaml`/`.yml` (`#`), `.py` (`#` + module docstrings `"""..."""`), `.rb` (`#`), and `.html` (`<!-- ... -->`) all carry comments natively but Constellation skips them. JSON has no comment syntax at all.

This plan fixes both problems by (a) adding a directive-aware "preamble skip" before the existing JSDoc/shell extractors, (b) adding per-format extractors for the missing comment-bearing types, and (c) adding a `.constellation/descriptions.{json,yaml,yml}` sidecar map that lets users describe tiles whose source file genuinely cannot carry a comment (JSON, binaries) — or override anything they want. Together this should close the "115 of 672 tiles blank" gap the user observed.

## Problem Frame

The user-visible symptom: in a typical Next.js + Vitest codebase, ~17% of tiles end up labeled with just a filename even though the underlying file would happily host a description. The description-extraction logic was written for a small set of formats and assumes a rigid "byte 0 is JSDoc" placement, neither of which survives contact with framework directives or polyglot repos.

The fix is intentionally narrow — it makes detection more permissive, not heuristic. We do not start guessing descriptions from arbitrary `//` comments or pulling content out of code, because the project's stated rule (codified in `lib/scan/descriptions.ts` and the description-truncation learning at `docs/solutions/ui-bugs/description-truncation-and-line-clamp-math-2026-04-30.md`) is *"a wrong description is worse than none for the vibecoder this map is built for."* We expand the *places* the extractor will look; we do not soften the *bar* for what counts as a description.

## Requirements Trace

- **R1.** A `.tsx` file whose line 1 is `'use client';` followed by a `/** ... */` block on lines 3–5 must produce that JSDoc body as its description.
- **R2.** A `.test.ts` file whose line 1 is `// @vitest-environment node` followed by a JSDoc must produce the JSDoc as its description **and** the `@vitest-environment` directive must remain on (or near) line 1 so the test runner still picks it up — i.e. the user must not be forced to move the directive below the description.
- **R3.** A `.sql` migration whose first non-blank line is `-- Adds the user_credits table.` must show that line as its description.
- **R4.** A `package.json` with no entry of its own, listed in `.constellation/descriptions.yaml` as `package.json: "Project manifest — npm scripts and dependencies."`, must show that string as its tile description.
- **R5.** Existing description detection (plain TS files with a top-of-file JSDoc, `.sh` files with a `#` block, `.md` files with a paragraph) must continue to work unchanged. The 17% gain must not come at the cost of the 83% that already worked.
- **R6.** New file-type coverage: `.sql`, `.yaml`/`.yml`, `.py`, `.rb`, `.html` must all extract descriptions from their native comment syntaxes when present.
- **R7.** Sidecar entries take precedence over in-file descriptions. If both exist for the same path, the sidecar wins (user's explicit choice).
- **R8.** Malformed sidecar files (invalid JSON/YAML, wrong shape) must produce a clear stderr warning and leave detection working — they must not crash the scan.
- **R9.** The leading combination of (a) shebangs, (b) string-literal directives (`'use client';`, `"use server";`, `'use strict';`), and (c) single-line `//` directive comments (`// @vitest-environment ...`, `// @ts-nocheck`, `// eslint-disable ...`) must be skipped in any order, and the description may live either above or below that combination.

## Scope Boundaries

- We do **not** invent descriptions from arbitrary content (function names, import lists, file basenames). Detection stays explicit-comment-only.
- We do **not** start treating arbitrary `// some comment` lines as descriptions in TS/JS files — only the recognized directive shapes are skipped, not consumed as description text.
- We do **not** add description detection for `.go`, `.rs`, `.java`, `.swift`, `.kt`, etc. in this plan. Those formats can be added later by adding extractor rows; the architecture supports it but the feature description scopes us to web-stack formats.
- We do **not** parse Python source semantically — module docstrings are detected by leading-line shape only (a `"""` or `'''` triple-quote at the top of the file, optionally after a shebang and `# coding: ...`), not by walking the AST.
- We do **not** support glob keys in the sidecar (e.g. `app/**/*.json`). Sidecar keys are exact repo-relative paths.
- We do **not** add a test runner to Constellation as part of this plan (see Open Questions → Deferred to Implementation).

## Context & Research

### Relevant Code and Patterns

- `lib/scan/descriptions.ts` — single file holding `extractDescription`, `extractJsDoc`, `extractShellHeader`, `extractMarkdownIntro`, plus the `JSDOC_LIKE_EXTS` set. All extraction lives here.
- `lib/scan.ts:84-105` — the scan orchestrator that calls `extractDescriptions(sources)` and writes results into `descriptionsByPath`. Sidecar merging will happen at this level so the existing extractor stays a pure function over `(filename, source)`.
- `lib/scan/discover.ts:22-37` — the `IGNORE` glob list. `.constellation/**` is ignored for tile-rendering purposes (good), but the sidecar reader needs to bypass that and read `.constellation/descriptions.{json,yaml,yml}` directly via `fs/promises`.
- `install.sh:262-321` — the `DESCRIBE_PROMPT_TEMPLATE` heredoc that ships in the installer and tells a freshly-launched Claude Code session which file types and syntaxes to use. The header docstring of `lib/scan/descriptions.ts` already carries the instruction "If you change the JSDoc / shell / markdown detection here, also update the prompt in `install.sh`." — this plan must follow that rule.
- `CLAUDE.md` "Source layout → File descriptions" bullet — describes the supported formats in user-facing prose. Out of date the moment new extractors land.
- `lib/config.ts:50-83` — `resolveTargetRoot()` and `resolveStateDir(targetRoot)`. The sidecar lives at `<targetRoot>/.constellation/descriptions.{json,yaml,yml}`, so the loader follows the same target-root convention rather than reaching for `process.cwd()` directly.

### Institutional Learnings

- `docs/solutions/ui-bugs/description-truncation-and-line-clamp-math-2026-04-30.md` — the prior near-miss on description handling. Two takeaways apply directly:
  - **Keep content-shaping utilities maximal at the source.** New extractors should return the full description body; do not pre-truncate. The tile and hover panel each clamp at display time. (Already the convention since `d846895`.)
  - **A `CLAUDE.md` line that encodes a spec decision can become load-bearing.** The current "TS/JS/CSS files use a leading `/** … */` JSDoc block; … Anything else (JSON, lockfiles, .gitignore) shows just its filename." sentence will mis-document the system the moment this plan ships. CLAUDE.md update is a required deliverable, not a nice-to-have.

### External References

Not consulted — the codebase has strong, recent local patterns for this exact concern (one `lib/scan/descriptions.ts` file, well-commented, with an existing convention for adding extractors), and the comment syntaxes for SQL/YAML/Python/Ruby/HTML are stable, well-understood standards.

## Key Technical Decisions

- **Decision:** Implement directive-aware preamble skipping as a "find the JSDoc anchor" pre-step, not as a parallel code path. Walk leading lines, classifying each as `blank | shebang | string-literal-directive | line-directive-comment | other`. The "preamble" is any consecutive run of the first four. The JSDoc anchor is the first character past the preamble (or position 0 if the preamble is empty).
  - **Rationale:** Folds R1, R2, and the `.mjs`/`.cjs` shebang case into one mechanism. Avoids parallel branches that drift apart. Lets us add new directive shapes (e.g. `// @flow`) later by extending one classifier function.
- **Decision:** Recognize string-literal directives by exact membership in `{'use client', 'use server', 'use strict', 'use asm'}` followed by an optional semicolon and end-of-line. Do **not** match arbitrary `'foo bar';` strings.
  - **Rationale:** Prevents accidentally consuming a top-of-file string expression that happens to look like a directive. The set is closed and well-known.
- **Decision:** Recognize line-directive comments by **closed set**, not wildcard `// @<token>`. The set: `// @vitest-environment <env>`, `// @jest-environment <env>`, `// @ts-nocheck`, `// @ts-check`, `// @ts-expect-error[: ...]`, `// @ts-ignore[: ...]`, `// @flow`, `// @next-runtime <runtime>`, `// eslint-disable[...]`, `// eslint-enable[...]`, `// prettier-ignore`, `// stylelint-disable[...]`, `// stylelint-enable[...]`. Anything else (a plain `// some thought here`, `// @author Foo`, `// @license MIT`, `// @link ...`, `// @ian: revisit this`) is **not** a directive — the preamble ends and we stop searching at that line.
  - **Rationale:** A wildcard `// @\w` would silently consume real-world non-pragma comments (`// @author`, `// @deprecated`, `// @license`, team-internal `// @username` pings) as preamble. If a `/** */` block then exists further down the file (e.g., a JSDoc on the first exported function), it would be promoted to file-level description — a wrong description, which the project policy explicitly says is worse than no description (`docs/solutions/ui-bugs/description-truncation-and-line-clamp-math-2026-04-30.md`). Adding new pragmas to the closed set is a one-line code change as they emerge; the marginal cost is much smaller than the risk of a generic rule misfiring.
- **Decision:** Add per-format extractors for `.sql`, `.yaml`/`.yml`, `.py`, `.rb`, `.html`. Dispatch table replaces the current if/else chain in `extractDescription`.
  - **Rationale:** Cheap, well-trodden patterns. The dispatch table makes the supported-format list a one-line read.
- **Decision:** Python module docstring detection runs **before** `#` line-comment detection. If the file's first non-blank line (after optional shebang + `# coding:` line) starts with the literal triple-quote `"""` or `'''` — **with no string prefix** — extract through the matching closer. Same-line opener+closer (`"""One-liner."""`) and multi-line both supported. If the docstring isn't found, fall back to the leading `#` block.
  - **Rationale:** Docstrings are the idiomatic Python file-description location. Prefix forms (`r"""..."""`, `b"""..."""`, `f"""..."""`, `rb"""..."""`, `u"""..."""`) are valid Python module-level string statements but uncommon for docstrings; explicitly excluding them keeps the matcher's regex unambiguous and produces `undefined` (the safe fallback to `#` block, then to "no description") rather than a body that starts with the prefix character or a body that accidentally captured part of the prefix. New prefix support can be added later if real-world miss-rates justify it.
- **Decision:** Sidecar lives at `<scannedRepoRoot>/.constellation/descriptions.{json,yaml,yml}` — the *root passed to `scanProject(root)`*, not a single global path. Each repo Constellation can visualize (since the recent multi-repo addition where `?repo=<path>` selects which repo to scan) carries its own sidecar. The loader checks for all three names in priority order (`.yaml` → `.yml` → `.json`) and uses the first that exists. Format is a flat `{ "<repo-relative-path>": "<one-line description>" }` map.
  - **Rationale:** Per-repo sidecars match how everything else in `.constellation/` works (per-repo state). User explicitly suggested this location. The session-start hook (`.claude/hooks/session-start.sh`) only wipes `.constellation/agents/<sessionId>__*.json`, not arbitrary files at the dir root, so a checked-in `descriptions.yaml` survives session resets — verified during deepening review.
- **Decision:** Sidecar entries always win over in-file descriptions.
  - **Rationale:** R7. The user wrote the sidecar entry deliberately; if they later add an in-file JSDoc and forget to delete the sidecar entry, they probably still want the sidecar to win (it was the most-recently-curated value at the time they wrote it). Reverse precedence would silently shadow a user's typed-out override the moment any in-file comment appears.
- **Decision:** Add the `yaml` npm package (the `eemeli/yaml` package, currently the de-facto YAML parser for Node — small, no deps, actively maintained) to support `.yaml`/`.yml` sidecars. JSON support requires no new dep.
  - **Rationale:** YAML is much friendlier than JSON for one-line descriptions (no escaping required for quotes, em-dashes, etc.). The dep cost is small (~50 KB) and isolated to the scan path. If a future audit wants to drop the dep, JSON-only is a viable fallback.
- **Decision:** Sidecar parsing failures (file unreadable, malformed JSON/YAML, wrong shape) emit a single `console.warn` line via `lib/scan.ts` and proceed with no sidecar entries. The scan does not throw.
  - **Rationale:** Sidecar is a convenience layer, not a critical path. R8. A typo'd YAML file should not break the visualizer.
- **Decision:** Keep extractors and sidecar loader as pure functions exported from `lib/scan/descriptions.ts` and (new) `lib/scan/description-sidecar.ts`. The orchestration (read source, call extractors, merge sidecar) stays in `lib/scan.ts`.
  - **Rationale:** Mirrors the existing `lib/scan/` decomposition where each phase is a pure function and `scan.ts` is the orchestrator. Easier to add unit tests later without setting up a project fixture.

## Open Questions

### Resolved During Planning

- **Should `.html` detection look for an HTML5 `<!-- description -->` at the top, or pull from `<title>` / `<meta name="description">`?** Resolved: leading `<!-- ... -->` only, before any `<!DOCTYPE>` is also valid. We do **not** crack open the document body. Most internal-tooling HTML files (component fixtures, email templates, Storybook fragments) carry their description as a top-of-file comment, not as `<title>`.
- **Should JSON detection try to parse the file and pull from a `description` field?** Resolved: no. JSON files routinely have `"description"` fields that mean things other than "what is this file about" (e.g. `package.json#description` is a package-level field, not a file-level one). Sidecar is the answer for JSON.
- **Should the sidecar key support partial paths or globs (e.g. `app/api/**/route.ts`)?** Resolved: no. Exact-match repo-relative paths only. Globs would create ambiguity (which match wins for overlapping globs?) for negligible benefit — and any user wanting global pattern coverage can write a script that emits the sidecar.
- **Where in CLAUDE.md does the file-descriptions update go?** Resolved: the existing "File descriptions" sub-bullet under "Source layout" gets rewritten in place. No new section.

### Deferred to Implementation

- **Exact regex shape for the line-directive classifier.** The plan specifies the closed set; the implementer picks whether that's one regex with alternation or a small token-prefix table. Either is fine.
- **Whether to add `vitest` as a Constellation dev-dependency for unit-testing the parsers.** Recommended (the parsers are pure and ideal for table-driven tests; the description-truncation learning explicitly called out "no test runner" as load-bearing in that bug surviving review), but out of scope for this plan to keep the diff focused. Verification for this plan's units is manual against an external test repo. Adding vitest is its own short follow-up plan.
- **Whether to surface a count of "files with a sidecar override" anywhere in the UI.** Probably not worth it — the description on the tile is the truth — but worth deciding once we see the feature in use.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

The extractor pipeline becomes:

```
sources: Map<relPath, source>          sidecar: Map<relPath, string> | null
                |                                       |
                v                                       v
        per-extension dispatch                   (loaded once, may be null)
        (jsdoc | shell | md | sql                       |
         | yaml | py | rb | html | undefined)           |
                |                                       |
                v                                       |
        in-file description                             |
        (string | undefined)                            |
                |                                       |
                +-------- merge: sidecar wins -----------+
                                |
                                v
                        descriptionsByPath
```

The JSDoc extractor itself becomes:

```
extractJsDoc(source):
  preambleEnd <- skip leading run of:
                    blank lines
                  | shebang line  (#!...)
                  | string-literal directive  (one of {use client, use server, use strict, use asm})
                  | line-directive comment    (// @<token>... | // eslint-...| // prettier-ignore | // stylelint-...)
  match /\* …  *\// starting at position 0  -> if found, return it
  match /\* …  *\// starting at preambleEnd -> if found, return it
  return undefined
```

Note both anchor positions are tried, in order. This satisfies "the description should be allowed to live above OR below those directives" — the fast common case (description at byte 0, no directives) is unchanged.

For Python:

```
extractPythonDoc(source):
  i <- 0
  if line[i] starts with #!     i++
  if line[i] starts with # coding: or # -*- coding: …  i++
  skip blank lines
  if line[i] starts with """ or ''':
    extract string up to matching closer; return its first paragraph
  else:
    extract leading # block (same shape as shell extractor)
```

## Implementation Units

- [ ] **Unit 1: Directive-aware preamble skip in JSDoc extractor**

**Goal:** Make `extractJsDoc` find a `/** ... */` block that follows any combination of leading shebangs, string-literal directives, and recognized `//` directive comments. Existing files with a JSDoc at byte 0 must continue to work unchanged.

**Requirements:** R1, R2, R5, R9.

**Dependencies:** None.

**Files:**
- Modify: `lib/scan/descriptions.ts`
- Test (manual, against fixtures): see Verification

**Approach:**
- Introduce a `findJsDocAnchor(source: string): number | null` helper that walks lines from position 0 and classifies each as `blank | shebang | string-directive | line-directive | other`. The first `other` (or end-of-file) ends the preamble. The anchor is the byte offset right after the last preamble line.
- Modify `extractJsDoc` to first try matching `/** ... */` at byte 0 (current behavior, fast path), then try matching at the preamble-end anchor. Return the first non-empty body. The byte-0 attempt subsumes the "description above any directives" case; the preamble-end attempt is the new "description below directives" case.
- The classifier (closed sets only):
  - **Shebang:** `^#!`
  - **String-literal directive:** trimmed line equals one of `'use client'`, `"use client"`, `'use server'`, `"use server"`, `'use strict'`, `"use strict"`, `'use asm'`, `"use asm"`, optionally followed by `;` and trailing whitespace/comment.
  - **Line-directive comment** (closed set, see Key Technical Decisions for rationale): one of `// @vitest-environment <env>`, `// @jest-environment <env>`, `// @ts-nocheck`, `// @ts-check`, `// @ts-expect-error[...]`, `// @ts-ignore[...]`, `// @flow`, `// @next-runtime <runtime>`, `// eslint-disable[...]`, `// eslint-enable[...]`, `// prettier-ignore`, `// stylelint-disable[...]`, `// stylelint-enable[...]`. Match leading whitespace and trailing content liberally.
- Stop at any other shape (including a plain `// foo` comment, `// @author Foo`, `// @license ...`, etc. — these are not recognized directives, the preamble ends, and we stop searching).

**Patterns to follow:**
- The existing `extractJsDoc` regex shape (`/^\s*\/\*\*([\s\S]*?)\*\//`) for the JSDoc match itself — keep using it, just allow a configurable starting offset.
- The trailing `body.split(/\s@\w/)[0]` JSDoc-tag truncation — preserved for the post-directive match too.

**Test scenarios:**
- Happy path (description below single directive, the R1 case): `'use client';\n\n/** Foo bar. */\nexport ...` → returns `"Foo bar."`. Exercises the preamble-end anchor.
- Happy path (description below directive, R2 case): `// @vitest-environment node\n/** Tests for X. */\n` → returns `"Tests for X."`.
- Happy path (description below shebang): `#!/usr/bin/env node\n/** Script that ... */\n` (in `.mjs`) → returns description.
- Happy path (description above directive — current byte-0 behavior preserved): `/** Old style. */\n'use client';\n` → returns `"Old style."`. Exercises the byte-0 anchor; preamble-end never consulted.
- Happy path (description below MULTIPLE directives — exercises preamble-end with a non-trivial preamble): `'use client';\n'use strict';\n/** Description after directives. */\n` → returns `"Description after directives."`. This is the case the byte-0 anchor cannot handle.
- Happy path (combo of all preamble shapes): `#!/usr/bin/env node\n'use strict';\n// @ts-nocheck\n\n/** Combined. */\n` → returns `"Combined."`.
- Edge case (non-directive `//` ends the preamble): `// @vitest-environment node\n// just a thought\n/** Desc. */` → returns `undefined`. The plain `// just a thought` ends the preamble before the JSDoc is reached. Documents that we do not silently swallow non-directive `//` lines.
- Edge case (`// @author` is NOT a directive — the closed set rejects it): `// @author Jane\n/** Desc. */` → returns `undefined`. Documents the closed-set rejection. If a real Jane-authored file has both an `@author` line and a JSDoc, the user should remove the `@author` or move the JSDoc to byte 0; we will not silently consume `@author` and promote a function-level JSDoc as the file description.
- Edge case (string-directive with a typo): `'use clientx';\n/** Desc */` → returns `undefined`. `'use clientx'` is not in the closed set, so the preamble ends at line 1 and the JSDoc on line 2 is not at byte 0.
- Edge case (leading blanks count as preamble): `\n\n\n'use client';\n/** Desc */` → returns `"Desc"`.
- Regression: every existing TS/JS/CSS file in this repo whose tile currently shows a description must continue to do so. Before merging, the implementer should grep the install-root for `^//\s*@` shapes and diff `descriptionsByPath` before vs. after to confirm no regression on this codebase.

**Verification:**
- After running `npm run dev` and loading the visualizer, hand-verify against three fixture files (one with a `'use client'` directive, one with a `// @vitest-environment` directive, one plain JSDoc) that each tile shows the expected description.
- The existing repo's tiles (which all use plain JSDoc at byte 0) must look identical to before.

---

- [ ] **Unit 2: Per-format extractors for `.sql`, `.yaml`/`.yml`, `.py`, `.rb`, `.html`**

**Goal:** Detect descriptions in the five new formats. Each extractor returns the same shape as the existing ones — a single trimmed string or `undefined`.

**Requirements:** R3, R6.

**Dependencies:** Unit 1 (so `extractDescription` already has a clean dispatch shape to extend).

**Files:**
- Modify: `lib/scan/descriptions.ts`
- Test (manual, against fixtures): see Verification

**Approach:**
- Replace the if-else chain in `extractDescription` with a dispatch table keyed on extension: `{ ".ts": extractJsDoc, ".tsx": extractJsDoc, ..., ".sh": extractShellHeader, ".md": extractMarkdownIntro, ".sql": extractSqlHeader, ".yaml": extractHashHeader, ".yml": extractHashHeader, ".py": extractPythonDoc, ".rb": extractHashHeader, ".html": extractHtmlComment, ".htm": extractHtmlComment }`.
- **`extractSqlHeader`**: leading `/* ... */` block at byte 0 wins; otherwise leading `--` line block (skip blanks, take consecutive `--` lines, strip the prefix, join with spaces).
- **`extractHashHeader`**: rename / generalize today's `extractShellHeader` so it works for `.yaml`, `.yml`, `.rb`, and the Python fallback. Same shape: optional shebang skip on line 1, then leading `#` block. (For YAML/Ruby a shebang is rare but harmless to skip.)
- **`extractPythonDoc`**: skip leading shebang and `# coding: ...` / `# -*- coding: ... -*-` lines (one each, optional), skip blanks, then check for `"""..."""` or `'''...'''` at the next non-blank line. Single-line and multi-line both supported. If no docstring, fall back to `extractHashHeader` semantics on the original source so a Python script with a `#` header still works.
- **`extractHtmlComment`**: strip an optional UTF-8 BOM (`﻿`) at byte 0, skip leading blanks, skip an optional XML prolog (`<?xml ...?>`), skip an optional `<!DOCTYPE ...>` line, then match the next non-blank chunk against `<!--([\s\S]*?)-->`. Trim whitespace. **Reject** the match (return `undefined`) if the body starts with `[if ` (IE conditional comments like `<!--[if IE]>...<![endif]-->` are syntactically HTML comments but never real descriptions). Otherwise return the body — including license-header comments, which are an acceptable form of description for an HTML file. Users who want a richer description can use the sidecar to override.

**Patterns to follow:**
- Existing `extractShellHeader` for the line-comment-block pattern (skip prefix, normalize whitespace, join).
- Existing `extractJsDoc` for the multi-line block-comment pattern (regex match, body cleanup).
- Existing `nonEmpty` helper for the empty-string sentinel.

**Test scenarios:**
- Happy path (SQL `--`): `-- Adds the user_credits table.\nCREATE TABLE ...` → `"Adds the user_credits table."`.
- Happy path (SQL block): `/* Drops the legacy users index. */\nDROP INDEX ...` → `"Drops the legacy users index."`.
- Happy path (YAML): `# CI workflow for the visualizer.\nname: ci\non: push\n` → `"CI workflow for the visualizer."`.
- Happy path (Python docstring): `"""Module that ranks search results."""\nimport ...` → `"Module that ranks search results."`.
- Happy path (Python `#` fallback): `#!/usr/bin/env python\n# coding: utf-8\n# Migration script for the v2 schema.\nimport ...` → `"Migration script for the v2 schema."`.
- Happy path (Ruby): `# Sidekiq worker that emails weekly digests.\nclass DigestWorker ...` → `"Sidekiq worker that emails weekly digests."`.
- Happy path (HTML): `<!DOCTYPE html>\n<!-- Email template: password reset. -->\n<html>...` → `"Email template: password reset."`.
- Edge case (SQL multi-line `--`): `-- Adds the user_credits table.\n-- Backfilled in a separate migration.\nCREATE ...` → `"Adds the user_credits table. Backfilled in a separate migration."`.
- Edge case (Python triple-quoted, multi-line): `"""\nDoes a thing.\n\nNotes:\n- detail.\n"""` → first paragraph only, i.e. `"Does a thing."`.
- Edge case (Python single-line docstring): `"""One-liner."""\nimport ...` → `"One-liner."` (opener and closer on same line).
- Edge case (Python prefixed docstring): `r"""Raw docstring."""\nimport ...` → `undefined`. The closed-set policy rejects prefix forms; falls through to `#` block detection (which also returns `undefined` here). Documents the deliberate scope limit.
- Edge case (HTML with no comment): `<!DOCTYPE html>\n<html>...` → `undefined`.
- Edge case (HTML with IE conditional comment first): `<!DOCTYPE html>\n<!--[if IE]>fallback<![endif]-->\n<!-- Real description. -->\n` → `undefined` from the first comment (rejected by `[if ` prefix). The plan only consumes the *first* comment and stops; if the user wants the real description used, they should reorder or use the sidecar. Documents the policy.
- Edge case (UTF-8 BOM): `﻿<!DOCTYPE html>\n<!-- Description. -->` → `"Description."` (BOM stripped first).
- Edge case (YAML with no `#` header): `name: ci\non: push\n` → `undefined`. We do not invent a description from the document body.

**Verification:**
- Run `npm run dev` against an external sample repo containing fixture files for each format and confirm tiles populate.
- Confirm at least one `.sql` migration in a real Rails or Drizzle project shows its `--` description.

---

- [ ] **Unit 3: Sidecar `.constellation/descriptions.{json,yaml,yml}` loader and merge**

**Goal:** Load a user-curated description map from a sidecar file and merge it into the descriptions output, with sidecar values taking precedence.

**Requirements:** R4, R7, R8.

**Dependencies:** Units 1 & 2 (so the in-file extractor produces the value the sidecar will override).

**Files:**
- Create: `lib/scan/description-sidecar.ts`
- Modify: `lib/scan.ts`
- Modify: `package.json` (add `yaml` dependency)
- Test (manual): see Verification

**Approach:**
- New module `lib/scan/description-sidecar.ts` exports `loadDescriptionSidecar(scannedRoot: string): Promise<Map<string, string>>`. The parameter is the same `root` already passed to `scanProject(root)` — under multi-repo this is whichever repo is being rendered, not necessarily the install root. Behavior:
  - Look for `<scannedRoot>/.constellation/descriptions.yaml`, then `.yml`, then `.json`. Use the first that exists.
  - Read with `fs/promises#readFile`. Parse JSON via `JSON.parse`; YAML via the `yaml` package's `parse`.
  - Validate the shape: top-level value must be a plain object whose keys are strings and whose values are strings. Anything else → `console.warn` with the path and reason, return an empty Map.
  - Trim each value; drop empty values silently.
  - Normalize keys to forward-slash repo-relative paths (handle accidental leading `./` or backslashes from Windows-authored sidecars).
  - Return the `Map<string, string>`.
- In `lib/scan.ts`, immediately after the existing `for (const [relPath, desc] of extractDescriptions(sources))` merge loop, call `loadDescriptionSidecar(root)` and run a second loop that overwrites `descriptionsByPath` for every sidecar key. Sidecar wins.
- `loadDescriptionSidecar` must not throw on read failure (`ENOENT` is the common case — no sidecar exists). Other errors (parse, shape) emit one warning line and return empty.
- Add `yaml` (the `eemeli/yaml` package, currently `^2.x` on npm) to `dependencies` in `package.json`. Run `npm install` after editing.
- Note: `lib/scan/discover.ts` ignores `**/.constellation/**` for tile discovery. The sidecar reader bypasses that by using `fs/promises#readFile` directly with an explicit path, never going through the discover/glob phase.

**Patterns to follow:**
- `lib/config.ts` reading pattern (synchronous read for a small config-ish file). The sidecar is small and read once per scan, so async is fine and matches the rest of the scan pipeline.
- `lib/scan.ts:92-99`'s pattern of writing into `descriptionsByPath` directly — do the same for sidecar entries.

**Test scenarios:**
- Happy path (YAML, override): a `package.json` with no in-file description; sidecar `descriptions.yaml` contains `package.json: "Project manifest — npm scripts and dependencies."` → tile shows that string.
- Happy path (YAML, override existing): a `lib/config.ts` with a JSDoc; sidecar contains `lib/config.ts: "Override description."` → tile shows `"Override description."`, not the JSDoc.
- Happy path (JSON): same as YAML but file is `.constellation/descriptions.json` with `{"package.json": "..."}`.
- Edge case (no sidecar file): scan completes cleanly, no warnings, all tiles use in-file descriptions. (This is the default state of every existing repo.)
- Edge case (both `.yaml` and `.json` exist): YAML wins (priority order), and a single warning may be emitted noting that `.json` was ignored — *or* we can just silently prefer YAML. Decision: silent. The priority order is documented and any user with both files knows what they did.
- Error path (malformed YAML): warning logged, scan completes, tiles use in-file descriptions only.
- Error path (top-level array instead of object): warning logged with reason "expected object map of paths", scan completes.
- Error path (non-string value, e.g. `package.json: 42`): that one entry is dropped with a warning; other entries still apply.
- Edge case (key with leading `./`): normalized to bare repo-relative path before merging.
- Edge case (key for a path that doesn't exist as a tile): silently included in the map; the merge loop just won't find a `descriptionsByPath` entry to display it on. Not an error — the user may have a sidecar entry for a recently-deleted file.

**Verification:**
- Manually create `.constellation/descriptions.yaml` with a `package.json` entry, reload visualizer, confirm `package.json` tile shows the entry.
- Delete the entry, reload, confirm `package.json` tile reverts to filename-only.
- Introduce a malformed YAML file, reload, confirm a single stderr warning and tiles still render.

---

- [ ] **Unit 4: Update the `install.sh` description-writer prompt**

**Goal:** The Claude Code session launched at the end of `install.sh` writes descriptions in the formats Constellation actually reads. Today's prompt only mentions JSDoc/`#`/markdown; this unit expands it.

**Requirements:** R5 (existing supported formats stay listed), R6 (new formats listed), R4 (sidecar mechanism documented as the answer for JSON / binaries).

**Dependencies:** Units 1, 2, 3 must have landed so the prompt is describing real behavior.

**Files:**
- Modify: `install.sh` (the `DESCRIBE_PROMPT_TEMPLATE` heredoc, roughly lines 262-321)

**Approach:**
- Expand the "Of what remains, only files with these extensions can hold a description Constellation will read" list to include `.sql`, `.yaml`/`.yml`, `.py`, `.rb`, `.html`, with the matching syntax for each.
- Add a paragraph noting that if a file (e.g. `package.json`) cannot carry a comment, the user can describe it via `.constellation/descriptions.yaml` (path-to-string map). Keep this brief — most users will use in-file comments.
- Add a paragraph noting that for `.tsx`/`.ts`/`.js` files that already start with a directive (`'use client';`, `// @vitest-environment node`, etc.), the description goes immediately after the directive, not before — so the directive stays as the first executable statement / line. This is the **writing-side** of R2: the extraction step (Unit 1) tolerates either order, but the install-prompt should steer fresh writes to the post-directive position so the user's test runner / framework keeps picking the directive up. R2's directive-position invariant is preserved by *never modifying existing directives* and by *advising new descriptions go after them*.
- Update the per-extension "Step 3 — Write the descriptions" block accordingly with one bullet per new format.

**Patterns to follow:**
- The existing prompt's bullet style: extension list, syntax shape, position in file. Keep entries terse.
- The existing convention that the prompt is informational, not prescriptive about counts or scope — the user picks the scope.

**Test scenarios:**
- Test expectation: none — this is a documentation/prompt change with no behavioral surface inside Constellation. Verification is a careful read of the heredoc and a dry run of the launched `claude` session against a sample repo.

**Verification:**
- Re-run `install.sh` in a sample repo and confirm the heredoc renders correctly (no shell-quoting regressions). Skim the prompt as a fresh Claude would: every extension listed should match what `lib/scan/descriptions.ts` actually handles. The sidecar paragraph should give a copy-pasteable example.

---

- [ ] **Unit 5: Update CLAUDE.md "File descriptions" bullet**

**Goal:** Keep the project's own documentation accurate. The "File descriptions" bullet under "Source layout" is the single line a future Claude (or human reader) consults to understand which file types carry descriptions and where to put them.

**Requirements:** R5 (existing formats still listed), R6 (new formats listed), R4 (sidecar mentioned).

**Dependencies:** Units 1–4 must have landed.

**Files:**
- Modify: `CLAUDE.md` (the "File descriptions" sub-bullet under "Source layout")

**Approach:**
- Rewrite the bullet to enumerate all supported formats (TS/JS/CSS via JSDoc; `.sh` via `#`; `.md` via first paragraph; `.sql` via `--` or `/* */`; `.yaml`/`.yml`/`.rb` via `#`; `.py` via docstring or `#`; `.html` via `<!-- -->`).
- Add a one-sentence note that leading framework directives (`'use client';`, `// @vitest-environment ...`, shebangs) are skipped before looking for the JSDoc, so descriptions can sit either above or below them.
- Add a one-sentence note about the `.constellation/descriptions.yaml` sidecar for files that can't carry a comment (or as an override).
- Preserve the existing "Don't write heuristic fallbacks; a wrong description is worse than none for the vibecoder this map is built for." sentence verbatim — that policy is unchanged.

**Patterns to follow:**
- The existing bullet's prose style: concrete, terse, with the "why" at the end.

**Test scenarios:**
- Test expectation: none — documentation change.

**Verification:**
- Diff the bullet against `lib/scan/descriptions.ts` line-by-line: every extension in the dispatch table appears in the bullet, and every extension in the bullet has a corresponding extractor.

## System-Wide Impact

- **Interaction graph:** The change is contained to `lib/scan/descriptions.ts` (extraction), `lib/scan/description-sidecar.ts` (new), and `lib/scan.ts` (orchestrator merge). Frontend (`HoverPanel.tsx`, `TreemapNode.tsx`) reads `node.description` and is format-agnostic — no frontend change needed.
- **Error propagation:** Sidecar errors must not crash the scan. Bad in-file syntax produces `undefined` (no description) silently — same as today.
- **State lifecycle risks:** None. Descriptions are recomputed on every scan; there's no persisted state to migrate. The sidecar file is user-curated and survives across scans.
- **API surface parity:** `extractDescription(filename, source)` keeps its signature. New work is additive — no caller of the existing function needs to change.
- **Integration coverage:** End-to-end the change has to be verified by running the visualizer (`npm run dev`) and looking at tiles. There is no automated test runner today; "did the tile render the right description" is a visual check. Recommend running against this repo (regression-only — every existing tile should look identical) and against a sample Next.js + Vitest repo (validation — new extractors and directive skipping should populate previously-blank tiles). Under multi-repo, also verify by switching `?repo=<other-path>` and confirming the sidecar at the *other* repo's `.constellation/descriptions.yaml` is the one that loads — sidecars must not bleed across repos.
- **Unchanged invariants:** The display-side line-clamp math in `TreemapNode.tsx` and the scroll behavior in `HoverPanel.tsx` are explicitly **not** touched. Description text continues to flow through the pipeline at full length and gets truncated only at render time. This preserves the fix from `docs/solutions/ui-bugs/description-truncation-and-line-clamp-math-2026-04-30.md`. The closed-set policy on what counts as a description is also unchanged: explicit comments only, no heuristic synthesis.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| The closed set of "directive comments" is too narrow and a future framework's directive (`// @some-future-runtime`?) silently ends the preamble, hiding the JSDoc. | Misses produce `undefined` (no description) — never a wrong description. New shapes can be added to the closed set in one line of code as they emerge. The deepening review explicitly traded "absorbs every future pragma" for "no false positives on `// @author` / `// @license` / `// @link`" which the alternative wildcard rule would silently consume. |
| The closed set of "string-literal directives" misses a less-common case (`'use memo';`?) and breaks detection on a file that legitimately starts with that string. | Misses produce a `undefined` description, never a wrong description. Adding new directives is a one-line change in the closed set when they appear. |
| Sidecar precedence (sidecar wins) confuses a user who adds an in-file JSDoc later and doesn't see it on the tile. | The CLAUDE.md update and the install.sh prompt both explicitly state precedence. The description writer prompt should also recommend deleting sidecar entries once the in-file version is authoritative. Deferred follow-up: surface "this tile's description came from the sidecar" somewhere in the hover panel. |
| Adding the `yaml` dependency surfaces a new transitive dep audit. | `eemeli/yaml` has zero runtime deps and is widely used (Next.js, Astro, etc. transitively). Keep it pinned. If future hygiene wants to drop the dep, JSON-only is a viable fallback (one extractor row removed). |
| `extractDescriptions` is now called for every file, including the new format types — adds I/O for files we previously didn't bother reading content for. | We were already reading every non-oversize file's source in `lib/scan.ts:74-83`. The new extractors run against existing in-memory strings. No new I/O. |
| A Python file with `# coding: utf-8` followed by a regular `# comment` (not a directive) — the coding line is structurally identical to a comment line. | The extractor consumes one optional shebang and one optional coding line, then runs the `#` block extractor. This means a file with `# coding: utf-8\n# Migration for v2.\n` correctly returns "Migration for v2." (the coding line is consumed, the next `#` block is the description). Documented in test scenarios. |

## Documentation / Operational Notes

- **CLAUDE.md** — Unit 5 is the documentation surface.
- **install.sh** — Unit 4 is the prompt surface.
- **README** — none today; not in scope.
- **Rollout** — single PR, no flag, no migration. This is a pure additive scan-time change. Existing tiles continue to render with the same descriptions; new tiles light up.
- **Monitoring** — the daemon and visualizer have no metrics today, so there's nothing to wire. A user who reloads the visualizer and sees previously-blank tiles populate is the success signal.

## Sources & References

- Feature description provided in this `/ce:plan` invocation (no upstream brainstorm doc in `docs/brainstorms/` matched).
- Related code: `lib/scan/descriptions.ts`, `lib/scan/discover.ts`, `lib/scan.ts`, `lib/config.ts`, `install.sh`, `CLAUDE.md`.
- Related learning: `docs/solutions/ui-bugs/description-truncation-and-line-clamp-math-2026-04-30.md` — establishes the "no scan-time truncation, no heuristic fallback" policy this plan inherits.
- External docs: `eemeli/yaml` package on npm (parser of choice for YAML sidecar). No further external research needed; comment syntaxes for SQL/YAML/Python/Ruby/HTML are standardized.
