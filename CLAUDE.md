# Constellation

A codebase visualizer built with Next.js 16 (App Router), TypeScript, and Tailwind v4. Scans the repo, extracts top-level exported symbols via `ts-morph`, and renders the codebase as a WinDirStat-style squarified treemap — each file is a rectangle sized proportionally to its line count, nested inside its containing directory. Long-term goal: overlay live AI-agent activity (read/write badges, reasoning callouts) on top of the static map.

The visualizer scans `process.cwd()` and dogfoods itself — the home page renders this very repo. That means this CLAUDE.md is **also** part of the visualization. Keep it accurate: when the architecture, layout, or workflow changes, update this file in the same commit. See *Maintaining this file* below.

## Current snapshot

As of the last update to this file:

- **Stack:** Next.js 16 (App Router) + React 19 + TypeScript 5.7 + Tailwind v4 (PostCSS plugin).
- **Runtime deps:** `ts-morph` (symbol extraction), `fast-glob` (file discovery), `zod` (lifecycle-file validation), `server-only` (guards server modules).
- **Dev deps that matter:** `tsx` (runs the daemon entry without a build step).
- **System deps:** `jq` (used by the hook curl shims to read the daemon port from config — `brew install jq` on macOS).
- **Single source of truth for runtime config:** `constellation.config.json` at the repo root holds the lifecycle-state directory, the daemon port, the watched-tools list, and the agent-staleness TTL. TS callers read it via `lib/config.ts`; bash hooks read it via `.claude/hooks/lib/config.sh`. The watched-tools list still has to be hand-mirrored into `.claude/settings.json`'s `PreToolUse` matcher (Next.js settings JSON can't be templated), and the daemon logs a warning if the two diverge.
- **Source layout** (no `src/` — files live at the repo root):
  - `app/` — App Router entry. `page.tsx` is the home/visualizer route, `layout.tsx` + `globals.css` set up the shell. `api/agents/route.ts` proxies the daemon's snapshot (with disk fallback when the daemon is down). `api/agents/stream/route.ts` pipes the daemon's SSE stream through to the browser.
  - `lib/` — server-side scanner + layout math + shared config/types/constants. `scan.ts` is now a thin orchestrator (~70 lines) that calls into pure phases under `lib/scan/`: `discover.ts` (file globbing + TS vs other split), `symbols.ts` (ts-morph exported declarations), `imports.ts` (project-internal import graph + reverse index), `descriptions.ts` (leading-comment extractors), `tree.ts` (FileNode assembly + directory tree + `countTree`). `treemap.ts` is a pure squarified-treemap function. `classify.ts` maps TS symbols to `SymbolKind`. `types.ts` is the shared shape, including a zod `ActiveAgentSchema` whose inferred type is the runtime contract for lifecycle files. `constants.ts` centralizes UI sizing/timing/tints. `config.ts` reads `constellation.config.json` (intentionally not `server-only` — the daemon imports it).
  - `daemon/` — the long-running TypeScript process that owns lifecycle state. `index.ts` is the entry; `lifecycle.ts` is the in-memory state machine (single writer, all mutations through one reducer); `transcripts.ts` watches background and main JSONL transcripts; `activity.ts` is the verbatim TS port of the old `lib/activity.sh` formatter; `server.ts` is a tiny built-in `http` server (no Express); `sse.ts` broadcasts snapshots to subscribers; `disk-sync.ts` debounces 50ms-per-id atomic writes; `atomic-write.ts` does the temp-file + rename. The daemon listens on `127.0.0.1:<config.daemon.port>` (default 47317) and writes `<config.stateDir>/*.json` so the legacy disk-fallback path keeps working.
  - `components/` — React components. `Visualizer.tsx` is a `"use client"` wrapper that measures its container with `ResizeObserver`, owns hovered/mousePos local state, computes the import-graph sets, and wraps its children in `<HoverContext.Provider>` and `<TileRegistryProvider>`. `TreemapNode.tsx` recursively renders directories (squarify) and file tiles (which read hover state from `useHover()` and register their DOM element via `useRegisterTile(node.path)`). `AgentOverlay.tsx` is a thin orchestrator (~70 lines) that composes four hooks (`useAgentStream`, `useAgentLifecycle`, `useAgentPositions`, `useIdleClock`) and renders `<AgentIcon />` + `<AgentBubble />`. `HoverPanel.tsx` (fixed bottom-left) shows the hovered file's full description, exports, and import lists. `data-path` is preserved as a redundant escape hatch but is no longer the wire-level contract — the formal one is `TileRegistry`.
  - `hooks/` — frontend hooks. `useAgentStream.ts` (EventSource subscription with exponential-backoff reconnect, one-shot poll fallback during the backoff window), `useAgentLifecycle.ts` (mountedAt/removingAt fade tracking), `useAgentPositions.ts` (reads `TileRegistry`, recomputes on agent-list/registry/resize/scroll changes), `useIdleClock.ts` (single setInterval re-render so `now - lastActiveAt` can be compared against `IDLE_DEBOUNCE_MS`).
  - `scripts/dev.mjs` — `npm run dev` runs this supervisor instead of `next dev` directly. It spawns `tsx daemon/index.ts` (idempotent: skipped if `.constellation/daemon.pid` points to a live process) and `next dev` side by side, forwards stdio, and shuts both down on Ctrl-C.
  - **What gets visualized.** The `IGNORE` list in `lib/scan/discover.ts` is the source of truth — it skips `node_modules`, build output (`.next`, `dist`, `out`, `build`), `.git`, runtime state (`.constellation`, `.claude/worktrees`, `.claude/settings.local.json`), generated/binary files (`*.tsbuildinfo`, `.DS_Store`, common image/font/archive extensions), `next-env.d.ts`, and `package-lock.json` (tracked in git but excluded here because at thousands of lines it would dwarf real source). Everything else — TS, shell, markdown, JSON, CSS, configs, dotfiles like `.gitignore` and `.claude/settings.json` — becomes a tile.
  - **File descriptions.** TS/JS/CSS files use a leading `/** … */` JSDoc block; shell scripts (`.sh`) use the leading `# …` comment block after the shebang; markdown files use the first paragraph below any heading. Anything else (JSON, lockfiles, `.gitignore`) shows just its filename. Add a JSDoc/comment header to every new TS/JS/CSS/shell file — the extractor strips comment prefixes, drops anything from the first JSDoc tag onward, and truncates at ~240 chars. Don't write heuristic fallbacks; a wrong description is worse than none for the vibecoder this map is built for.
