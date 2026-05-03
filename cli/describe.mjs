// `constellation describe` — fills .constellation/descriptions.json with
// one-sentence plain-English descriptions for every file in the repo, by
// running `claude -p` with a strict tone prompt. Re-runs are cheap by
// default (skip files already covered); pass --force to regenerate
// everything.
//
// Streams Claude's output line-by-line and writes the sidecar
// incrementally as each description arrives, so the visualizer can pop
// tiles in live during onboarding instead of staring at a black-box
// spinner. Each new description is also fired-and-forgotten at the
// daemon's /event/description-update endpoint; the daemon fans it out
// over SSE to any connected browser tab.
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
import { canonicalCwd, postDaemonNoThrow } from "./util.mjs";

const SIDECAR_PATH = ".constellation/descriptions.json";
const TONE_PROMPT_PATH = "cli/description-tone.txt";
const COST_CAP_USD = 5;
const ALLOWED_MODELS = new Set(["haiku", "sonnet", "opus"]);
const DEFAULT_MODEL = "sonnet";
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// Watchdogs around the spawned `claude --print` child. Override via
// CONSTELLATION_DESCRIBE_TIMEOUT_MS / _IDLE_MS (test convenience).
const DEFAULT_WALL_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_IDLE_TIMEOUT_MS = 90 * 1000;
const SIDECAR_DEBOUNCE_MS = 200;

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

  const lookup = await findClaude();
  if (!lookup.bin) {
    console.error(
      "Couldn't find Claude Code. Looked in:\n" +
        lookup.tried.map((t) => `  - ${t}`).join("\n") +
        "\n\nInstall it from https://claude.com/claude-code, then re-run " +
        "`constellation describe`.\n" +
        "If it's installed somewhere else, make sure it's on PATH or " +
        "symlink it into one of the locations above.",
    );
    return 64;
  }
  const claudeBin = lookup.bin;

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

  // Per-emit state — closed over by streaming callbacks below. `emitted`
  // dedupes across whichever assistant-event format the Claude CLI is
  // emitting (full snapshot per turn vs. incremental deltas), so the
  // streaming pipeline is robust to either without us having to detect
  // which mode we're in.
  const emitted = new Set();
  const accumulated = {};
  let written = 0;
  let writeTimer = null;
  let writeInFlight = null;

  const flushSidecar = async () => {
    if (writeTimer) {
      clearTimeout(writeTimer);
      writeTimer = null;
    }
    if (writeInFlight) {
      try { await writeInFlight; } catch { /* ignore prior failure */ }
    }
    const merged = { ...existing, ...accumulated };
    writeInFlight = writeSidecar(target, merged);
    try { await writeInFlight; } catch (err) {
      console.error("");
      console.error(`! sidecar write failed: ${err.message}`);
    } finally {
      writeInFlight = null;
    }
  };

  const scheduleSidecarWrite = () => {
    if (writeTimer) return;
    writeTimer = setTimeout(() => {
      writeTimer = null;
      flushSidecar();
    }, SIDECAR_DEBOUNCE_MS);
  };

  const onDescription = (filePath, description) => {
    if (emitted.has(filePath)) return;
    emitted.add(filePath);
    accumulated[filePath] = description;
    written++;
    spinner.update(written);
    scheduleSidecarWrite();
    // Daemon down ⇒ silent no-op ⇒ describe still works (just no live UI).
    postDaemonNoThrow(installRoot, "/event/description-update", {
      cwd: target,
      path: filePath,
      description,
    });
  };

  const spinner = startProgressSpinner(flags.model, todo.length);
  const result = await runClaude({
    cwd: target,
    bin: claudeBin,
    systemPrompt: tonePrompt,
    userPrompt,
    model: flags.model,
    expected: new Set(todo),
    onDescription,
  });
  spinner.stop();

  // Final flush so anything buffered behind the debounce lands.
  await flushSidecar();

  if (result.killed) {
    console.error(
      `Claude --print was killed (${result.killed} timeout). ` +
        `Last stderr:\n${(result.stderr || "(empty)").trimEnd()}`,
    );
    return 124;
  }

  if (result.code !== 0) {
    console.error(`Claude exited with code ${result.code}.`);
    if (result.stderr) {
      console.error(result.stderr.trimEnd());
    }
    return result.code || 1;
  }

  // End-of-run fallback: if streaming missed entries (e.g. Claude wrote
  // the whole batch on one line that arrived after our newline scan
  // already buffered it, or wrapped it in a code fence), recover from
  // the final result text the same way the old non-streaming path did.
  const fallback = parseDescriptionMap(result.fullText, todo);
  if (fallback) {
    let recovered = 0;
    for (const [k, v] of Object.entries(fallback)) {
      if (!emitted.has(k)) {
        onDescription(k, v);
        recovered++;
      }
    }
    if (recovered > 0) {
      await flushSidecar();
    }
  }

  if (written === 0) {
    console.error(
      "Couldn't parse any descriptions out of Claude's response. " +
        "Re-run with --force to retry.",
    );
    return 1;
  }

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

