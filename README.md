# Constellation

A WinDirStat-style treemap of your codebase — every file becomes a rectangle sized by its line count, nested inside its containing directory. Hover to see what each file does in plain English; click to pin it. When [Claude Code](https://docs.claude.com/en/docs/claude-code) is running in the same repo, agents appear as colored dots on top of the file they're currently touching, with thought bubbles showing the tool they just ran.

## Why

If you've used WinDirStat to see what's eating your hard drive, you know the feeling — the whole shape of your data clicks into place in one glance. This is the same idea, but for a codebase: where's the weight, what's the shape, what are you actually working with.

The agent overlay is the part I'm genuinely curious about. As more of the work in a repo is done by autonomous agents (Claude Code, others), it gets harder to know what's in flight. Constellation tries to make that legible — you can literally watch a subagent move from file to file as it works.

## Install (one-time)

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/ian-klopper/Constellation/main/install.sh)
```

Run it in your shell — not inside Claude Code's `!` mode, where the script can't read prompts. The `bash <(…)` form (instead of `curl … | bash`) keeps stdin attached to your terminal so confirmations work in IDE terminals.

What it does:

1. **Clones** Constellation into `~/.constellation/app/` (override with `CONSTELLATION_INSTALL_DIR=<absolute-path>`).
2. **Builds** the daemon (`npm ci` + `npm run build:daemon`).
3. **Symlinks** the `constellation` CLI onto your PATH (`/usr/local/bin/` if writable, else `~/.local/bin/` with a PATH-update hint).
4. **On macOS**, registers a launchd agent at `~/Library/LaunchAgents/com.constellation.daemon.plist` so the background daemon starts at login and survives reboots. On Linux, you run the daemon under your own process manager.

Re-run the same line later to update — the script detects an existing install and pulls the latest `main`.

### System dependencies

- **Node 20+** (Next.js 16 requirement).
- **`jq`** — used by the Claude Code hook shims. Install with `brew install jq` on macOS, `apt install jq` on Debian/Ubuntu.
- **git** — needed for the install + update flow.

## Use it on a repo

Once installed, in any repo you want to track:

```bash
cd path/to/your/repo
constellation add
```

This copies hook shims into `.claude/hooks/constellation/`, prints a unified-JSON diff against your `.claude/settings.json` (and the full text of every hook script that will run on your tool calls) for you to confirm, registers the repo with the daemon, and appends the right `.gitignore` lines.

It then asks **"Generate descriptions now? \[Y/n\]"** — say yes and pick a model:

```
Pick a model:
  1) haiku    fastest and cheapest, lower quality
  2) sonnet   recommended balance (default)
  3) opus     slowest and priciest, highest quality

Choice (1/2/3, or 'n' to cancel) [2]:
```

Constellation runs `claude -p` under a strict plain-English tone prompt and writes one short description per file to `.constellation/descriptions.json`. The sidecar is committed (un-ignored from `.constellation/`), so collaborators get the descriptions for free.

You can re-run this any time:

```bash
constellation describe              # only fills missing files
constellation describe --force      # regenerate every file
constellation describe --model opus # pre-pick a model, no menu
```

There's also a `PostToolUse` hook on Edit/Write/MultiEdit that nudges the active Claude Code agent to keep its description fresh whenever a file's purpose changes — no background work, no daemon round-trip, just a one-line message in the agent's next turn.

Open the visualizer scoped to the current repo:

```bash
constellation open
```

It opens `http://localhost:47318/?repo=<your-repo-path>` in your default browser.

## All commands

```
constellation add          Wire the current repo into Constellation.
constellation rm           Unregister it (--purge also removes hook shims).
constellation list         Show registered repos and their live status.
constellation describe     Generate plain-English descriptions for every
                           file in the current repo (--force, --model).
constellation open         Open the visualizer in your browser, scoped
                           to the current repo.

constellation status       Daemon health + registered-repo count.
constellation start        Load the launchd agent (Mac).
constellation stop         Unload the launchd agent (Mac).
constellation service      install / uninstall the launchd plist.
constellation logs [-f]    Print (or tail) the daemon log.

constellation help         Full reference.
```

## What you see

- **Tiles** are individual files, sized by line count. Color hints at file type.
- **Borders** are directories. Bigger borders = deeper nesting.
- **Hover** any tile to pop a panel with the file's plain-English description, exported symbols, and import / imported-by lists. Descriptions come from `.constellation/descriptions.json` first, falling back to the file's leading JSDoc/comment header.
- **Click** a tile to pin it (the hover panel sticks until you click somewhere else or press Esc).
- **Live agents** — if Claude Code is running in this repo, foreground subagents render as emerald letter icons, background subagents as amber, and the main agent as a sky-blue dot. Each shows a thought bubble with what the agent just did.

## How the live agent overlay works

Project-scoped Claude Code hooks in `.claude/settings.json` POST tool-lifecycle events at the local daemon, which owns a single in-memory state machine and broadcasts updates over Server-Sent Events to the browser. The frontend subscribes to `/api/agents/stream` for sub-100ms updates and falls back to polling `/api/agents` when the daemon is down.

The hook scripts are 3–5 line `curl` shims with a 500ms timeout and `|| true`, so **if the daemon is down, your Claude Code session is unaffected** — the visualizer just goes dark until the daemon comes back. There's one extra hook (`description-refresh.sh`) that doesn't talk to the daemon at all — it nudges the active agent to update the file's description in `.constellation/descriptions.json` after an edit.

For the full architecture, see [`CLAUDE.md`](./CLAUDE.md).

## Hacking on Constellation itself

If you want to work on the visualizer (not just point it at another repo), clone this repo directly and run:

```bash
npm install
npm run dev
```

Then open <http://localhost:47318>. The visualizer dogfoods itself — `process.cwd()` is both the install root and the target.

`npm run dev` is a small supervisor (`scripts/dev.mjs`) that spawns the daemon (`tsx daemon/index.ts`) alongside Next.js (`next dev`) and tears both down on Ctrl-C. If you'd rather run them separately, use `npm run daemon` and `npm run dev:next`.

End users running the global install never use `npm run dev` — their daemon runs under launchd.

## Status

This is a personal project — early, opinionated, and rough around the edges. The treemap, the live overlay, and the auto-described tiles all work. The long-term goal is to make it useful for genuinely understanding a large codebase at a glance, with or without agents in flight. PRs and issues welcome, but no promises about responsiveness or stability.

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
