// `constellation add` — wires the current repo into Constellation:
// copies hook shims, runs the deterministic settings.json merge, then
// POSTs /repos/register to the daemon.
//
// Idempotent: re-running it on the same repo is a safe no-op (the hook
// copy prompts on diffs, the settings merger detects already-present
// matchers, /repos/register returns created:false).
import { spawn } from "node:child_process";
import { copyFile, mkdir, readdir, chmod } from "node:fs/promises";
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import {
  canonicalCwd,
  loadConfig,
  openInBrowser,
  postDaemon,
} from "./util.mjs";

const HOOK_SUBDIR = ".claude/hooks/constellation";
const ALLOWED_MODELS = new Set(["haiku", "sonnet", "opus"]);
const DESCRIBE_PROMPT_TIMEOUT_MS = 30_000;

export default async function add({ installRoot, args }) {
  const target = canonicalCwd();
  if (target === installRoot) {
    console.error(
      "You're inside the Constellation install. To register a different " +
        "repo, cd into that repo first, then run `constellation add`.",
    );
    return 1;
  }

  let flags;
  try {
    flags = parseFlags(args);
  } catch (err) {
    console.error(err.message);
    return 64;
  }

  console.log(`Adding ${target} to Constellation...`);
  console.log("");

  await copyHooks(installRoot, target);
  appendGitignore(target);
  const settingsCode = await runSettingsMerge(installRoot, target, flags);
  if (settingsCode !== 0) {
    console.error(
      "Settings merge declined or failed. Hooks are copied; re-run when ready.",
    );
    return settingsCode;
  }

  try {
    const result = await postDaemon(installRoot, "/repos/register", {
      path: target,
    });
    if (result?.created) {
      console.log(`✓ Registered ${target} with the daemon.`);
    } else {
      console.log(`✓ Daemon already had ${target} registered.`);
    }
  } catch (err) {
    console.error(`! ${err.message}`);
    console.error(
      "  Hooks are copied and settings are merged — Constellation will " +
        "auto-register this repo on the first hook event when the daemon " +
        "comes up.",
    );
  }

  const dashboardUrl = buildDashboardUrl(installRoot, target);

  if (!flags.noDescribe) {
    await maybeRunDescribe({ installRoot, target, flags, dashboardUrl });
  }

  console.log("");
  if (interactive(flags)) {
    console.log(`Opening dashboard: ${dashboardUrl}`);
    openInBrowser(dashboardUrl);
  } else {
    console.log(`Done. Open ${dashboardUrl} to view.`);
  }
  return 0;
}

function parseFlags(args) {
  const flags = {
    noDescribe: false,
    yes: false,
    model: null,
    modelExplicit: false,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--no-describe") flags.noDescribe = true;
    else if (a === "--yes" || a === "-y") flags.yes = true;
    else if (a === "--model" || a === "-m") {
      const v = args[++i];
      if (!v || !ALLOWED_MODELS.has(v)) {
        throw new Error(
          `--model must be one of: ${[...ALLOWED_MODELS].join(", ")} ` +
            `(got ${JSON.stringify(v ?? "")}).`,
        );
      }
      flags.model = v;
      flags.modelExplicit = true;
    } else if (a.startsWith("--model=")) {
      const v = a.slice("--model=".length);
      if (!ALLOWED_MODELS.has(v)) {
        throw new Error(
          `--model must be one of: ${[...ALLOWED_MODELS].join(", ")} ` +
            `(got ${JSON.stringify(v)}).`,
        );
      }
      flags.model = v;
      flags.modelExplicit = true;
    }
  }
  return flags;
}

// "Interactive" means we should prompt humans and auto-open browsers.
// Three things make a run non-interactive:
//   1. --yes was passed (caller has already decided everything).
//   2. CLAUDECODE=1 — we're being driven by a Claude Code agent's Bash
//      tool. The agent has no way to type at a prompt or see a browser
//      tab, and Claude Code wraps Bash in a pty so process.stdin.isTTY
//      lies. CLAUDECODE is the documented escape hatch.
//   3. stdin is not a TTY (CI, piped input, the install.sh handoff).
function interactive(flags) {
  if (flags.yes) return false;
  if (process.env.CLAUDECODE === "1") return false;
  if (!process.stdin.isTTY) return false;
  return true;
}

function buildDashboardUrl(installRoot, target) {
  const config = loadConfig(installRoot);
  return `http://localhost:${config.web.port}/?repo=${encodeURIComponent(target)}`;
}

