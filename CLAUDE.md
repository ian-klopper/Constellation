# Constellation

A codebase visualizer built with Next.js 16 + React 19 + TypeScript + Tailwind v4. Scans a repo, extracts top-level exports via `ts-morph`, and renders it as a WinDirStat-style squarified treemap with live AI-agent activity overlaid (icons, trails, tile pulses, an activity rail).

The home page renders `process.cwd()` by default — Constellation visualizes itself. **This CLAUDE.md is part of the visualization**, so keep it accurate. When architecture, layout, or workflow changes, update this file in the same commit.

## Architecture invariants

- **One canonical user dir:** `~/.constellation/` (override via `CONSTELLATION_USER_DIR=<absolute-path>`). Holds `app/` (installed code), `config.json` (runtime config — port, ttl, watched-tools), `repos.json` (registered repos), `state/agents/` (lifecycle files named `<repoHash>__<sessionId>__<agentId>.json`), `daemon.pid`, `logs/`. No per-target `.constellation/` dir for daemon state. Path helpers live in `lib/user-dirs.ts`.
- **Two long-running services**, each its own launchd agent on macOS with `RunAtLoad: true` + `KeepAlive: true`:
  - `com.constellation.daemon.plist` → `dist/daemon/index.js` on port 47317 (events + SSE).
  - `com.constellation.web.plist` → `scripts/web-server.mjs`, which reads `~/.constellation/config.json` at process start and execs `next start -p <web.port>` (default 47318). Port changes don't require service reinstall.
  - Linux has no launchd integration — users run both under their own process manager.
- **Daemon is the single writer** for all lifecycle state. All mutations go through one reducer in `daemon/lifecycle.ts`, keyed by `${sessionId}:${id}` so multi-session in the same repo can't collide. Disk files add a `repoHash` prefix so multi-repo can't collide either. This is *the* reason the old bash hook system could be replaced — no more clobber races by construction.
- **Daemon down ⇒ silent no-op.** Hook shims (`.claude/hooks/*.sh`) are 3–5 line `curl` calls with 500 ms timeout and `|| true`. A dead daemon must never break a Claude Code session. This invariant is non-negotiable.
- **Single source of truth for config:** `~/.constellation/config.json`. `lib/config.ts:loadConfig()` seeds it from the bundled `constellation.config.json` on first boot, then never reads the bundled file again. Bash hooks read the user file via `lib/config.sh`. The watched-tools list must be hand-mirrored into `.claude/settings.json`'s `PreToolUse` matcher (Next.js settings JSON can't be templated); the daemon warns on divergence.
- **Sidecar wins for descriptions.** Two sources: in-file leading comments (`lib/scan/descriptions.ts` — JSDoc/`#`/docstrings/etc. per language) and the generated sidecar at `.constellation/descriptions.{json,yaml,yml}`. Sidecar always wins. The sidecar is populated by `constellation describe`, written incrementally during the run, and broadcast live to open visualizer tabs via SSE.
- **Path canonicalization.** Both CLI and daemon `realpathSync` every `cwd` so macOS's `/tmp` → `/private/tmp` symlink can't double-register a repo.

## Multi-repo, multi-session

One daemon watches every repo whose hooks point at its port. The home page accepts `?repo=<absolute-path>`; `RepoSwitcher` cycles through registered repos *and* idle git worktrees of the current repo (so PR-review "swap to my feature branch" works without leaving the visualizer). `/repos` joins persistent registry + live agent counts; `/repos/active` is lifecycle-derived.

## Project tracker

`roadmap.json` at repo root, schema-enforced by `roadmap.schema.json` (`additionalProperties: false` everywhere — don't invent fields, update the schema in the same commit if you genuinely need a new shape). Move shipped items from `short_term` → `recently_shipped` with `shipped_at` + `commit`. Prune `recently_shipped` after ~2 weeks; git log remembers.

## The compound loop

Each PR teaches the system; the system surfaces what it knows next time Claude edits in the same area. Two hooks + a path-keyed JSON sidecar:

- **Capture** — `description-refresh.sh` (PostToolUse on `Edit|Write|MultiEdit`) nudges the agent to (a) update `.constellation/descriptions.json` if the edit changed what the file is for, and (b) append a `{date, pr, insight}` to `.constellation/learnings.json` under the file path (or `_general`) if the edit revealed something non-obvious. Skip mechanical edits.
- **Recall** — `learnings-surface.sh` (PreToolUse on the same matchers) injects matching learnings (file path + parent dir + most recent `_general`, capped 3 per bucket) as `additionalContext` *before* the edit.
- **Synthesis** — the `synthesize-app` subagent (Opus + ultrathink, Read/Write only) reads only `descriptions.json` and writes a plain-English interpretation + flagged surprises to `.constellation/interpretation.md`. Diff over time = free architectural-drift detector.

The heavy `compound-engineering` plugin is disabled in `.claude/settings.local.json` — this loop replaces its day-to-day function. `docs/brainstorms|plans|solutions/` are frozen institutional history; still read, not regenerated.

## Build & scripts

- `npm run build` = `build:daemon` (tsc → `dist/daemon/index.js`, then `bounce-daemon-if-stale.mjs`) + `build:web` (next build, then `bounce-web-if-stale.mjs`). Both bounce scripts kickstart the matching launchd service iff it is serving from this repo and the on-disk artifact is newer than the running process — a single `npm run build` makes the new code live in both tiers without a manual `launchctl kickstart`. Daemon imports use relative paths (no `@/…`) so compiled output runs without a path-alias bundler.
- `npm run dev` runs `scripts/dev.mjs`, a self-dev supervisor that spawns both daemon (`tsx daemon/index.ts`) and `next dev`. Idempotent — exits cleanly if either is already running. **Self-dev only**; end users get launchd-managed services via `constellation service install`.
- System dep: `jq` (bash hooks read config via it). `brew install jq` on macOS.

## Working with this project

The user is an amateur developer. Lean toward:
- Explaining the *why*, not just the *what*.
- Calling out foot-guns (force-push, rm -rf, destructive SQL) before acting.
- Boring, well-trodden patterns over clever ones.
- Flagging when a quick fix creates future tech debt.

Don't document things derivable from the code itself (file lists, prop names, function signatures) — the visualizer's whole job is to show those. Document *intent*, *constraints*, and *workflow* here.

## Git — aggressive proactive management

- Commit often in small logical units, unsolicited, after each meaningful change. Don't batch unrelated changes.
- Subject ≤72 chars imperative; body explains *why* if non-obvious.
- Stage explicitly with `git add <file>`, never `-A` / `.` (avoid `.env`, build junk, secrets).
- Keep `.gitignore` healthy when new tooling lands.
- Branch for non-trivial work; merge to `main` when done.
- **Never** force-push, `reset --hard`, or `clean -fd` without confirming first.
- **Push only when asked.** Local commits are free; pushes are visible.
- Glance at `git status` / `git log` at session start.

## Maintaining this file

- Update *Architecture invariants* when a top-level dir, major dep, build script, or architectural concept changes.
- Add durable user feedback here (or to memory if user-wide rather than project-specific).
- Update the opening paragraph when a long-term goal lands or shifts.
- Prune stale sections aggressively. Boring and accurate beats comprehensive and wrong.

## Conventions

- Default branch: `main`. Line endings: LF. No trailing whitespace; newline at EOF.