// Live counter spinner — much more useful than the old elapsed-time
// label because the user can see how far through the batch Claude is.
// Falls back to a single newline + periodic count line on non-TTY
// stderr so CI logs stay clean.
function startProgressSpinner(model, total) {
  let count = 0;
  if (!process.stderr.isTTY) {
    process.stderr.write(
      `Describing ${total} file${total === 1 ? "" : "s"} with ${model}...\n`,
    );
    return {
      update(n) {
        count = n;
        if (n === total || n % 10 === 0) {
          process.stderr.write(`  ...${n}/${total}\n`);
        }
      },
      stop() {
        if (count !== total) {
          process.stderr.write(`  ...${count}/${total} (final)\n`);
        }
      },
    };
  }
  let i = 0;
  const tick = () => {
    const frame = SPINNER_FRAMES[i++ % SPINNER_FRAMES.length];
    process.stderr.write(
      `\r\x1b[K${frame} Describing files with ${model}... (${count}/${total})`,
    );
  };
  tick();
  const id = setInterval(tick, 100);
  return {
    update(n) {
      count = n;
      tick();
    },
    stop() {
      clearInterval(id);
      process.stderr.write("\r\x1b[K");
    },
    clearLine() {
      if (process.stderr.isTTY) process.stderr.write("\r\x1b[K");
    },
    redraw: tick,
  };
}

