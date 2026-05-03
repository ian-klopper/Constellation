// `constellation describe` — fills .constellation/descriptions.json with
// one-sentence plain-English descriptions for every file in the repo, by
// running `claude -p` with a strict tone prompt. Re-runs are cheap by
// default (skip files already covered); pass --force to regenerate
// everything.
//
// Called directly by users and re-used by `cli/add.mjs` after a fresh
// repo registration. Pass --yes to skip the interactive confirm (used
// from `add`, which has already confirmed).
import { spawn } from "node:child_process";
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { canonicalCwd } from "./util.mjs";

const SIDECAR_PATH = ".constellation/descriptions.json";
const TONE_PROMPT_PATH = "cli/description-tone.txt";
const COST_CAP_USD = 5;
const ALLOWED_MODELS = new Set(["haiku", "sonnet", "opus"]);
const DEFAULT_MODEL = "sonnet";
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// Mirrors lib/scan/discover.ts:IGNORE. Kept simple — substring checks
// instead of glob patterns. If something here drifts, the visible
// symptom is "describe missed a file" or "describe described a build
// artifact"; both are easy to spot.
const IGNORE_DIR_SEGMENTS = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "out",
  "build",
  ".constellation",
]);
const IGNORE_PATH_FRAGMENTS = [".claude/worktrees/"];
const IGNORE_FILE_NAMES = new Set([
  ".DS_Store",
  "next-env.d.ts",
  "package-lock.json",
  "settings.local.json",
]);
const IGNORE_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg", ".webp", ".bmp",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".pdf", ".zip", ".gz", ".tar", ".exe", ".dmg",
  ".tsbuildinfo",
]);
const MAX_FILE_BYTES = 500_000; // skip huge files — not useful to describe

export default async function describe({ installRoot, args }) {
  let flags;
  try {
    flags = parseFlags(args);
  } catch (err) {
    console.error(err.message);
    return 64;
  }
  const target = canonicalCwd();

  const claudeBin = await findClaude();
  if (!claudeBin) {
    console.error(
      "Couldn't find Claude Code. Looked on PATH and at " +
        "~/.claude/local/claude.\n" +
        "Install it from https://claude.com/claude-code, then re-run " +
        "`constellation describe`.\n" +
        "(If you installed via the native installer, the shell alias " +
        "isn't visible to scripts — that's why we also check " +
        "~/.claude/local/claude directly.)",
    );
    return 64;
  }

  const allFiles = await walkRepo(target);
  if (allFiles.length === 0) {
    console.log("No files to describe.");
    return 0;
  }

  const existing = await readExistingSidecar(target);
  const todo = flags.force
    ? allFiles
    : allFiles.filter((f) => !existing[f] || existing[f].trim() === "");

  if (todo.length === 0) {
    console.log(
      `All ${allFiles.length} files already have descriptions. ` +
        `Pass --force to regenerate.`,
    );
    return 0;
  }

  console.log("");
  console.log(
    `Will describe ${todo.length} file${todo.length === 1 ? "" : "s"} ` +
      `in ${target}.`,
  );
  if (todo.length < allFiles.length) {
    console.log(
      `(Skipping ${allFiles.length - todo.length} already-covered files. ` +
        `Pass --force to regenerate.)`,
    );
  }
  console.log(`Cost cap $${COST_CAP_USD}. This usually takes 1–5 minutes.`);

  // Three confirm flows depending on what the caller has already decided:
  //   1. --yes: no prompts at all; use whichever model was set.
  //   2. --model passed but no --yes: just a y/n confirm.
  //   3. neither: show the model picker (which doubles as the confirm).
  if (!flags.yes) {
    if (!process.stdin.isTTY) {
      console.error(
        "describe needs an interactive confirm; stdin is not a TTY. " +
          "Re-run from a terminal or pass --yes.",
      );
      return 2;
    }
    if (flags.modelExplicit) {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      const answer = (await rl.question(
        `Continue with ${flags.model}? [Y/n]: `,
      )).trim();
      rl.close();
      if (answer !== "" && !/^y(es)?$/i.test(answer)) {
        console.log("Cancelled.");
        return 0;
      }
    } else {
      const picked = await pickModelAndConfirm(flags.model);
      if (picked === null) {
        console.log("Cancelled.");
        return 0;
      }
      flags.model = picked;
    }
  }
  console.log(`Running Claude Code (${flags.model})...`);

  const tonePrompt = await loadTonePrompt(installRoot);
  const userPrompt = buildUserPrompt(todo);

  const stopSpinner = startSpinner(
    `Asking Claude (${flags.model}) to describe ${todo.length} ` +
      `file${todo.length === 1 ? "" : "s"}`,
  );
  const result = await runClaude({
    cwd: target,
    bin: claudeBin,
    systemPrompt: tonePrompt,
    userPrompt,
    model: flags.model,
  });
  stopSpinner();
  if (result.code !== 0) {
    console.error(`Claude exited with code ${result.code}.`);
    if (result.stderr) {
      console.error(result.stderr.trimEnd());
    }
    return result.code || 1;
  }

  const descriptions = parseDescriptionMap(result.stdout, todo);
  if (!descriptions) {
    console.error(
      "Couldn't parse descriptions out of Claude's response. " +
        "Re-run with --force to retry.",
    );
    return 1;
  }

  const merged = { ...existing, ...descriptions };
  await writeSidecar(target, merged);

  const written = Object.keys(descriptions).length;
  console.log("");
  console.log(
    `✓ Wrote ${written} description${written === 1 ? "" : "s"} to ` +
      SIDECAR_PATH,
  );
  console.log(
    `  Open the visualizer (constellation open) to see them.`,
  );
  return 0;
}

