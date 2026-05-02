// `constellation help` — prints a list of subcommands.

const HELP = `
constellation — visualize a codebase and the AI agents working in it

Usage:
  constellation <command> [options]

Repo management:
  add                 Wire the current repo into Constellation: copy hook
                      shims, merge .claude/settings.json, register with
                      the daemon. Run from inside the repo's git root.
                      Prompts to generate plain-English descriptions
                      (--no-describe to skip).
  rm                  Unregister the current repo. Hooks/settings are
                      left in place; pass --purge to remove them too.
  list                Show the registered repos and their live status.
  describe            Generate plain-English descriptions for every file
                      in the current repo and write them to
                      .constellation/descriptions.json. Skips files
                      already covered. Flags:
                        --force, -f            regenerate every file
                        --yes, -y              skip the confirm prompt
                        --model, -m haiku|sonnet|opus  (default sonnet)

Daemon control:
  status              Print daemon health, registered repo count, log path.
  start               Load Constellation's launchd agent (Mac).
  stop                Unload Constellation's launchd agent (Mac).
  service install     Install the launchd plist + run the daemon at login.
  service uninstall   Tear down the launchd plist.
  logs [-f]           Print (or tail) ~/.constellation/logs/daemon.log.

Visualizer:
  open                Open the visualizer in your browser, scoped to cwd.

Aliases: rm/remove, list/ls.
`;

export default async function help() {
  process.stdout.write(HELP.trimStart());
  return 0;
}
