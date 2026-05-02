// `constellation help` — prints a list of subcommands.

const HELP = `
constellation — visualize a codebase and the AI agents working in it

Usage:
  constellation <command> [options]

Repo management:
  add                 Wire the current repo into Constellation: copy hook
                      shims, merge .claude/settings.json, register with
                      the daemon. Run from inside the repo's git root.
  rm                  Unregister the current repo. Hooks/settings are
                      left in place; pass --purge to remove them too.
  list                Show the registered repos and their live status.

Daemon control:
  status              Print daemon health, registered repo count, log path.
  start, stop, service, logs — coming in a follow-up commit (launchd).

Visualizer:
  open                Open the visualizer in your browser, scoped to cwd.

Aliases: rm/remove, list/ls.
`;

export default async function help() {
  process.stdout.write(HELP.trimStart());
  return 0;
}