function parseFlags(args) {
  const flags = {
    force: false,
    yes: false,
    model: DEFAULT_MODEL,
    modelExplicit: false,
  };
  // bin/constellation passes [cmd, ...rest]; cli/add.mjs invokes us
  // directly with just the flags. Skip a leading "describe" if present.
  const start = args[0] === "describe" ? 1 : 0;
  const rest = args.slice(start);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--force" || a === "-f") flags.force = true;
    else if (a === "--yes" || a === "-y") flags.yes = true;
    else if (a === "--model" || a === "-m") {
      const v = rest[++i];
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

// Combined model picker + confirm. Returns the chosen model, or null
// if the user cancelled. Re-prompts on unparseable input rather than
// guessing.
async function pickModelAndConfirm(defaultModel) {
  console.log("");
  console.log("Pick a model:");
  console.log("  1) haiku    fastest and cheapest, lower quality");
  console.log("  2) sonnet   recommended balance (default)");
  console.log("  3) opus     slowest and priciest, highest quality");
  console.log("");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      const raw = await rl.question(
        "Choice (1/2/3, or 'n' to cancel) [2]: ",
      );
      const ans = raw.trim().toLowerCase();
      if (ans === "" || ans === "2" || ans === "s" || ans === "sonnet") {
        return "sonnet";
      }
      if (ans === "1" || ans === "h" || ans === "haiku") return "haiku";
      if (ans === "3" || ans === "o" || ans === "opus") return "opus";
      if (ans === "n" || ans === "no" || ans === "cancel") return null;
      console.log(
        `Didn't understand "${raw.trim()}". Type 1/2/3, h/s/o, or 'n' to cancel.`,
      );
    }
  } finally {
    rl.close();
  }
}

// Lightweight spinner on stderr so the user knows the long claude run
// hasn't hung. Returns a stop fn that clears the line. No-op when stderr
// isn't a TTY (CI, piped output) so logs stay clean.
function startSpinner(label) {
  if (!process.stderr.isTTY) {
    process.stderr.write(`${label}...\n`);
    return () => {};
  }
  let i = 0;
  const start = Date.now();
  const tick = () => {
    const elapsed = Math.floor((Date.now() - start) / 1000);
    const m = Math.floor(elapsed / 60);
    const s = elapsed % 60;
    const time = m > 0 ? `${m}m${String(s).padStart(2, "0")}s` : `${s}s`;
    const frame = SPINNER_FRAMES[i++ % SPINNER_FRAMES.length];
    process.stderr.write(`\r\x1b[K${frame} ${label}... ${time}`);
  };
  tick();
  const id = setInterval(tick, 100);
  return () => {
    clearInterval(id);
    process.stderr.write("\r\x1b[K");
  };
}

// Returns an absolute path to the claude binary, or null if we can't
// find one. Checks PATH first (covers npm global, Homebrew). Falls
// back to ~/.claude/local/claude — Anthropic's native installer puts
// the binary there and writes a shell alias, but the alias is invisible
// to non-interactive child processes, so PATH alone misses it.
async function findClaude() {
  const fromPath = await whichClaude();
  if (fromPath) return fromPath;
  const native = path.join(os.homedir(), ".claude", "local", "claude");
  try {
    accessSync(native, constants.X_OK);
    return native;
  } catch {
    return null;
  }
}

function whichClaude() {
  return new Promise((resolve) => {
    const proc = spawn("which", ["claude"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    proc.stdout.on("data", (b) => {
      out += b.toString();
    });
    proc.on("exit", (code) => resolve(code === 0 ? out.trim() : null));
    proc.on("error", () => resolve(null));
  });
}

async function walkRepo(root) {
  const out = [];
  await walk(root, root, out);
  out.sort();
  return out;
}

async function walk(root, dir, out) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const abs = path.join(dir, ent.name);
    const rel = path.relative(root, abs);
    if (ent.isDirectory()) {
      if (IGNORE_DIR_SEGMENTS.has(ent.name)) continue;
      if (IGNORE_PATH_FRAGMENTS.some((f) => (rel + "/").includes(f))) continue;
      await walk(root, abs, out);
      continue;
    }
    if (!ent.isFile()) continue;
    if (IGNORE_FILE_NAMES.has(ent.name)) continue;
    if (IGNORE_EXTS.has(path.extname(ent.name).toLowerCase())) continue;
    try {
      const s = statSync(abs);
      if (s.size > MAX_FILE_BYTES) continue;
    } catch {
      continue;
    }
    out.push(rel.split(path.sep).join("/"));
  }
}