// Returns { bin, tried } where bin is an absolute path to the claude
// binary or null, and tried is the list of every place we looked
// (used to build a diagnostic error message).
//
// Lookup order:
//   1. The PATH this process inherited.
//   2. The user's login shell — sources their dotfiles, so this picks
//      up homebrew, nvm, asdf, mise, fnm, custom prefixes, and shell
//      aliases that an interactive terminal would see but a launchd-
//      spawned or Finder-spawned process would not.
//   3. A short list of well-known fixed locations as a last resort.
async function findClaude() {
  const tried = [];

  const fromPath = await whichClaude();
  tried.push("$PATH (this process)");
  if (fromPath && isExecutable(fromPath)) {
    return { bin: fromPath, tried };
  }

  const fromLoginShell = await whichClaudeViaLoginShell();
  tried.push(`$PATH (login shell: ${process.env.SHELL || "/bin/sh"} -lc)`);
  if (fromLoginShell && isExecutable(fromLoginShell)) {
    return { bin: fromLoginShell, tried };
  }

  const fixedCandidates = [
    path.join(os.homedir(), ".claude", "local", "claude"),
    path.join(os.homedir(), ".local", "bin", "claude"),
    path.join(os.homedir(), ".npm-global", "bin", "claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
  ];
  for (const c of fixedCandidates) {
    tried.push(c);
    if (isExecutable(c)) return { bin: c, tried };
  }

  return { bin: null, tried };
}

function isExecutable(p) {
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// Spawns the user's login shell (zsh on modern macOS, bash elsewhere)
// with -lc so it sources their interactive dotfiles, then runs
// `command -v claude` — POSIX, supported by bash/zsh/dash/sh. We do
// not use `which` because it is not a POSIX builtin and behavior
// across shells varies. Returns null on any failure (no claude found,
// shell errored, dotfiles broken).
function whichClaudeViaLoginShell() {
  const shell = process.env.SHELL || "/bin/sh";
  return new Promise((resolve) => {
    const proc = spawn(shell, ["-lc", "command -v claude"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    proc.stdout.on("data", (b) => {
      out += b.toString();
    });
    proc.on("exit", (code) => {
      if (code !== 0) return resolve(null);
      // `command -v` may print the resolved path or, for an alias,
      // something like "claude: aliased to /Users/.../claude". Take
      // the last whitespace-separated token of the last line and
      // accept it only if it looks like an absolute path.
      const line = out.trim().split("\n").pop() || "";
      const token = line.split(/\s+/).pop() || "";
      resolve(token.startsWith("/") ? token : null);
    });
    proc.on("error", () => resolve(null));
  });
}

function whichClaude() {
  return new Promise((resolve) => {
    const proc = spawn("/usr/bin/env", ["sh", "-c", "command -v claude"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    proc.stdout.on("data", (b) => {
      out += b.toString();
    });
    proc.on("exit", (code) => {
      if (code !== 0) return resolve(null);
      const token = (out.trim().split("\n").pop() || "").split(/\s+/).pop();
      resolve(token && token.startsWith("/") ? token : null);
    });
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
    "Output format: respond with one JSON object per line on stdout — JSONL.",
    "No prose, no code fences, no surrounding array, no comments. Each line",
    "must be exactly:",
    "",
    '{"path": "<one of the paths above>", "description": "<one-sentence plain-English description>"}',
    "",
    "Cover every path exactly once. Emit each line as soon as that file's",
    "description is ready — do not buffer the whole batch before writing.",
    "",
    "Example:",
    '{"path": "bin/constellation", "description": "This is what runs when you type \'constellation\' in your terminal — it figures out which job you asked for and hands it off."}',
    '{"path": "package.json", "description": "This is the project\'s name tag and shopping list — it says what this project is called and what other projects it relies on."}',
  ].join("\n");
}

// Spawns `claude --print --output-format stream-json --verbose`, parses
// the NDJSON envelopes line-by-line as they stream in, accumulates the
// model's text, and emits {path, description} pairs the moment a
// complete JSONL line lands. Two watchdogs bound the child:
//   - idle: if no stdout chunk arrives for IDLE_TIMEOUT_MS, kill it
//     (the husband's "stuck" experience came from no visibility);
//   - wall: a hard ceiling so a runaway prompt can't burn budget forever.
function runClaude({
  cwd, bin, systemPrompt, userPrompt, model, expected, onDescription,
}) {
  return new Promise((resolve) => {
    const wallMs = Number(process.env.CONSTELLATION_DESCRIBE_TIMEOUT_MS) || DEFAULT_WALL_TIMEOUT_MS;
    const idleMs = Number(process.env.CONSTELLATION_DESCRIBE_IDLE_MS) || DEFAULT_IDLE_TIMEOUT_MS;

    const args = [
      "--print",
      "--system-prompt", systemPrompt,
      "--allowed-tools", "Glob,Read",
      "--permission-mode", "dontAsk",
      "--output-format", "stream-json",
      "--verbose",  // required by Claude CLI when stream-json is used
      "--no-session-persistence",
      "--max-budget-usd", String(COST_CAP_USD),
      "--model", model,
    ];

    const proc = spawn(bin, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let envelopeBuf = "";   // raw stdout, split on \n into Claude CLI envelopes
    let modelText = "";     // accumulated assistant text, split on \n into JSONL entries
    let fullText = "";      // unsplit assistant text — kept around for the end-of-run fallback parser
    let stderr = "";
    let killed = null;       // "idle" | "wall" | "error" | null
    let lastStdoutAt = Date.now();

    const idleTimer = setInterval(() => {
      if (Date.now() - lastStdoutAt > idleMs) {
        killed = "idle";
        try { proc.kill("SIGTERM"); } catch { /* already dead */ }
        setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /* */ } }, 5000);
        clearInterval(idleTimer);
      }
    }, 5000);

    const wallTimer = setTimeout(() => {
      killed = "wall";
      try { proc.kill("SIGTERM"); } catch { /* */ }
      setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /* */ } }, 5000);
    }, wallMs);

    const handleEnvelope = (line) => {
      if (!line.trim()) return;
      let env;
      try { env = JSON.parse(line); } catch { return; }
      collectAssistantText(env, (text) => appendModelText(text));
    };

    const appendModelText = (text) => {
      modelText += text;
      fullText += text;
      let nl;
      while ((nl = modelText.indexOf("\n")) !== -1) {
        const candidate = modelText.slice(0, nl);
        modelText = modelText.slice(nl + 1);
        tryEmitJsonlEntry(candidate, expected, onDescription);
      }
    };

    proc.stdout.on("data", (chunk) => {
      lastStdoutAt = Date.now();
      envelopeBuf += chunk.toString();
      let nl;
      while ((nl = envelopeBuf.indexOf("\n")) !== -1) {
        const line = envelopeBuf.slice(0, nl);
        envelopeBuf = envelopeBuf.slice(nl + 1);
        handleEnvelope(line);
      }
    });

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      // Surface stderr in real time so the husband-machine "stuck"
      // experience can't recur silently. Clear the spinner line first
      // so the chunks don't garble the live counter.
      if (process.stderr.isTTY) process.stderr.write("\r\x1b[K");
      process.stderr.write(chunk);
      if (process.stderr.isTTY) process.stderr.write("\n");
    });

    proc.on("error", (err) => {
      killed = "error";
      console.error(`Failed to spawn claude: ${err.message}`);
      clearInterval(idleTimer);
      clearTimeout(wallTimer);
      resolve({ code: 1, stderr: err.message, fullText: "", killed });
    });

    proc.on("exit", (code) => {
      clearInterval(idleTimer);
      clearTimeout(wallTimer);
      // Drain any final partial line that didn't end in \n.
      if (envelopeBuf.trim()) handleEnvelope(envelopeBuf);
      if (modelText.trim()) tryEmitJsonlEntry(modelText, expected, onDescription);
      resolve({
        code: code ?? 1,
        stderr,
        fullText,
        killed,
      });
    });

    proc.stdin.on("error", () => {});
    proc.stdin.end(userPrompt);
  });
}

