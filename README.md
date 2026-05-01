# Constellation

A WinDirStat-style treemap of your codebase — every file becomes a rectangle sized by its line count, nested inside its containing directory. Hover to see what each file does; click to pin it. When [Claude Code](https://docs.claude.com/en/docs/claude-code) is running in the same repo, agents appear as colored dots on top of the file they're currently touching, with thought bubbles showing the tool they just ran.

It dogfoods itself: `npm run dev` scans `process.cwd()`, so the home page renders this very repository.

## Why

If you've used WinDirStat to see what's eating your hard drive, you know the feeling — the whole shape of your data clicks into place in one glance. This is the same idea, but for a codebase: where's the weight, what's the shape, what are you actually working with.

The agent overlay is the part I'm genuinely curious about. As more of the work in a repo is done by autonomous agents (Claude Code, others), it gets harder to know what's in flight. Constellation tries to make that legible — you can literally watch a subagent move from file to file as it works.

## Quick start

In any git working tree (the codebase you want to visualize), run:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/ian-klopper/Constellation/main/install.sh)
```

Run it in your shell — not inside Claude Code's `!` mode, where the script can't read your replies. (The script detects this and bails out with a hint.) The `bash <(…)` form (instead of `curl … | bash`) keeps the script's stdin attached to your terminal so prompts work in IDE terminals that don't expose `/dev/tty`.

The script preflights Node 20+, `jq`, and git, asks where to clone Constellation as a sibling, installs its dependencies, and copies hook shims and skills into your repo's `.claude/`. **It does not touch your `.claude/settings.json`.**

For that last step, if [Claude Code](https://docs.claude.com/en/docs/claude-code)'s `claude` CLI is on your PATH, the script offers to launch it in plan mode with the merge prompt already loaded — Claude shows you the JSON diff to `settings.json` and the full contents of every hook script before writing anything, then starts the visualizer at <http://localhost:47318>. (If `claude` isn't on PATH, the script prints the prompt for you to paste manually.)

To update Constellation later, just run the same line again — the script detects the existing clone and offers to fetch the latest `main`.

For non-interactive use (CI, scripted setups), set `CONSTELLATION_INSTALL_DIR=<absolute-path>` to skip the install-dir prompt.

### What gets installed

- **Sibling clone** at the path you choose: Constellation's own source + `node_modules`, outside your repo.
- **`.claude/hooks/constellation/`** in your repo — six 3–5-line `curl` shims with a 500ms timeout and `|| true`, so a downed daemon never breaks your Claude Code session.
- **`.claude/settings.json`** matchers (only after your approval) — appended, never edited in place.
- **`.claude/skills/constellation/{describe-codebase,feedback}/`** — inert until you invoke them. Run `/constellation:describe-codebase` to populate tile descriptions; `/constellation:feedback` to file an issue here.
- **`.constellation/`** appended to your `.gitignore` (lifecycle state lives there at runtime).

## Hacking on Constellation itself

If you want to work on the visualizer (not just point it at another repo), clone this repo directly and run:

```bash
npm install
npm run dev
```

Then open <http://localhost:47318>. The visualizer dogfoods itself — `process.cwd()` is both the install root and the target.

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
