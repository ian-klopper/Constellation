# Constellation

See your codebase as a WinDirStat-style treemap with live Claude Code agents flying across the files they're touching.

## What it looks like

<!-- TODO: add screenshot of the treemap with a couple of agents on it -->

Every file is a rectangle sized by its line count, nested inside its directory. Hover any tile for a plain-English description, exported symbols, and import lists; click to pin the panel. When [Claude Code](https://docs.claude.com/en/docs/claude-code) is running in the same repo, foreground subagents render as emerald letter icons, background subagents as amber, and the main agent as a sky-blue dot — each shows a thought bubble with what it just did.

## Install

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/ian-klopper/Constellation/main/install.sh)
```

Run it in your shell — not inside Claude Code's `!` mode, where the script can't read prompts. It clones Constellation, builds the daemon, symlinks the `constellation` CLI onto your PATH, and on macOS registers a launchd agent so the daemon starts at login and survives reboots. The installer offers to install any missing dependencies (Node 20+, `jq`, `git`) via Homebrew on macOS or `apt`/`dnf`/`pacman`/`apk` on Linux. Re-run the same line later to update.

## Use it

In any repo you want to track:

```bash
cd path/to/your/repo
constellation add      # wires up Claude Code hooks + generates descriptions
constellation open     # opens the visualizer in your browser
```

`constellation add` prints a unified diff against your `.claude/settings.json` for you to confirm, then asks if it should generate plain-English descriptions for every file. Pick `sonnet` for the recommended balance — it runs `claude -p` under a tone prompt and writes the results to `.constellation/descriptions.json`. The sidecar is committed, so collaborators get the descriptions for free, and a `PostToolUse` hook keeps each file's description fresh as Claude Code edits it.

## Troubleshooting

- **Visualizer shows nothing.** The daemon may be down. Run `constellation status`; if it's stopped, `constellation start`.
- **`constellation: command not found`** after install. The CLI was symlinked into `~/.local/bin/`, which isn't on your PATH. Add `export PATH="$HOME/.local/bin:$PATH"` to your shell rc.
- **Agents don't appear when Claude Code runs.** Re-run `constellation add` in that repo — the hooks may not have made it into `.claude/settings.json`.
- **Port 47318 already in use.** Edit `~/.constellation/config.json` and set `web.port` to a free port.
- **Install fails because Node is too old.** The installer won't shadow your version manager. Run `nvm install 20` (or your equivalent), then re-run the install line.

<details>
<summary>Engineering details</summary>

### Why

If you've used WinDirStat to see what's eating your hard drive, you know the feeling — the whole shape of your data clicks into place in one glance. Constellation does the same for a codebase: where's the weight, what's the shape, what are you actually working with.

The agent overlay is the part I'm most curious about. As more of the work in a repo is done by autonomous agents (Claude Code and others), it gets harder to know what's in flight. Constellation tries to make that legible — you can literally watch a subagent move from file to file as it works.

### What `install.sh` does

1. Clones Constellation into `~/.constellation/app/` (override with `CONSTELLATION_INSTALL_DIR=<absolute-path>`).
2. Builds the daemon (`npm ci` + `npm run build:daemon`).
3. Symlinks the `constellation` CLI onto your PATH (`/usr/local/bin/` if writable, else `~/.local/bin/` with a PATH-update hint).
4. On macOS, writes `~/Library/LaunchAgents/com.constellation.daemon.plist` so the daemon starts at login. On Linux, you run the daemon under your own process manager.

The dependency install prompts are gated y/N with default Yes — press Enter to accept. Set `CONSTELLATION_AUTO_INSTALL=1` to skip the prompts (useful in CI), or `CONSTELLATION_NO_AUTO_INSTALL=1` to disable auto-install entirely. The `bash <(…)` form (instead of `curl … | bash`) keeps stdin attached to your terminal so confirmations work in IDE terminals.

### CLI reference

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

`constellation describe` re-runs the description pass: no flags only fills missing files, `--force` regenerates everything, `--model haiku|sonnet|opus` skips the menu.

### How the live agent overlay works

Project-scoped Claude Code hooks in `.claude/settings.json` POST tool-lifecycle events at a local daemon, which owns a single in-memory state machine and broadcasts updates over Server-Sent Events to the browser. The frontend subscribes to `/api/agents/stream` for sub-100ms updates and falls back to polling `/api/agents` when the daemon is down.

The hook scripts are 3–5 line `curl` shims with a 500ms timeout and `|| true`, so if the daemon is down, your Claude Code session is unaffected — the visualizer just goes dark until the daemon comes back. One extra hook (`description-refresh.sh`) doesn't talk to the daemon at all — it nudges the active agent to update the file's description in `.constellation/descriptions.json` after an edit.

Full architecture lives in [`CLAUDE.md`](./CLAUDE.md).

### Hacking on Constellation itself

To work on the visualizer (not just point it at another repo), clone this repo directly:

```bash
npm install
npm run dev
```

Then open <http://localhost:47318>. The visualizer dogfoods itself — `process.cwd()` is both the install root and the target.

`npm run dev` runs a small supervisor (`scripts/dev.mjs`) that spawns the daemon (`tsx daemon/index.ts`) alongside Next.js (`next dev`) and tears both down on Ctrl-C. To run them separately: `npm run daemon` and `npm run dev:next`. End users running the global install never use `npm run dev` — their daemon runs under launchd.

### Stack

- [Next.js 16](https://nextjs.org) (App Router) + React 19
- TypeScript 5.7
- [Tailwind v4](https://tailwindcss.com) (PostCSS plugin)
- [ts-morph](https://ts-morph.com) for symbol extraction
- [fast-glob](https://github.com/mrmlnc/fast-glob) for file discovery
- [zod](https://zod.dev) for runtime validation of lifecycle files
- A tiny built-in `http` server for the daemon (no Express)

### Status

This is a personal project — early, opinionated, and rough around the edges. The treemap, the live overlay, and the auto-described tiles all work. The long-term goal is to make it useful for genuinely understanding a large codebase at a glance, with or without agents in flight. PRs and issues welcome, but no promises about responsiveness or stability.

</details>

## License

[MIT](./LICENSE) — do whatever, just keep the copyright notice and don't blame me if it breaks.
