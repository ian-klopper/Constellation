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

Service control:
  status              Print daemon + visualizer health, registered repo
                      count, log paths.
  start               Start the Constellation daemon and visualizer.
                      Auto-installs launchd agents on first run, then
                      waits until both ports are listening (Mac).
  stop                Stop the Constellation daemon and visualizer (Mac).
  service install     Install both launchd plists + run them at login.
  service uninstall   Tear down both launchd plists.
  logs [-f] [--web]   Print (or tail) the daemon log; pass --web for the
                      visualizer website log.

Visualizer:
  open                Open the visualizer in your browser, scoped to cwd.

Aliases: rm/remove, list/ls.
`;

export default async function help() {
  process.stdout.write(HELP.trimStart());
  return 0;
}
