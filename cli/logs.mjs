// `constellation logs [-f]` — print or tail the daemon log.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { userLogPath } from "./util.mjs";

export default async function logs({ args }) {
  const follow = args.includes("-f") || args.includes("--follow");
  const lp = userLogPath();
  if (!existsSync(lp)) {
    console.error(
      `No log at ${lp}. The daemon may not be running yet — try \`constellation status\`.`,
    );
    return 1;
  }
  // Hand off to `tail` so the user gets familiar -f behavior + buffered
  // historical lines. We don't reinvent it.
  const tailArgs = follow ? ["-n", "200", "-F", lp] : ["-n", "200", lp];
  const proc = spawn("tail", tailArgs, { stdio: "inherit" });
  return await new Promise((resolve) => {
    proc.on("exit", (code) => resolve(code ?? 0));
  });
}
