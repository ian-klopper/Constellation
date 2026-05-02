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
import { canonicalCwd, postDaemon } from "./util.mjs";

const HOOK_SUBDIR = ".claude/hooks/constellation";

export default async function add({ installRoot, args }) {
  const target = canonicalCwd();
  if (target === installRoot) {
    console.error(
      "You're inside the Constellation install. To register a different " +
        "repo, cd into that repo first, then run `constellation add`.",
    );
    return 1;
  }

  const noDescribe = args.includes("--no-describe");

  console.log(`Adding ${target} to Constellation...`);
  console.log("");

  await copyHooks(installRoot, target);
  appendGitignore(target);
  const settingsCode = await runSettingsMerge(installRoot, target);
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

  if (!noDescribe) {
    await maybeRunDescribe(installRoot);
  }

  console.log("");
  console.log(
    "Done. Open http://localhost:47318/?repo=" +
      encodeURIComponent(target) +
      " to view.",
  );
  return 0;
}

async function maybeRunDescribe(installRoot) {
  console.log("");
  console.log(
    "Constellation can generate plain-English, one-sentence descriptions",
  );
  console.log(
    "for every file in this repo (using Claude Code). Without them, tiles",
  );
  console.log("on the visualizer just show their filename.");
  console.log("");
  if (!process.stdin.isTTY) {
    console.log(
      "Skipping description generation (stdin is not a TTY). Run " +
        "`constellation describe` later to generate them.",
    );
    return;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(
    "Generate descriptions now? [Y/n]: ",
  )).trim();
  rl.close();
  if (answer !== "" && !/^y(es)?$/i.test(answer)) {
    console.log(
      "Skipped. Run `constellation describe` whenever you want them.",
    );
    return;
  }
  const describe = await import("./describe.mjs");
  await describe.default({ installRoot, args: ["describe", "--yes"] });
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
  const line = ".constellation/";
  if (existsSync(gi)) {
    const existing = readFileSync(gi, "utf8");
    if (existing.split(/\r?\n/).includes(line)) return;
    appendFileSync(
      gi,
      existing.endsWith("\n") ? `${line}\n` : `\n${line}\n`,
      "utf8",
    );
    console.log(`✓ Appended ${line} to .gitignore`);
  } else {
    appendFileSync(gi, `${line}\n`, "utf8");
    console.log(`✓ Created .gitignore with ${line}`);
  }
}

function runSettingsMerge(installRoot, target) {
  return new Promise((resolve) => {
    const proc = spawn(
      "node",
      [
        path.join(installRoot, "scripts/install-settings.mjs"),
        "--install-root",
        installRoot,
        "--target-root",
        target,
      ],
      { stdio: "inherit" },
    );
    proc.on("exit", (code) => resolve(code ?? 1));
  });
}
