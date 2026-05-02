// `constellation rm` — unregisters the current repo from the daemon.
// Hooks and settings.json entries are left in place; pass --purge to
// also remove them. The daemon stops tracking the repo immediately,
// but if hooks remain, future events from this repo will auto-register
// it again.
import { rm } from "node:fs/promises";
import path from "node:path";
import { canonicalCwd, postDaemon } from "./util.mjs";

export default async function remove({ installRoot, args }) {
  const purge = args.includes("--purge");
  const target = canonicalCwd();

  try {
    const result = await postDaemon(installRoot, "/repos/unregister", {
      path: target,
    });
    if (result?.removed) {
      console.log(`✓ Unregistered ${target} from the daemon.`);
    } else {
      console.log(`(Daemon didn't have ${target} registered.)`);
    }
  } catch (err) {
    console.error(`! ${err.message}`);
    if (!purge) return 1;
  }

  if (purge) {
    const hookDir = path.join(target, ".claude/hooks/constellation");
    await rm(hookDir, { recursive: true, force: true });
    console.log(`✓ Removed ${hookDir}/`);
    console.log(
      "  Note: settings.json was NOT touched — open it and remove the " +
        "Constellation matchers manually if you want them gone.",
    );
  } else {
    console.log("");
    console.log(
      "Hooks and .claude/settings.json are unchanged. Pass --purge to " +
        "remove the hook scripts (settings.json still needs hand-editing).",
    );
  }
  return 0;
}
