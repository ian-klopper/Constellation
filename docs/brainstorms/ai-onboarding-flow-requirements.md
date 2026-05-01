---
date: 2026-04-30
topic: ai-onboarding-flow
---

# AI-driven onboarding flow for new users

## Problem Frame

Today, the only way a new person can use Constellation against their own codebase is to read the README, clone the repo manually, run `npm install`, copy hooks into their `.claude/`, edit `.claude/settings.json` by hand, install `jq`, and accept that the visualizer will look text-blank because their files lack the leading-comment headers Constellation expects. That's a multi-step, error-prone, manual ritual — and even after they get it working, there's no in-product way to tell us when something's broken.

We want a single copy-pasteable prompt that gets a stranger from "here's a cool tool" to "I'm looking at my own codebase, with descriptions, in the visualizer" without leaving Claude Code. (The feedback skill, below, is scoped to Ian for now and is not part of the stranger-onboarding promise — see Open Questions for whether to add a public feedback variant.)

The flow has three artifacts, with two distinct audiences:

1. **An onboarding prompt** (audience: strangers) that the user pastes into Claude Code to orchestrate the whole install.
2. **A description-writer skill** (`/constellation:describe-codebase`, audience: strangers + Ian) that populates leading-comment headers across the target repo so the visualizer has text to show.
3. **A feedback skill** (`/constellation:feedback`, audience: Ian only — for now) that Ian installs into his other repos when he dogfoods Constellation against them, so he can quickly file an issue back to this repo whenever something breaks. Not bundled with the public onboarding install.

Constellation lives as a **sibling clone** outside the target repo, configured to scan that repo's path. The target repo gets a small footprint added: hooks under `.claude/hooks/`, matchers in `.claude/settings.json`, and (for the public onboarding) the description-writer skill under `.claude/skills/`. The feedback skill is installed separately by Ian into whichever repos he wants to dogfood from.

## Requirements

### Paste-prompt orchestration (P1–P9)

