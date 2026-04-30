# Constellation

A codebase visualizer built with Next.js 16 (App Router), TypeScript, and Tailwind v4. Scans the repo, extracts top-level exported symbols via `ts-morph`, and renders them as a grid of file cards grouped by directory. Long-term goal: overlay live AI-agent activity (read/write badges, reasoning callouts) on top of the static map.

The visualizer scans `process.cwd()` and dogfoods itself — the home page renders this very repo. That means this CLAUDE.md is **also** part of the visualization. Keep it accurate: when the architecture, layout, or workflow changes, update this file in the same commit. See *Maintaining this file* below.

## Current snapshot

As of the last update to this file:

- **Stack:** Next.js 16 (App Router) + React 19 + TypeScript 5.7 + Tailwind v4 (PostCSS plugin).
- **Runtime deps:** `ts-morph` (symbol extraction), `fast-glob` (file discovery), `server-only` (guards server modules).
- **System deps:** `jq` (used inside Claude Code hook commands — `brew install jq` on macOS).
- **Source layout** (no `src/` — files live at the repo root):
  - `app/` — App Router entry. `page.tsx` is the home/visualizer route, `layout.tsx` + `globals.css` set up the shell. `api/agents/route.ts` returns the list of currently-running subagents.
  - `lib/` — server-side scanner. `scan.ts` walks the repo, `classify.ts` maps TS symbols to `SymbolKind`, `types.ts` is the shared shape (also exports `ActiveAgent`).
  - `components/` — React components. Default is server; client components opt in with `"use client"`. `Visualizer.tsx` is the static grid (`DirectoryRegion` → `FileCard` → `SymbolRow` → `Glyph`); `ActiveAgents.tsx` (badge bar) and `AgentOverlay.tsx` (moving icons over file cards) are the client components, both polling `/api/agents` once a second.
- **Live agent visibility:** project-scoped Claude Code hooks in `.claude/settings.json` mirror agent activity to disk under `.constellation/agents/*.json` (gitignored runtime state).
  - `PreToolUse`/`PostToolUse` on `Agent` writes/deletes a per-subagent lifecycle file `<tool_use_id>.json` (id, subagent_type, description, startedAt).
  - `PreToolUse` on `Read|Edit|Write|MultiEdit` runs `.claude/hooks/agent-touch.sh`. When the payload's `agent_id` is non-empty (foreground subagent), it lazy-binds to the oldest unbound lifecycle file with a matching `subagent_type` and updates `agentId`, `currentPath`, `lastActiveAt`. When `agent_id` is empty (the **main** Claude agent), it upserts a single persistent file `_main.json` (id "main") with `currentPath` and `lastActiveAt`. Background subagents run in a separate execution context and don't fire parent hooks.
  - The `_*.json` underscore prefix keeps the main file out of subagent bind loops. Stale entries are filtered by `/api/agents` using `lastActiveAt ?? startedAt > 30 min`, so the main entry self-expires when the session goes idle (no explicit cleanup hook).
  - `FileCard` carries a `data-path` attribute (relative path from the project root); the overlay anchors icons to those cards via `getBoundingClientRect()` and slides between them with a CSS transform transition. Subagents render as emerald letter icons with a thought-bubble description; the main agent renders as a sky dot with no bubble. Idle icons (no current file or path not in the visualization) park in a dock under the badge bar.
- **Scripts:** `npm run dev` / `build` / `start` / `lint`. No test runner yet.

## Maintaining this file

Because Constellation visualizes itself, the model reading this repo (me) needs an accurate map. Treat CLAUDE.md as living docs:

- When you add/remove a top-level directory, a major dependency, a build script, or a new architectural concept, update *Current snapshot* in the same commit.
- When the user gives durable feedback about how we work together, add it to the relevant section here (or to memory if it's user-wide rather than project-specific).
- When a long-term goal lands or shifts, update the opening paragraph.
- Don't let the file balloon. If a section gets stale or rarely-true, prune it. Boring and accurate beats comprehensive and wrong.
- Don't document things derivable from the code itself (file lists, function signatures) — the visualizer's whole job is to show those. Document *intent*, *constraints*, and *workflow*.

## Working with this project

The user is an amateur developer. Lean toward:
- Explaining the *why* behind suggestions, not just the *what*.
- Calling out when something is a foot-gun (force-push, rm -rf, destructive SQL, etc.) before doing it.
- Preferring boring, well-trodden patterns over clever ones.
- Flagging when a "quick fix" will create tech debt later.

## Git — aggressive proactive management

The user has asked me to manage git proactively and aggressively. That means:

- **Commit often, in small logical units.** After any meaningful change (a feature works, a bug is fixed, a refactor is done), commit it without being asked. Don't batch unrelated changes into one commit.
- **Write good commit messages.** Format: short imperative subject (≤72 chars), blank line, then a body explaining the *why* if non-obvious. Reference what changed and why, not how.
- **Stage explicitly.** Use `git add <file>` over `git add -A` / `git add .` to avoid accidentally committing junk (`.env`, build artifacts, secrets).
- **Keep `.gitignore` healthy.** Add entries proactively when new tooling is introduced (node_modules, .venv, dist, .DS_Store, .env*, etc.).
- **Branch for non-trivial work.** Anything bigger than a small fix gets its own branch. Merge back to `main` when done.
- **Never force-push, never `reset --hard`, never `clean -fd` without confirming first.** Even when "managing aggressively," destructive ops always need a heads-up.
- **Push only when asked.** Local commits are free; pushes are visible. Don't `git push` without explicit confirmation.
- **Surface git state.** When starting a session, glance at `git status` / `git log` so I know what's in flight.

## Conventions

- Default branch: `main`.
- Line endings: LF.
- No trailing whitespace; newline at EOF.
