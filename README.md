# Constellation

A WinDirStat-style treemap of your codebase — every file becomes a rectangle sized by its line count, nested inside its containing directory. Hover to see what each file does; click to pin it. When [Claude Code](https://docs.claude.com/en/docs/claude-code) is running in the same repo, agents appear as colored dots on top of the file they're currently touching, with thought bubbles showing the tool they just ran.

It dogfoods itself: `npm run dev` scans `process.cwd()`, so the home page renders this very repository.

## Why

If you've used WinDirStat to see what's eating your hard drive, you know the feeling — the whole shape of your data clicks into place in one glance. This is the same idea, but for a codebase: where's the weight, what's the shape, what are you actually working with.

The agent overlay is the part I'm genuinely curious about. As more of the work in a repo is done by autonomous agents (Claude Code, others), it gets harder to know what's in flight. Constellation tries to make that legible — you can literally watch a subagent move from file to file as it works.

## Quick start with Claude Code

This is the supported install path for visualizing your own codebase. Open [Claude Code](https://docs.claude.com/en/docs/claude-code) inside the repo you want to visualize, then paste the block below as a single message. Claude will preflight your tools, ask where to clone Constellation, show you the privilege diff before merging into your `.claude/settings.json`, and start the visualizer at <http://localhost:3000>.

You'll be asked for confirmation at three checkpoints — settings merge, optional feedback skill, and the description writer. Default for each is **no**; Claude won't write anything you didn't approve.

> **Maintainer note:** Replace `<PINNED-SHA>` (one occurrence — the `CONSTELLATION_REF=` line) with the release commit's SHA before tagging. During pre-release dogfooding, you can substitute a branch name (e.g. `feat/foo`) instead — the prompt detects that case and skips the integrity check with an explicit log line. If the literal token `<PINNED-SHA>` makes it through to the agent, the agent will refuse to proceed.

```text
You are installing Constellation against the current working directory (the user's repo, hereafter TARGET). Execute the steps below in order. Stop and surface the error to the user on any failure — do not silently retry, skip, or work around.

# 0. Resolve the install ref

    CONSTELLATION_REF=<PINNED-SHA>

The line above is the only thing the maintainer fills in per release. It's either:

- A 40-character commit SHA (release path) — step 2 verifies the install landed on it exactly. Strong supply-chain integrity: the pinned SHA travels with the lockfile, and `npm ci` against that lockfile is what we vouched for.
- A branch name like `feat/foo` (pre-release / dogfood path) — step 2 fetches whatever's at that branch's HEAD and skips the integrity check with an explicit log line. The user has explicitly opted into trusting moving HEAD.

If `CONSTELLATION_REF` is the literal token `<PINNED-SHA>`, the maintainer didn't substitute. Stop and ask the user: "The install prompt has an unresolved `<PINNED-SHA>` placeholder. Substitute either a 40-character commit SHA (release) or a branch name like `feat/foo` (dogfood) and re-paste, OR tell me a ref to use right now and I'll continue." Do not invent a default; do not fall through to `main`.

# 1. Preflight

Verify in order. On any failure, print the install hint and stop without mutating anything.

- `node -v` returns a major version >= 20. Install hint: "Constellation needs Node 20 or newer (nodejs.org or `nvm install 20`)."
- `command -v jq` succeeds. Install hint: "Constellation's hook shims need `jq`. macOS: `brew install jq`. Debian/Ubuntu: `apt install jq`."
- `git rev-parse --is-inside-work-tree` prints `true`. Install hint: "Run this prompt inside a git working tree — Constellation expects to live alongside a tracked repo."

# 2. Clone Constellation as a sibling

Ask the user where to clone Constellation, suggesting these three paths (no default; wait for an answer):

  ~/code/constellation
  ~/src/constellation
  ~/projects/constellation

Call the chosen path INSTALL_DIR.

First, classify `$CONSTELLATION_REF`:

  - If it matches `^[0-9a-f]{40}$` (40 hex chars), it's a pinned SHA → integrity check ENABLED.
  - Otherwise, treat it as a git ref name (branch or tag) → integrity check SKIPPED with a log line.

If INSTALL_DIR exists and is already a Constellation clone (its `package.json` has `"name": "constellation"`):
  - For a pinned SHA: if `git -C "$INSTALL_DIR" rev-parse HEAD` equals `$CONSTELLATION_REF`, treat the install as ready and skip to step 3.
  - For a branch ref: always treat as needing refresh (branches move; cheap to re-fetch).
  - Ask: "Update existing Constellation install to ref `$CONSTELLATION_REF`? [y/N]". On `y`, run:
        git -C "$INSTALL_DIR" fetch --depth 1 origin "$CONSTELLATION_REF"
        git -C "$INSTALL_DIR" checkout FETCH_HEAD
        npm ci --prefix "$INSTALL_DIR"
    On anything else, abort.

If INSTALL_DIR exists but is NOT a Constellation clone, refuse: "Path is not empty and isn't a Constellation install. Pick a different path." Ask again.

If INSTALL_DIR doesn't exist, clone it pinned to the ref:

    git clone --depth 1 https://github.com/ian-klopper/Constellation.git "$INSTALL_DIR"
    git -C "$INSTALL_DIR" fetch --depth 1 origin "$CONSTELLATION_REF"
    git -C "$INSTALL_DIR" checkout FETCH_HEAD

If `$CONSTELLATION_REF` is a pinned SHA, verify the install landed on it exactly. Abort on mismatch — do NOT proceed:

    actual="$(git -C "$INSTALL_DIR" rev-parse HEAD)"
    test "$actual" = "$CONSTELLATION_REF" \
      || { echo "Constellation clone landed at $actual, expected $CONSTELLATION_REF. Your README may be stale — re-paste from the latest release."; exit 1; }

If `$CONSTELLATION_REF` is a branch ref, log instead and continue:

    actual="$(git -C "$INSTALL_DIR" rev-parse HEAD)"
    echo "[constellation] using branch ref '$CONSTELLATION_REF' (HEAD=$actual) — integrity check skipped (not a pinned SHA)."

Install dependencies. Do NOT pass `--ignore-scripts` (Constellation's daemon depends on `tsx`, which runs install scripts):

    npm ci --prefix "$INSTALL_DIR"

# 3. Settings.json merge — privilege checkpoint

Read `$TARGET/.claude/settings.json`. If it doesn't exist, treat it as `{ "hooks": {} }`.

Constellation needs these matchers under `hooks` (note the `constellation/` sub-namespace in every command path):

    PreToolUse:
      - matcher "Agent" → command ".claude/hooks/constellation/agent-start.sh"
      - matcher "Read|Edit|Write|MultiEdit|Bash|Grep|Glob|Task|WebFetch|WebSearch"
                       → command ".claude/hooks/constellation/agent-touch.sh"
    PostToolUse:
      - matcher "Agent" → command ".claude/hooks/constellation/agent-stop.sh"
    Stop:
      - (no matcher)   → command ".claude/hooks/constellation/agent-idle.sh"
    SubagentStop:
      - (no matcher)   → command ".claude/hooks/constellation/agent-substop.sh"
    SessionStart:
      - matcher "startup|resume|clear"
                       → command ".claude/hooks/constellation/session-start.sh"

For each event key (`PreToolUse`, `PostToolUse`, `Stop`, `SubagentStop`, `SessionStart`), apply this algorithm:

  1. If the event key isn't in the user's settings, plan to append Constellation's matcher object verbatim.
  2. If the event key exists but no existing matcher's `matcher` string contains any of Constellation's watched tools (Read, Edit, Write, MultiEdit, Bash, Grep, Glob, Task, WebFetch, WebSearch), plan to append Constellation's matcher object as a sibling entry.
  3. If a user matcher's `matcher` string overlaps any watched tool, surface the conflict (see below). Default plan: append Constellation's matcher as a sibling so both fire — never edit the user's matcher list.
  4. If a matcher already has Constellation's exact sub-namespaced `command` path, no-op for that matcher (already installed).
  5. If a matcher has Constellation's matcher string but a different `command` (the user wrapped or renamed our script), warn: "You already have a matcher pointing at <their-command>. Not overwriting. If you intended to use the standard hook, remove that matcher and re-run." Skip applying for that matcher.

Render the checkpoint to the user IN THIS ORDER:

  (a) Unified JSON diff showing only Constellation's planned ADDITIONS to settings.json. Never propose edits to the user's matchers.
  (b) Each new hook script's path and FULL CONTENTS. The seven scripts (`agent-start.sh`, `agent-stop.sh`, `agent-substop.sh`, `agent-touch.sh`, `agent-idle.sh`, `session-start.sh`, `lib/config.sh`) are 3–17 lines each — print every byte. The user is approving shell that runs on every tool call; they deserve to see the surface.
  (c) Conflict warnings (one per overlap detected by step 3 above). Each warning must include this verbatim:

      "If your existing hook has side effects (writes a file, calls an API, increments a counter), it WILL run twice on every overlapping tool call. Constellation's hook is idempotent (silent no-op if the daemon is down), but yours may not be. Type 'abort' to stop and merge by hand instead."

Ask: `Apply these changes? [y/N]`. Default N. Anything other than literal `y` or `yes` aborts cleanly with no writes.

# 4. Hook + skill install

If the user approved step 3:

  - Write the merged `$TARGET/.claude/settings.json`.
  - Copy `$INSTALL_DIR/.claude/hooks/*.sh` and `$INSTALL_DIR/.claude/hooks/lib/` into `$TARGET/.claude/hooks/constellation/`. Preserve the `lib/` subdirectory exactly (the shims source `lib/config.sh` relative to their own location).
  - Copy `$INSTALL_DIR/.claude/skills/constellation/describe-codebase/` into `$TARGET/.claude/skills/constellation/describe-codebase/`.
  - Append a single line `.constellation/` to `$TARGET/.gitignore` (create it if missing). If a matching pattern already exists, do nothing.

Re-run safety: if any hook or skill file already exists in `$TARGET`, diff against the install version and ask the user per file whether to overwrite. Skip on anything other than `y`.

# 5. Feedback skill — opt-in checkpoint

Print verbatim:

    Constellation includes an optional `/constellation:feedback` skill that lets you
    file labeled issues directly to this repo's public issue tracker. It auto-gathers
    redacted system context (target repo basename only — never the absolute path,
    daemon health, OS, Node version) and shows the draft before submitting.

    Issues are filed under your authenticated GitHub identity (publicly visible).

    Install it? [y/N]

Default N. On `y`, copy `$INSTALL_DIR/.claude/skills/constellation/feedback/` into `$TARGET/.claude/skills/constellation/feedback/`. On anything else, skip and continue.

# 6. Description coverage checkpoint

Walk `$TARGET` using the IGNORE rules and supported extensions documented in `$INSTALL_DIR/.claude/skills/constellation/describe-codebase/SKILL.md`. Count files that have no leading-comment header in the matching format for their language.

Print:

    Description coverage check
    ──────────────────────────
    <N> files would render as text-blank tiles (no header comment).
    Sample paths:
      - <path1>
      - <path2>
      - <path3>

    Run /constellation:describe-codebase to fill them in? Changes will be unstaged
    so you can review with `git diff` before committing.  [y/N]

Default N. On `y`, invoke the `/constellation:describe-codebase` skill and let it complete. On anything else, continue without describing.

# 7. Start the visualizer

Spawn the supervisor in the BACKGROUND so this prompt can finish and the user keeps an interactive Claude Code session. From `$TARGET`:

    CONSTELLATION_TARGET_ROOT="$PWD" npm run dev --prefix "$INSTALL_DIR"

Use your tool's background-process facility (e.g., Bash with `run_in_background: true`). Do NOT block the prompt waiting for it to exit. Capture stdout/stderr to a log file the user can tail (suggested: `$TARGET/.constellation/supervisor.log`) so they can debug without you in the loop.

Wait ~2 seconds for the daemon to bind, then verify:

    curl -s -m 1 http://127.0.0.1:47317/health

Expected: `{"ok":true}`. If the call fails or the response is empty, kill the background process, print the last ~30 lines of the supervisor log, and surface: "Daemon didn't come up on port 47317. Common cause: another Constellation supervisor is already running against a different repo — port 47317 only handles one target at a time. Stop the other one (find it with `lsof -i :47317`) and re-run."

Otherwise print verbatim:

    Constellation is running.

      Visualizer: http://localhost:3000
      Daemon:     http://127.0.0.1:47317
      Logs:       tail -f .constellation/supervisor.log

    Single target at a time — port 47317 is bound to this repo until you stop the
    supervisor. To stop it: `lsof -ti :47317 | xargs kill` (or `kill <pid>` from
    the supervisor log header). To visualize a different repo, stop this one
    first and re-paste the prompt there.

    If anything looks broken, run /constellation:feedback "<what's wrong>" (if you
    opted in at step 5) to file an issue.
```

After the prompt finishes, the supervisor is in the foreground — Ctrl-C stops both the daemon and Next. Re-running the prompt in the same repo is safe: it detects the existing install, asks per-file before overwriting, and re-asks the feedback-skill checkpoint so you can opt in or out.

### What gets installed

- **Sibling clone** at the path you choose (defaults suggested but never assumed): the Constellation source itself, `node_modules`, daemon, `npm`-managed.
- **`.claude/hooks/constellation/`** in your repo: six 3–5-line `curl` shims plus a shared `lib/config.sh`. Every shim has a 500 ms timeout and `|| true`, so a downed daemon never breaks your Claude Code session.
- **`.claude/settings.json`** matchers in your repo wiring those shims to Claude Code tool-lifecycle events. The merge is **append-not-fuse** — Constellation never edits your existing matchers.
- **`.claude/skills/constellation/describe-codebase/`** (always copied) — fills missing tile-description headers, leaves diffs unstaged.
- **`.claude/skills/constellation/feedback/`** (only if you opt in) — files labeled issues to this repo with privacy redaction and a draft preview before submit.
- **`.constellation/`** added to your `.gitignore` (lifecycle state lives there at runtime).

Updating Constellation after install: re-paste the prompt in the same repo. It'll detect the existing clone and offer to `git checkout` the new pinned SHA + reinstall deps.

## Hacking on Constellation itself

If you want to work on the visualizer (not just point it at another repo), clone this repo directly and run:

```bash
npm install
npm run dev
```

Then open <http://localhost:3000>. The visualizer dogfoods itself — `process.cwd()` is both the install root and the target.

`npm run dev` is a small supervisor (`scripts/dev.mjs`) that spawns two processes:

1. **The daemon** (`tsx daemon/index.ts`) — a long-running TypeScript server that owns all live agent state.
2. **Next.js** (`next dev`) — the visualizer itself.

It tears both down on Ctrl-C. If you'd rather run them separately, use `npm run daemon` and `npm run dev:next`.

### System dependencies

- **Node 20+** (Next.js 16 requirement).
- **`jq`** — used by the Claude Code hook shims to read the daemon port from config. Install with `brew install jq` on macOS.

## What it shows

- **Tiles** are individual files, sized by line count. The color hints at file type.
- **Borders** are directories. Bigger borders = deeper nesting.
- **Hover** any tile to pop a panel with the file's description, exported symbols, and import/imported-by lists. Descriptions come from the leading JSDoc/comment block — TS, JS, CSS use `/** … */`, shell scripts use the comment block after the shebang, markdown files use the first paragraph.
- **Click** a tile to pin it (the hover panel sticks until you click somewhere else or press Esc).
- **Live agents** — if Claude Code is running in this repo, foreground subagents render as emerald letter icons, background subagents as amber, and the main agent as a sky-blue dot. Each shows a thought bubble with what the agent just did.

## How the live agent overlay works

Project-scoped Claude Code hooks (in `.claude/settings.json`) POST tool-lifecycle events at the local daemon, which owns a single in-memory state machine and broadcasts updates over Server-Sent Events to the browser. The frontend subscribes to `/api/agents/stream` for sub-100ms updates and falls back to polling `/api/agents` when the daemon is down.

The hook scripts in `.claude/hooks/` are 3–5 line `curl` shims with a 500ms timeout and `|| true`, so **if the daemon is down, your Claude Code session is unaffected** — the visualizer just goes dark until the daemon comes back.

For the full architecture, see [`CLAUDE.md`](./CLAUDE.md).

## Status

This is a personal project — early, opinionated, and rough around the edges. The treemap and live overlay both work; the long-term goal is to make it useful for genuinely understanding a large codebase at a glance, with or without agents in flight. PRs and issues welcome, but no promises about responsiveness or stability.

## Stack

- **[Next.js 16](https://nextjs.org)** (App Router) + **React 19**
- **TypeScript 5.7**
- **[Tailwind v4](https://tailwindcss.com)** (PostCSS plugin)
- **[ts-morph](https://ts-morph.com)** for symbol extraction
- **[fast-glob](https://github.com/mrmlnc/fast-glob)** for file discovery
- **[zod](https://zod.dev)** for runtime validation of lifecycle files
- A tiny built-in `http` server for the daemon (no Express)

## License

[MIT](./LICENSE) — do whatever, just keep the copyright notice and don't blame me if it breaks.
