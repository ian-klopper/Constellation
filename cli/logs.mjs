// `constellation logs [-f] [--web]` — print or tail Constellation's logs.
// Defaults to the daemon log; pass --web for the visualizer website log.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { userLogPath, userWebLogPath } from "./util.mjs";

export default async function logs({ args }) {
  const follow = args.includes("-f") || args.includes("--follow");
  const wantWeb = args.includes("--web");
  const lp = wantWeb ? userWebLogPath() : userLogPath();
  const label = wantWeb ? "visualizer website" : "background process";
  if (!existsSync(lp)) {
    console.error(
      `No log at ${lp}. The ${label} may not be running yet — try \`constellation status\`.`,
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