async function readExistingSidecar(target) {
  const p = path.join(target, SIDECAR_PATH);
  if (!existsSync(p)) return {};
  try {
    const raw = await readFile(p, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
    return {};
  } catch {
    return {};
  }
}

async function loadTonePrompt(installRoot) {
  // installRoot when run from the symlinked CLI is the install dir; the
  // tone file ships beside this script.
  const p = path.join(installRoot, TONE_PROMPT_PATH);
  return await readFile(p, "utf8");
}

function buildUserPrompt(paths) {
  return [
    "Describe each of these files using the rules in the system prompt.",
    "",
    "Use the Read tool to look at every file before describing it. Read",
    "files in parallel where you can. If a file is empty, write \"Empty file.\".",
    "",
    "Files (repo-relative paths):",
    ...paths.map((p) => `- ${p}`),
    "",
    "Respond with a single JSON object on stdout, nothing else — no prose,",
    "no code fences, no comments. The object's keys are the exact paths",
    "above; the values are one-sentence plain-English descriptions.",
    "",
    "Example shape:",
    "{",
    '  "bin/constellation": "This is what runs when you type \'constellation\' in your terminal — it figures out which job you asked for and hands it off.",',
    '  "package.json": "This is the project\'s name tag and shopping list — it says what this project is called and what other projects it relies on."',
    "}",
  ].join("\n");
}

async function runClaude({ cwd, bin, systemPrompt, userPrompt, model }) {
  return await new Promise((resolve) => {
    // The user prompt for a large repo (one bullet per file) easily runs
    // into hundreds of KB. macOS's ARG_MAX is ~256 KB, so passing it as
    // the trailing positional argument blows up at spawn time with
    // E2BIG before claude ever runs. Pipe it through stdin instead;
    // `claude --print` reads stdin when no positional prompt is given.
    const args = [
      "--print",
      "--system-prompt", systemPrompt,
      "--allowed-tools", "Glob,Read",
      "--permission-mode", "dontAsk",
      "--output-format", "json",
      "--no-session-persistence",
      "--max-budget-usd", String(COST_CAP_USD),
      "--model", model,
    ];
    // Capture stderr instead of inheriting so claude's output doesn't
    // collide with our spinner; print it after the run if non-empty.
    const proc = spawn(bin, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    proc.on("error", (err) => {
      console.error(`Failed to spawn claude: ${err.message}`);
      resolve({ code: 1, stdout: "", stderr: "" });
    });
    proc.on("exit", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    proc.stdin.on("error", () => {});
    proc.stdin.end(userPrompt);
  });
}

// Claude's --output-format json wraps the model's text. Shape depends on
// whether tools were used:
//   - No tool use: a single { "type": "result", "result": "<text>", ... }
//   - With tool use: an array of turn events, last one is the result.
// Extract the result string and parse it as a JSON map.
function parseDescriptionMap(stdout, expectedPaths) {
  let envelope;
  try {
    envelope = JSON.parse(stdout);
  } catch {
    return null;
  }
  const result = Array.isArray(envelope)
    ? envelope.findLast?.((e) => e?.type === "result") ??
      [...envelope].reverse().find((e) => e?.type === "result")
    : envelope;
  const text = typeof result?.result === "string" ? result.result : null;
  if (!text) return null;

  // The model might wrap in code fences despite our instructions. Strip them.
  const cleaned = stripCodeFence(text.trim());

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const expected = new Set(expectedPaths);
  const out = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v !== "string") continue;
    if (!expected.has(k)) continue;
    out[k] = v.trim();
  }
  return out;
}

function stripCodeFence(s) {
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/;
  const m = s.match(fence);
  return m ? m[1] : s;
}

async function writeSidecar(target, descriptions) {
  const dir = path.join(target, ".constellation");
  await mkdir(dir, { recursive: true });
  const finalPath = path.join(target, SIDECAR_PATH);
  const tmp = `${finalPath}.tmp`;
  // Sort keys for stable diffs.
  const sorted = Object.fromEntries(
    Object.entries(descriptions).sort(([a], [b]) => a.localeCompare(b)),
  );
  await writeFile(tmp, JSON.stringify(sorted, null, 2) + "\n", "utf8");
  await rename(tmp, finalPath);
}
