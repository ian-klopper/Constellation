/**
 * Lists every git worktree attached to a repo (including the main
 * checkout). Used by the home page so the top-left switcher can cycle
 * through worktrees the daemon hasn't seen — worktrees are typically
 * idle scratch dirs with no active Claude session, so they wouldn't
 * otherwise show up.
 */
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";

export function listWorktrees(repoPath: string): string[] {
  let raw: string;
  try {
    raw = execFileSync("git", ["worktree", "list", "--porcelain"], {
      cwd: repoPath,
      encoding: "utf8",
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return [];
  }

  const paths: string[] = [];
  for (const line of raw.split("\n")) {
    if (!line.startsWith("worktree ")) continue;
    const p = line.slice("worktree ".length).trim();
    if (!p) continue;
    try {
      paths.push(realpathSync(p));
    } catch {
      // Worktree dir vanished from disk — skip.
    }
  }
  return paths;
}
