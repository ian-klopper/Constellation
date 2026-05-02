// `constellation open` — opens the visualizer in the default browser,
// scoped to the current repo via the ?repo= URL param.
import { spawn } from "node:child_process";
import { canonicalCwd, loadConfig } from "./util.mjs";

export default async function open({ installRoot }) {
  const config = loadConfig(installRoot);
  const url = `http://localhost:${config.web.port}/?repo=${encodeURIComponent(canonicalCwd())}`;
  console.log(`Opening ${url}`);

  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  const proc = spawn(cmd, [url], { stdio: "ignore", detached: true });
  proc.unref();
  return 0;
}
