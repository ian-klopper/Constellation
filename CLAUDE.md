# Constellation

A codebase visualizer built with Next.js 16 (App Router), TypeScript, and Tailwind v4. Scans the repo, extracts top-level exported symbols via `ts-morph`, and renders the codebase as a WinDirStat-style squarified treemap — each file is a rectangle sized proportionally to its line count, nested inside its containing directory. Long-term goal: overlay live AI-agent activity (read/write badges, reasoning callouts) on top of the static map.

The visualizer scans `process.cwd()` and dogfoods itself — the home page renders this very repo. That means this CLAUDE.md is **also** part of the visualization. Keep it accurate: when the architecture, layout, or workflow changes, update this file in the same commit. See *Maintaining this file* below.

## Current snapshot

As of the last update to this file:

- **Stack:** Next.js 16 (App Router) + React 19 + TypeScript 5.7 + Tailwind v4 (PostCSS plugin).
- **Runtime deps:** `ts-morph` (symbol extraction), `fast-glob` (file discovery), `server-only` (guards server modules).
- **System deps:** `jq` (used inside Claude Code hook commands — `brew install jq` on macOS).
- **Source layout** (no `src/` — files live at the repo root):
  - `app/` — App Router entry. `page.tsx` is the home/visualizer route, `layout.tsx` + `globals.css` set up the shell. `api/agents/route.ts` returns the list of currently-running subagents.
  - `lib/` — server-side scanner + layout math. `scan.ts` walks the repo and builds a recursive `DirectoryNode` tree with per-file line counts (sorted children descending by size — precondition for the treemap). `treemap.ts` is a pure squarified-treemap function. `classify.ts` maps TS symbols to `SymbolKind`. `types.ts` is the shared shape (FileNode/DirectoryNode discriminated union, also exports `ActiveAgent`).
  - `components/` — React components. `Visualizer.tsx` is a `"use client"` wrapper that measures its container with `ResizeObserver` and hands width/height to `TreemapNode.tsx`, which recursively switches on `node.kind`: directories run `squarify` over their children's line counts and lay out absolute-positioned child nodes; files render as tiles with `data-path` (the AgentOverlay anchor) plus header + `SymbolRow` list. `ActiveAgents.tsx` (badge bar) and `AgentOverlay.tsx` (moving icons over file tiles) poll `/api/agents` once a second.
- **Live agent visibility:** project-scoped Claude Code hooks in `.claude/settings.json` mirror agent activity to disk under `.constellation/agents/*.json` (gitignored runtime state). All hook scripts live in `.claude/hooks/`.
  - `PreToolUse on Agent` → `agent-start.sh` writes `<tool_use_id>.json` with `kind: "foreground"` or `"background"` (read from `tool_input.run_in_background`).
  - `PostToolUse on Agent` → `agent-stop.sh`. Foreground: deletes the file (the parent's tool returns when the agent finishes). Background: the parent's tool returns immediately at spawn-time, so instead it records the child's `agentId` from `tool_response.agentId` and leaves the file alone for `SubagentStop` to clean up later.
  - `SubagentStop` → `agent-substop.sh` finds the lifecycle file by matching `agentId` and deletes it. This is the universal close for both foreground (where `agentId` is set by lazy-bind during the agent's first Read/Edit/Write) and background (where `agentId` is set by `agent-stop.sh` from `tool_response`).
  - `PreToolUse on Read|Edit|Write|MultiEdit` → `agent-touch.sh`. Subagent calls (`agent_id` non-empty) lazy-bind to the oldest unbound lifecycle file with matching `subagent_type` and update `agentId`, `currentPath`, `lastActiveAt`. Main-agent calls (empty `agent_id`) upsert a persistent `_main.json` (id "main"). Background subagents' own file reads do NOT fire this hook — they run in a separate execution context — so the *transcript watcher* below covers them instead.
  - **Background subagent transcript watcher.** When `agent-stop.sh` handles a BG spawn, it also forks `agent-watch.sh` (detached via `nohup … &`) which polls the BG agent's JSONL transcript at `tool_response.outputFile` once per second, parses Read/Edit/Write tool_use entries, and mirrors the latest file path into the lifecycle file's `currentPath` (relativized against `cwd`). The watcher self-terminates within ~1s of `agent-substop.sh` removing the lifecycle file, so there's no orphan process to clean up.
  - `SessionStart on startup|resume|clear` wipes `.constellation/agents/*.json` so a previous session's stale state doesn't leak into a new one. (Compact is excluded — it happens mid-session, where wiping would erase live state.)
  - The `_*.json` underscore prefix keeps `_main.json` out of subagent bind loops. The 30-min `lastActiveAt ?? startedAt` filter in `/api/agents` is a safety net against any lifecycle file that escapes the explicit cleanup hooks.
  - The file tile in `TreemapNode` carries a `data-path` attribute (relative path from the project root); the overlay anchors icons to those tiles via `document.querySelector('[data-path="…"]')` + `getBoundingClientRect()` and slides between them with a CSS transform transition. **Do not remove the `data-path` attribute** — it's the only contract between the layout and the overlay. Foreground subagents render as emerald letter icons with a thought-bubble; background subagents render the same way in amber so the user can tell which is which; the main agent renders as a sky dot with no bubble. Idle icons park in a dock under the badge bar.
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