// Pull text content out of a Claude CLI envelope. Handles both shapes
// the CLI emits in stream-json mode: an `assistant` event whose
// `message.content[]` carries text blocks, and the final `result` event
// with `result: <full text>`. Re-processing identical text is fine —
// the dedup happens at the emit layer (per-path Set), not here.
function collectAssistantText(env, sink) {
  if (!env || typeof env !== "object") return;
  if (env.type === "assistant" && env.message && Array.isArray(env.message.content)) {
    for (const block of env.message.content) {
      if (block && block.type === "text" && typeof block.text === "string") {
        sink(block.text);
      }
    }
    return;
  }
  if (env.type === "result" && typeof env.result === "string") {
    sink(env.result);
  }
}

function tryEmitJsonlEntry(line, expected, onDescription) {
  const t = line.trim();
  if (!t) return;
  // Strip an optional trailing comma in case Claude slips into JSON-array
  // mode despite the prompt. Don't try to handle wider deviations here —
  // the end-of-run fallback parser catches the "wrote one big object"
  // case via parseDescriptionMap.
  const stripped = t.replace(/,\s*$/, "");
  if (!stripped.startsWith("{") || !stripped.endsWith("}")) return;
  let obj;
  try { obj = JSON.parse(stripped); } catch { return; }
  if (!obj || typeof obj.path !== "string" || typeof obj.description !== "string") return;
  if (!expected.has(obj.path)) return;
  onDescription(obj.path, obj.description.trim());
}

// Fallback parser for the end-of-run text. The streaming path is the
// happy path; this catches the case where Claude wrote the whole
// response as a single JSON object (the old --output-format json shape)
// or wrapped JSONL in a code fence so our newline scanner skipped past
// the JSON. Returns a {path: description} map or null.
function parseDescriptionMap(text, expectedPaths) {
  if (!text) return null;
  const cleaned = stripCodeFence(text.trim());
  if (!cleaned) return null;

  const expected = new Set(expectedPaths);

  // First try: parse as a single JSON object.
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v !== "string") continue;
        if (!expected.has(k)) continue;
        out[k] = v.trim();
      }
      if (Object.keys(out).length > 0) return out;
    }
  } catch { /* fall through to JSONL retry */ }

  // Second try: JSONL — handles the case where Claude correctly emitted
  // one object per line but every chunk landed without a trailing \n
  // until the final result event.
  const out = {};
  for (const raw of cleaned.split("\n")) {
    const t = raw.trim().replace(/,\s*$/, "");
    if (!t.startsWith("{")) continue;
    try {
      const obj = JSON.parse(t);
      if (obj && typeof obj.path === "string" &&
          typeof obj.description === "string" &&
          expected.has(obj.path)) {
        out[obj.path] = obj.description.trim();
      }
    } catch { /* ignore partial */ }
  }
  return Object.keys(out).length > 0 ? out : null;
}

function stripCodeFence(s) {
  const fence = /^```(?:json|jsonl)?\s*\n?([\s\S]*?)\n?```$/;
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
