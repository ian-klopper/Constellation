#!/usr/bin/env node
/**
 * Settings-merge utility for the Constellation installer. Reads the
 * canonical hook matchers from <install-root>/.claude/settings.json,
 * rewrites their command paths into the .claude/hooks/constellation/
 * sub-namespace, and merges the result into the user's
 * <target-root>/.claude/settings.json under the existing
 * append-not-fuse rule (each Constellation matcher lands as a sibling
 * entry; user matchers are never edited in place). Prints a unified
 * JSON diff plus the full contents of every hook script that will run,
 * then writes atomically on a y/N confirmation.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`Bad argument: ${key} ${value ?? ""}`);
    }
    args[key.slice(2)] = value;
  }
  return args;
}

const { "install-root": installRoot, "target-root": targetRoot } = parseArgs(
  process.argv.slice(2),
);
if (!installRoot || !targetRoot) {
  console.error(
    "usage: install-settings.mjs --install-root <path> --target-root <path>",
  );
  process.exit(64);
}

const HOOK_NAMESPACE = ".claude/hooks/constellation";
const installSettingsPath = path.join(installRoot, ".claude/settings.json");
const targetSettingsPath = path.join(targetRoot, ".claude/settings.json");
const config = JSON.parse(
  await readFile(path.join(installRoot, "constellation.config.json"), "utf8"),
);
const watchedTools = new Set(config.watchedTools);

// Rewrite a command path from .claude/hooks/<x>.sh →
// .claude/hooks/constellation/<x>.sh. Idempotent: if the path is already
// namespaced (or anything else), leave it alone.
function namespacedCommand(cmd) {
  const m = cmd.match(/^\.claude\/hooks\/([^/]+\.sh)$/);
  return m ? `${HOOK_NAMESPACE}/${m[1]}` : cmd;
}

function rewriteMatcher(matcher) {
  return {
    ...matcher,
    hooks: matcher.hooks.map((h) => ({
      ...h,
      command: namespacedCommand(h.command),
    })),
  };
}

// Tool overlap: split each matcher's "matcher" string on "|", check
// against the watchedTools set. The matcher can be missing/empty for
// event keys like Stop/SubagentStop where Claude Code applies the hook
// to every event.
function toolsIn(matcherString) {
  if (!matcherString) return new Set();
  return new Set(matcherString.split("|").map((s) => s.trim()).filter(Boolean));
}

function overlapsWatched(matcherString) {
  for (const t of toolsIn(matcherString)) {
    if (watchedTools.has(t)) return true;
  }
  return false;
}

// Merge produces:
//   - merged: the new settings.json contents
//   - additions: rewritten matchers we added (for hook-script printing)
//   - conflicts: { event, userMatcher, ourMatcher, overlap[] }
//   - skipped: matchers we no-op'd because the user already had our exact command
function merge(userSettings, installSettings) {
  const merged = structuredClone(userSettings);
  if (!merged.hooks) merged.hooks = {};

  const additions = [];
  const conflicts = [];
  const skipped = [];

  for (const [event, ourMatchers] of Object.entries(
    installSettings.hooks ?? {},
  )) {
    const ourRewritten = ourMatchers.map(rewriteMatcher);
    const userMatchers = (merged.hooks[event] ??= []);

    for (const ours of ourRewritten) {
      const ourCommands = new Set(ours.hooks.map((h) => h.command));
      const alreadyPresent = userMatchers.some(
        (um) =>
          um.matcher === ours.matcher &&
          um.hooks?.some((h) => ourCommands.has(h.command)),
      );
      if (alreadyPresent) {
        skipped.push({ event, matcher: ours.matcher });
        continue;
      }

      // Detect overlap with any existing user matcher under this event.
      // We don't fuse — we just flag and append as a sibling.
      const overlapping = userMatchers.filter((um) => {
        if (!overlapsWatched(ours.matcher)) return false;
        const userTools = toolsIn(um.matcher);
        for (const t of toolsIn(ours.matcher)) {
          if (userTools.has(t)) return true;
        }
        return false;
      });
      if (overlapping.length > 0) {
        conflicts.push({
          event,
          ourMatcher: ours.matcher,
          userMatchers: overlapping.map((m) => m.matcher),
          overlap: [...toolsIn(ours.matcher)].filter((t) =>
            overlapping.some((m) => toolsIn(m.matcher).has(t)),
          ),
        });
      }

      userMatchers.push(ours);
      additions.push({ event, matcher: ours });
    }
  }

  return { merged, additions, conflicts, skipped };
}

function stableStringify(obj) {
  return JSON.stringify(obj, null, 2);
}

// Use `git diff --no-index` for a real unified diff with hunk handling.
// Git is already a system dep (the installer requires it before reaching
// this script), so we never hit the fallback in practice.
async function unifiedDiff(beforeText, afterText, label) {
  const tmpDir = await mkdtemp(path.join(tmpdir(), "constellation-diff-"));
  const beforePath = path.join(tmpDir, "before.json");
  const afterPath = path.join(tmpDir, "after.json");
  await writeFile(beforePath, beforeText, "utf8");
  await writeFile(afterPath, afterText, "utf8");
  try {
    return await runGitDiff(beforePath, afterPath, label);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

function runGitDiff(beforePath, afterPath, label) {
  const colorFlag = process.stdout.isTTY ? "--color=always" : "--no-color";
  const result = spawnSync(
    "git",
    [
      "diff",
      "--no-index",
      "--no-prefix",
      colorFlag,
      "-U3",
      beforePath,
      afterPath,
    ],
    { encoding: "utf8" },
  );
  // git diff --no-index exits 1 when files differ — that's the success
  // case here. Anything else (>=2) is an actual error.
  if (result.error || (result.status !== 0 && result.status !== 1)) {
    return `(git diff failed: ${result.error?.message ?? `exit ${result.status}`})\n${result.stderr ?? ""}`;
  }
  // Strip git's diff/index/file-path header lines and replace with our own
  // label so the user sees ".claude/settings.json" instead of the temp paths.
  const lines = result.stdout.split("\n");
  const hunkStart = lines.findIndex((l) => l.startsWith("@@"));
  const body = hunkStart === -1 ? result.stdout : lines.slice(hunkStart).join("\n");
  return [`--- ${label} (current)`, `+++ ${label} (proposed)`, body.trimEnd()].join(
    "\n",
  );
}

function uniqueHookCommands(additions) {
  const set = new Set();
  for (const { matcher } of additions) {
    for (const h of matcher.hooks) set.add(h.command);
  }
  return [...set];
}

async function readUserSettings() {
  if (!existsSync(targetSettingsPath)) return {};
  const raw = await readFile(targetSettingsPath, "utf8");
  if (raw.trim() === "") return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error(
      `Couldn't parse ${targetSettingsPath} as JSON: ${err.message}`,
    );
    process.exit(1);
  }
}

const userSettings = await readUserSettings();
const installSettings = JSON.parse(await readFile(installSettingsPath, "utf8"));
const { merged, additions, conflicts, skipped } = merge(
  userSettings,
  installSettings,
);

if (additions.length === 0) {
  if (skipped.length > 0) {
    console.log(
      `All Constellation matchers already present in ${targetSettingsPath}. Nothing to do.`,
    );
    process.exit(0);
  }
  console.log(
    `No matchers to add (install settings file at ${installSettingsPath} has no hooks?).`,
  );
  process.exit(0);
}

const before = stableStringify(userSettings);
const after = stableStringify(merged);

console.log("");
console.log(`=== Diff to ${targetSettingsPath} ===`);
console.log(await unifiedDiff(before, after, ".claude/settings.json"));

console.log("");
console.log("=== Hook scripts that will run on every matched tool call ===");
for (const cmd of uniqueHookCommands(additions)) {
  const abs = path.join(targetRoot, cmd);
  console.log("");
  console.log(`--- ${cmd} ---`);
  if (!existsSync(abs)) {
    console.log(`(missing — installer didn't copy this hook?)`);
    continue;
  }
  console.log(readFileSync(abs, "utf8").trimEnd());
}

if (conflicts.length > 0) {
  console.log("");
  console.log("=== Overlap warning ===");
  for (const c of conflicts) {
    console.log(
      `${c.event}: your existing matcher ${JSON.stringify(c.userMatchers.join(", "))} overlaps with Constellation's ${JSON.stringify(c.ourMatcher)} on tool(s): ${c.overlap.join(", ")}.`,
    );
  }
  console.log(
    "Both hooks will fire on overlapping tool calls. Constellation's hook is a 500ms curl with `|| true`, so it's a silent no-op when the daemon is down. If your existing hook has side effects (writes, network, counters), they will run twice on overlap. Hit `n` and merge by hand if that's not what you want.",
  );
}

if (skipped.length > 0) {
  console.log("");
  console.log(
    `(Skipped ${skipped.length} matcher(s) already present in your settings.)`,
  );
}

if (!process.stdin.isTTY) {
  console.error("");
  console.error(
    "Settings merge needs an interactive prompt; stdin is not a TTY. Re-run from a terminal.",
  );
  process.exit(2);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = (await rl.question("\nApply this diff? [y/N]: ")).trim();
rl.close();

if (!/^y(es)?$/i.test(answer)) {
  console.log(
    "Settings unchanged. Re-run the installer when ready, or merge manually using the diff above.",
  );
  process.exit(2);
}

await mkdir(path.dirname(targetSettingsPath), { recursive: true });
const tmpPath = `${targetSettingsPath}.tmp`;
await writeFile(tmpPath, after + "\n", "utf8");
await rename(tmpPath, targetSettingsPath);

console.log(
  `Wrote ${targetSettingsPath} (${additions.length} hook${additions.length === 1 ? "" : "s"} added).`,
);
