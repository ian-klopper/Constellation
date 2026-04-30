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
  - `lib/` — server-side scanner + layout math. `scan.ts` walks the repo and builds a recursive `DirectoryNode` tree with per-file line counts (sorted children descending by size — precondition for the treemap), the leading JSDoc block of each file as `description`, and a per-file import graph (`imports` + reverse-indexed `importedBy`, internal files only — npm packages are filtered out). `treemap.ts` is a pure squarified-treemap function. `classify.ts` maps TS symbols to `SymbolKind`. `types.ts` is the shared shape (FileNode/DirectoryNode discriminated union, also exports `ActiveAgent`).
  - `components/` — React components. `Visualizer.tsx` is a `"use client"` wrapper that measures its container with `ResizeObserver`, holds the hovered-file state, and hands width/height plus the hover state down to `TreemapNode.tsx`, which recursively switches on `node.kind`: directories run `squarify` over their children's line counts and lay out absolute-positioned child nodes; files render as tiles with `data-path` (the AgentOverlay anchor) plus a filename header and a 1–2 sentence description. On hover, the hovered tile gets a strong border, files it imports glow blue, files that import it glow amber, and the rest dim — and `HoverPanel.tsx` (fixed bottom-left) shows the file's full description, its exports (rendered with `SymbolRow`), and its incoming/outgoing import lists. `AgentOverlay.tsx` (moving icons over file tiles) polls `/api/agents` once a second.
  - **File descriptions** come from a leading `/** … */` JSDoc block at the top of each source file. Add one to every new file — the regex strips `*` line prefixes, drops anything from the first `@tag` onward, and truncates at ~240 chars. No header → the tile shows just the filename. Don't write heuristic fallbacks; a wrong description is worse than none for the vibecoder this map is built for.
- **Live agent visibility:** project-scoped Claude Code hooks in `.claude/settings.json` mirror agent activity to disk under `.constellation/agents/*.json` (gitignored runtime state). All hook scripts live in `.claude/hooks/`.
  - `PreToolUse on Agent` → `agent-start.sh` writes `<tool_use_id>.json` with `kind: "foreground"` or `"background"` (read from `tool_input.run_in_background`).
  - `PostToolUse on Agent` → `agent-stop.sh`. Foreground: deletes the file (the parent's tool returns when the agent finishes). Background: the parent's tool returns immediately at spawn-time, so instead it records the child's `agentId` from `tool_response.agentId` and leaves the file alone for `SubagentStop` to clean up later.
  - `SubagentStop` → `agent-substop.sh` finds the lifecycle file by matching `agentId` and deletes it. This is the universal close for both foreground (where `agentId` is set by lazy-bind during the agent's first Read/Edit/Write) and background (where `agentId` is set by `agent-stop.sh` from `tool_response`).
  - `PreToolUse on Read|Edit|Write|MultiEdit|Bash|Grep|Glob|Task|WebFetch|WebSearch` → `agent-touch.sh`. Subagent calls (`agent_id` non-empty) lazy-bind to the oldest unbound lifecycle file with matching `subagent_type` and update `agentId`, `status: "active"`, `currentActivity` (a one-line human-readable string formatted by `lib/activity.sh` — e.g. `"Reading AgentOverlay.tsx"`, `` "Running `git status`" ``, `"Searching for 'foo'"`), `lastActiveAt`, and (for file tools) `currentPath`. Main-agent calls (empty `agent_id`) upsert a persistent `_main.json` (id "main") with the same fields. Background subagents' own file reads do NOT fire this hook — they run in a separate execution context — so the *transcript watchers* below cover them instead. `TodoWrite`, `Skill`, `BashOutput`, etc. are deliberately not in the matcher; they're not user-meaningful "doing something" events.
  - `PostToolUse on the same set` → `agent-idle.sh` flips `status: "idle"`. `Stop` → same hook, marks `_main.json` idle when the main agent's turn ends. The lifecycle file is **not** deleted — `currentPath` and `currentActivity` are preserved so the icon stays anchored and the bubble shows what just finished, just dimmed (the frontend debounces idle for 600ms to swallow brief between-tool flickers).
  - **Background subagent transcript watcher.** When `agent-stop.sh` handles a BG spawn, it also forks `agent-watch.sh` (detached via `nohup … &`) which polls the BG agent's JSONL transcript at `tool_response.outputFile` once per second, parses any surfaced tool_use entry, formats it via `lib/activity.sh`, and writes `currentActivity` (and `currentPath` for file tools) into the lifecycle file. If no new tool_use lands within 3s it flips `status: "idle"`. Self-terminates within ~1s of `agent-substop.sh` removing the lifecycle file.
  - **Main-agent transcript watcher.** `agent-touch.sh` lazy-spawns `agent-main-watch.sh` on the first main-agent tool call (deduped via `pgrep` against `transcript_path` so `/resume` doesn't double-spawn). It tails the main JSONL at 1Hz and writes (a) `currentActivity` from the latest tool_use (redundant with `agent-touch.sh` but unifies the idle clock) and (b) `currentMessage` — the first sentence of the latest assistant `text` block, so the bubble narrates real prose during text-generation stretches between tool calls. Self-terminates when `_main.json` disappears (SessionStart cleanup).
  - **Activity formatter** lives in `.claude/hooks/lib/activity.sh` as a sourced bash function `format_activity <tool_name> <tool_input_json>`. All three writers (`agent-touch.sh`, `agent-watch.sh`, `agent-main-watch.sh`) source it so bubble strings are identical no matter who wrote them.
  - `SessionStart on startup|resume|clear` wipes `.constellation/agents/*.json` so a previous session's stale state doesn't leak into a new one. (Compact is excluded — it happens mid-session, where wiping would erase live state.)
  - The `_*.json` underscore prefix keeps `_main.json` out of subagent bind loops. The 30-min `lastActiveAt ?? startedAt` filter in `/api/agents` is a safety net against any lifecycle file that escapes the explicit cleanup hooks.
  - The file tile in `TreemapNode` carries a `data-path` attribute (relative path from the project root); the overlay anchors icons to those tiles via `document.querySelector('[data-path="…"]')` + `getBoundingClientRect()` and slides between them with a CSS transform transition (eased with `cubic-bezier(0.22, 1, 0.36, 1)` plus a 350ms opacity fade for mount/unmount). **Do not remove the `data-path` attribute** — it's the only contract between the layout and the overlay. Foreground subagents render as emerald letter icons with a thought-bubble; background subagents render the same way in amber so the user can tell which is which; the main agent renders as a sky dot — and **also gets a bubble** now that `currentActivity`/`currentMessage` carry real text. Bubble text precedence: `currentActivity` → `currentMessage` → `description` → `subagent_type`. Idle icons park in a row at the top-right of the page; agents whose `status: "idle"` persists ≥600ms dim to ~55% opacity in place (no re-park, no teleport — they keep their last `currentPath` so it's clear where they were last working).
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
