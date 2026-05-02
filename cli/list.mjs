// `constellation list` — shows the registered repos and their live state.
import { canonicalCwd, getDaemon, relTime } from "./util.mjs";

export default async function list({ installRoot }) {
  let payload;
  try {
    payload = await getDaemon(installRoot, "/repos");
  } catch (err) {
    console.error(`! ${err.message}`);
    return 1;
  }

  const repos = Array.isArray(payload?.repos) ? payload.repos : [];
  if (repos.length === 0) {
    console.log("No repos registered. Run `constellation add` from a repo's root to start tracking it.");
    return 0;
  }

  const cwd = canonicalCwd();
  const widthName = Math.max(...repos.map((r) => r.repoName.length), 4);
  console.log(`${repos.length} repo${repos.length === 1 ? "" : "s"} registered:`);
  console.log("");
  for (const r of repos) {
    const here = r.repoPath === cwd ? "★" : " ";
    const name = r.repoName.padEnd(widthName);
    const status =
      r.agentCount > 0
        ? `active · ${r.sessionCount} session${r.sessionCount === 1 ? "" : "s"} · ${r.agentCount} agent${r.agentCount === 1 ? "" : "s"} · ${relTime(r.lastActiveAt)}`
        : "idle";
    console.log(`${here} ${name}  ${r.repoPath}`);
    console.log(`  ${" ".repeat(widthName)}  ${status}`);
  }
  return 0;
}