- **P1.** A single, copy-pasteable prompt block lives in the README under a clearly-titled "Quick start with Claude Code" section. Pasting it into Claude Code in any directory (which is treated as the user's repo) starts the full install.
- **P2.** The prompt MUST be self-contained: no prior `git clone`, no prior dependency install, no manual file edits required. The user's only prerequisites are documented system deps (Node 20+, `jq`, `gh` CLI authenticated, Claude Code itself).
- **P3.** The prompt MUST run a preflight check before any mutation: confirm Node version, `jq`, and that the cwd is inside a git working tree (`git rev-parse --is-inside-work-tree`). If any are missing or the cwd is not git-versioned, the agent stops and prints a clear install hint or warning, then exits without modifying anything. (Note: `gh` is **not** part of the public-onboarding preflight — it is only required by the feedback skill, which is not bundled with the public install. The feedback skill checks for `gh` at its own first invocation.)
- **P4.** The prompt asks the user where to clone Constellation. There is no built-in default — many users don't have a conventional code directory, and a wrong default just becomes a confusing question the user has to think about twice. The agent suggests a small set of plausible paths (e.g., `~/code/constellation`, `~/src/constellation`, `~/projects/constellation`) and lets the user pick or override. If the chosen directory already exists, the agent stops and asks the user whether to reuse, update (`git pull`), or pick a new path — never silently overwrites.
- **P5.** The prompt installs Constellation's npm dependencies (`npm install` in the clone dir).
- **P6. Settings checkpoint.** Before mutating the user's `.claude/settings.json`, the agent MUST show the user the exact diff it intends to apply (the new `PreToolUse`, `PostToolUse`, and `SessionStart` matchers, plus any hook entries) and wait for explicit confirmation. If the user already has matchers for any of the watched tools, the agent merges rather than overwriting and surfaces any conflicts in the diff.
- **P7.** The prompt drops hook scripts into the user's `.claude/hooks/constellation/` (sub-namespaced so we don't collide with the user's own hooks) and installs both skills under `.claude/skills/constellation/`.
- **P8. Description checkpoint.** Before invoking the description-writer pass, the agent MUST show the user the count of supported files lacking a leading-comment header, plus a sample of 2–3 representative files it would touch, and wait for explicit confirmation. The user can decline and run `/constellation:describe-codebase` later.
- **P9.** After both checkpoints (or skips), the prompt starts the daemon + Next dev server pointed at the user's repo path and prints the localhost URL with a one-line summary of what to do next ("Hover any tile, click to pin, run `/constellation:feedback` if anything looks wrong").

### Describe-codebase skill (D1–D6)

- **D1.** The skill is invocable as `/constellation:describe-codebase` and accepts an optional path arg (default: scan all of `process.cwd()`, respecting Constellation's existing `IGNORE` list from `lib/scan/discover.ts` so we don't try to describe `node_modules` or build output).
- **D2.** The skill enumerates supported file types (TS/JS/CSS/SH/MD — the same set the description extractor knows how to read) and identifies which lack a leading-comment header in the format Constellation expects.
- **D3.** For each missing-header file, the skill generates a 1–2 sentence description focused on intent (what this file is for, who calls it) — not a restatement of the code. The description follows the language's expected comment style: JSDoc `/** … */` for TS/JS/CSS, leading `# …` block after any shebang for shell, first paragraph for markdown.
- **D4.** The skill MUST NOT overwrite files that already have a leading-comment header in the expected format. If the existing header is in a different format (e.g., a single-line `//` comment in a TS file), the skill leaves it alone and reports it in a "skipped" summary so the user can address manually.
- **D5.** The skill leaves all changes unstaged so the user can review and commit at their own pace. It MUST NOT auto-commit on the user's behalf.
- **D6.** The skill prints a final summary: number of files described, number skipped (with reasons), and any errors. If the visualizer's dev server is already running, the user just refreshes the browser to see the new descriptions.

### Feedback skill (F1–F5) — Ian's dogfood tool

This skill is **not** bundled with the public onboarding install. Ian installs it manually into the `.claude/skills/` of whichever other repo he's currently using to test Constellation. Audience is one person, so the design optimizes for speed over polish.

- **F1.** The skill is invocable as `/constellation:feedback` and accepts a free-form description as its argument. No mandatory follow-up questions — Ian writes what he knows, the skill takes him at his word.
- **F2.** The skill auto-gathers minimal context for the issue body: Constellation version (the cloned repo's git SHA, looked up from the sibling clone path), the **basename only** of the repo being dogfooded against (never the absolute filesystem path — paths routinely encode client/project names that should not land in a public issue), daemon health snapshot (`curl 127.0.0.1:<port>/health`), and OS + Node version. No transcript content, no source file contents.
- **F3.** The skill prints the draft title + body once and submits on a `y/N` confirmation. No multi-turn ceremony.
- **F4.** Submission runs `gh issue create --repo <constellation-repo> --label "via:dogfood"` with the Constellation repo hardcoded into the skill. The label exists so Ian can distinguish dogfood-filed issues from anything else in triage.
- **F5.** If `gh` errors (auth lapsed, network down), the skill dumps the title + body to stdout so Ian can paste manually. No elaborate fallback flow.

## Success Criteria

- A user who has never seen Constellation before can paste the prompt into Claude Code and, within ~5 minutes (excluding the description pass), be looking at their own codebase rendered in the visualizer at `localhost:3000`.
- After the description pass, hovering any tile in their visualizer shows a meaningful 1–2 sentence description, not a bare filename.
- When Ian dogfoods Constellation against another of his repos and hits a bug, he can type `/constellation:feedback "X looks broken"` and have a labeled issue filed on this repo within ~10 seconds, without ever opening a browser.
- The two checkpoints (settings diff, description count) successfully prevent the prompt from making invisible mutations to the user's repo. A user who declines either checkpoint ends up in a clean, recoverable state.
- Re-running the prompt in the same repo is safe: it detects the existing clone, the existing hooks, and the existing skills and offers update-or-skip instead of duplicating.

## Scope Boundaries

- **One Constellation install per machine.** The user can repoint the daemon at different repos by restarting it with a different `--repo` flag, but we are not running multiple daemons in parallel for v1.
- **No multi-language description extraction beyond what Constellation already supports.** If the user's repo is mostly Python or Go, the description-writer skill describes only the TS/JS/CSS/SH/MD files and leaves the rest blank. Expanding language coverage is a separate feature.
- **No transcript attachment in feedback.** Issue bodies contain agent-gathered system context only — no chat content, no file contents. (Privacy posture is moot for an audience of one, but it keeps the skill simple.)
- **Feedback skill is not part of the public onboarding bundle.** It's Ian's personal dogfooding tool, installed by hand into whichever target repo he's testing with. If we ever want to invite real outside users to file feedback, that's a follow-up scope: the skill needs auth-failure handling, draft confirmation, and a privacy review.
- **Not a published npm package.** Sibling clone + supervisor script is the install model. `npx constellation` is a possible future, not part of this scope.
- **No cross-repo memory.** Each repo's `.claude/skills/constellation/` is independent. We don't try to share state across repos the user installs into.

## Prerequisites (Out of Scope but Blocking)

- **License decision.** The README currently says "no license yet — personal repo." Publishing an onboarding flow that invites anyone to clone is effectively a public release, so a permissive license (MIT, Apache 2.0, or similar) needs to be added to the repo before this onboarding can ship publicly. This is a small change, but a true blocker.
- **Scan path becomes a config value.** Today, `lib/scan/discover.ts` and `app/page.tsx` use `process.cwd()` directly. Before sibling-clone install can work, the daemon supervisor (`scripts/dev.mjs`), the scan modules, and the agents API need to accept a `--repo <path>` (or equivalent env var / config field) and pass it through. This is bounded but non-trivial work that has to land before the onboarding prompt can be tested end-to-end.

## Open Questions

- **Settings.json merge strategy.** What should the prompt do if the user already has a `PreToolUse` matcher for `Read|Edit|Write|...` that conflicts with ours? Append our hook to the existing matcher's hook list, or refuse and ask the user to merge manually?
- **Description-writer agent budget.** For a 5,000-file repo, the description pass could be expensive. Do we need a guardrail (e.g., refuse to start if file count > N without explicit override)?
- **Feedback skill install path.** Where does Ian want the feedback skill to live so it's easy to drop into any new dogfood target — `~/.claude/skills/` (user-scoped, available everywhere automatically) or per-repo `.claude/skills/`? User-scoped is one less install step but means it shows up in every Claude session, including unrelated ones.