- **Live agent visibility:** project-scoped Claude Code hooks in `.claude/settings.json` POST events at the daemon, which owns all lifecycle writes. Hook scripts live in `.claude/hooks/` and are 3–5 line `curl` shims around `127.0.0.1:<port>/event/<name>` with a 500ms timeout and `|| true` — **daemon down ⇒ silent no-op ⇒ Claude Code session keeps working**. That invariant is the whole reason the bash system could be replaced.
  - Hook → daemon mapping: `agent-start.sh` → `/event/agent-start`, `agent-stop.sh` → `/event/agent-stop`, `agent-substop.sh` → `/event/subagent-stop`, `agent-touch.sh` → `/event/touch`, `agent-idle.sh` → `/event/idle`, `session-start.sh` → `/event/session-start` (also `rm -f`s the state dir as belt-and-suspenders cleanup in case the daemon was down at session boot).
  - `PreToolUse on Agent` (start): daemon creates an in-memory entry, sets `kind: "foreground"` or `"background"` from `tool_input.run_in_background`, schedules an atomic disk write of `<tool_use_id>.json` (or `_main.json` for the main agent — the underscore prefix is preserved purely for legacy fallback compatibility, since the daemon doesn't need it).
  - `PostToolUse on Agent` (stop): foreground spawns delete the entry. Background spawns stash the child's `agentId` from `tool_response.agentId` and leave the entry alone — `SubagentStop` cleans up later via `agentId` match. Background spawns also kick off a transcript watcher (`daemon/transcripts.ts:watchBackground`) that tails the JSONL at `tool_response.outputFile` and forwards tool_use entries into the lifecycle reducer; idle flips after 3s of no new tool_use.
  - `PreToolUse on Read|Edit|Write|MultiEdit|Bash|Grep|Glob|Task|WebFetch|WebSearch` (touch): daemon lazy-binds subagents (find by `agentId`, else find oldest unbound entry of matching `subagent_type`), upserts the main agent (id `"main"`), formats `currentActivity` via `daemon/activity.ts`, and (for file tools) sets `currentPath` relative to `cwd`. The first main-agent touch also kicks off `daemon/transcripts.ts:watchMain` so `currentMessage` (first sentence of the latest assistant text block) gets populated during text-generation stretches between tool calls.
  - `PostToolUse on the same set` and `Stop`: daemon flips `status: "idle"`. The entry is **not** removed — `currentPath` and `currentActivity` survive so the icon stays anchored and the bubble shows what just finished, just dimmed. The frontend debounces idle for 600ms to swallow between-tool flickers.
  - `SessionStart on startup|resume|clear`: daemon clears in-memory state and disk-syncs the deletes; the shim also wipes `.constellation/agents/*.json` directly. (`compact` is excluded — it happens mid-session, where wiping would erase live state.)
  - **Why this isn't bash anymore:** the daemon is the single writer for every lifecycle field, so the old `agent-touch` / `agent-watch` / `agent-idle` clobber races are impossible by construction. Lazy-bind happens in-memory, so a foreground subagent that finishes before any tool call still cleans up correctly. Transcript watchers are managed by `Set<string>` membership in `daemon/transcripts.ts`, not pgrep.
  - **Frontend wiring:** `AgentOverlay` subscribes to `/api/agents/stream` (SSE) for sub-100ms updates. If the daemon is down, the SSE endpoint returns 503 and `useAgentStream` falls back to a one-shot `/api/agents` poll while it backs off and retries. `/api/agents` itself proxies the daemon when up and reads the on-disk JSON when not — that fallback path is what keeps the visualizer alive across daemon restarts. Foreground subagents render as emerald letter icons with a thought-bubble; background subagents render in amber; the main agent renders as a sky dot, also with a bubble. Bubble text precedence: `currentActivity` → `currentMessage` → `description` → `subagent_type`. Idle agents dim to ~55% opacity in place (no teleport).
- **Scripts:** `npm run dev` (supervisor: spawns daemon + Next), `dev:next` (Next only, no daemon — useful when the user already has the daemon running), `daemon` (bare daemon entry), `build`, `start`, `lint`. No test runner yet.

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