async function maybeRunDescribe({ installRoot, target, flags, dashboardUrl }) {
  console.log("");
  console.log(
    "Constellation can generate plain-English, one-sentence descriptions",
  );
  console.log(
    "for every file in this repo (using Claude Code). Without them, tiles",
  );
  console.log("on the visualizer just show their filename.");
  console.log("");

  // Non-interactive paths: either skip with a hint, or run with --yes.
  if (!interactive(flags)) {
    if (flags.yes) {
      announceDashboardBeforeDescribe(dashboardUrl);
      const describeArgs = ["describe", "--yes"];
      if (flags.modelExplicit) describeArgs.push("--model", flags.model);
      const describe = await import("./describe.mjs");
      const code = await describe.default({ installRoot, args: describeArgs });
      if (code !== 0) {
        console.log("");
        console.log(
          "Descriptions weren't generated. Re-run `constellation describe` " +
            "from this repo once the issue above is fixed.",
        );
      }
      return;
    }
    console.log(
      "Skipping description generation (running non-interactively). Run " +
        "`constellation describe` later, or pass --yes to generate now.",
    );
    return;
  }

  const answer = await promptYesNoWithTimeout(
    "Generate descriptions now? [Y/n]: ",
    DESCRIBE_PROMPT_TIMEOUT_MS,
  );
  if (answer === "timeout") {
    console.log("");
    console.log(
      "No answer in 30s — skipping. Run `constellation describe` whenever " +
        "you want them.",
    );
    return;
  }
  if (answer !== "" && !/^y(es)?$/i.test(answer)) {
    console.log(
      "Skipped. Run `constellation describe` whenever you want them.",
    );
    return;
  }

  announceDashboardBeforeDescribe(dashboardUrl);
  // Don't pass --yes here — let describe show its own model picker so
  // the user can choose haiku/sonnet/opus as part of this flow.
  const describe = await import("./describe.mjs");
  const code = await describe.default({ installRoot, args: ["describe"] });
  if (code !== 0) {
    console.log("");
    console.log(
      "Descriptions weren't generated. Re-run `constellation describe` " +
        "from this repo once the issue above is fixed.",
    );
  }
}

// Print the dashboard URL and open it before the long describe run, so
// the user can watch descriptions pop in live instead of staring at a
// black-box spinner.
function announceDashboardBeforeDescribe(dashboardUrl) {
  console.log("");
  console.log(`Opening dashboard: ${dashboardUrl}`);
  console.log(
    "Descriptions will fill in live as Claude works — keep this tab open.",
  );
  console.log("");
  openInBrowser(dashboardUrl);
}

// readline.question with a wall-clock timeout. If the user (or, more
// likely, an unfortunate caller in a half-pty context where isTTY lies)
// doesn't answer within timeoutMs, resolve with the sentinel "timeout"
// so the caller can default-skip instead of hanging forever.
async function promptYesNoWithTimeout(question, timeoutMs) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let timer;
  try {
    const answer = await Promise.race([
      rl.question(question).then((s) => s.trim()),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve("timeout"), timeoutMs);
      }),
    ]);
    return answer;
  } finally {
    if (timer) clearTimeout(timer);
    rl.close();
  }
}

async function copyHooks(installRoot, target) {
  const srcDir = path.join(installRoot, ".claude/hooks");
  const dstDir = path.join(target, HOOK_SUBDIR);
  const libSrc = path.join(srcDir, "lib");
  const libDst = path.join(dstDir, "lib");

  await mkdir(dstDir, { recursive: true });
  await mkdir(libDst, { recursive: true });

  const top = await readdir(srcDir, { withFileTypes: true });
  for (const ent of top) {
    if (!ent.isFile() || !ent.name.endsWith(".sh")) continue;
    const dst = path.join(dstDir, ent.name);
    await copyFile(path.join(srcDir, ent.name), dst);
    await chmod(dst, 0o755);
  }

  if (existsSync(libSrc)) {
    const lib = await readdir(libSrc, { withFileTypes: true });
    for (const ent of lib) {
      if (!ent.isFile() || !ent.name.endsWith(".sh")) continue;
      const dst = path.join(libDst, ent.name);
      await copyFile(path.join(libSrc, ent.name), dst);
    }
  }

  console.log(`✓ Copied hook shims into ${HOOK_SUBDIR}/`);
}

function appendGitignore(target) {
  const gi = path.join(target, ".gitignore");
  // Ignore Constellation's runtime state, but commit the generated
  // descriptions sidecar so collaborators see them without re-running
  // `constellation describe`. The pattern is `.constellation/*` (not
  // `.constellation/`) because git won't recurse into a fully-ignored
  // directory, so a `!` negate against a file inside it would be a no-op.
  const block = [
    ".constellation/*",
    "!.constellation/descriptions.json",
    "!.constellation/descriptions.yaml",
    "!.constellation/descriptions.yml",
  ];
  if (existsSync(gi)) {
    const existing = readFileSync(gi, "utf8");
    const lines = existing.split(/\r?\n/);
    const present = block.filter((l) => lines.includes(l));
    if (present.length === block.length) return;
    const missing = block.filter((l) => !lines.includes(l));
    appendFileSync(
      gi,
      (existing.endsWith("\n") ? "" : "\n") + missing.join("\n") + "\n",
      "utf8",
    );
    console.log(
      `✓ Updated .gitignore (${missing.length} Constellation line${missing.length === 1 ? "" : "s"} added)`,
    );
  } else {
    appendFileSync(gi, block.join("\n") + "\n", "utf8");
    console.log(`✓ Created .gitignore with Constellation rules`);
  }
}

function runSettingsMerge(installRoot, target, flags) {
  const args = [
    path.join(installRoot, "scripts/install-settings.mjs"),
    "--install-root",
    installRoot,
    "--target-root",
    target,
  ];
  // Pass --yes through so the agent-safe path of `constellation add
  // --yes` doesn't dead-end at the settings merger's own y/N prompt.
  if (flags.yes) args.push("--yes");
  return new Promise((resolve) => {
    const proc = spawn("node", args, { stdio: "inherit" });
    proc.on("exit", (code) => resolve(code ?? 1));
  });
}
