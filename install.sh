#!/usr/bin/env bash
# Constellation installer. Invoked from inside the user's git working
# tree (TARGET) via:
#   bash <(curl -fsSL https://raw.githubusercontent.com/ian-klopper/Constellation/main/install.sh)
# Process substitution (not curl-pipe-bash) so the script's stdin stays
# the user's terminal — `read` works without /dev/tty gymnastics, which
# fail in any environment whose bash subshell lacks a controlling
# terminal (some IDE terminals, CI runners, sandboxes).
# Clones Constellation to a sibling directory, installs deps, copies
# hooks + skills into TARGET, runs the deterministic settings.json
# merge (scripts/install-settings.mjs), starts the visualizer in the
# background, and offers to launch Claude Code in plan mode to
# populate per-file descriptions. Refuses to run non-interactively
# unless CONSTELLATION_INSTALL_DIR is set.

set -euo pipefail

REPO_URL="https://github.com/ian-klopper/Constellation.git"
# Which branch / tag / SHA to clone or update to. Defaults to main; set
# to a branch name (e.g. CONSTELLATION_REF=feat/ai-onboarding-flow) to
# test pre-merge changes. The matching install.sh and the cloned tree
# need to be on the same ref — install.sh post-step-7 expects the
# clone to contain scripts/install-settings.mjs, which a stale ref
# may be missing.
REF="${CONSTELLATION_REF:-main}"
TARGET="$PWD"

say() { printf '%s\n' "$*"; }
err() { printf '%s\n' "$*" >&2; }
fail() { err "$*"; exit 1; }

# ask "prompt" "default-when-no-tty" — sets $REPLY. Lets the script run
# non-interactively (CI, scripted) without hanging on `read`.
ask() {
  if [ -t 0 ]; then
    printf '%s' "$1"
    read -r REPLY
  else
    REPLY="$2"
  fi
}

# 1. Preflight ---------------------------------------------------------------

command -v node >/dev/null 2>&1 || fail "Constellation needs Node 20 or newer (nodejs.org or 'nvm install 20')."
node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
[ "$node_major" -ge 20 ] 2>/dev/null || fail "Constellation needs Node 20 or newer; you have $(node -v)."

command -v jq >/dev/null 2>&1 || fail "Constellation's hook shims need jq. macOS: 'brew install jq'. Debian/Ubuntu: 'apt install jq'."
command -v git >/dev/null 2>&1 || fail "Constellation's installer needs git on PATH."
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "Run this in a git working tree — Constellation expects to live alongside a tracked repo."

# 2. Refuse to run inside Constellation itself --------------------------------

if [ -f "$TARGET/package.json" ] && [ "$(jq -r .name "$TARGET/package.json" 2>/dev/null)" = "constellation" ]; then
  fail "You're inside the Constellation repo. To hack on it, run 'npm install && npm run dev' here. To install Constellation against another repo, run this script from inside that repo."
fi

# 3. Refuse to run non-interactively without a path -------------------------

# Inside Claude Code's '!' shell mode, CI runners, sandboxes, or any pipe,
# stdin isn't a TTY — `read` would hang forever with no way to type. Bail
# out with a clear hint unless the caller pre-supplied the install dir.
if [ ! -t 0 ] && [ -z "${CONSTELLATION_INSTALL_DIR:-}" ]; then
  fail "This installer is interactive. Run it in your shell:
    bash <(curl -fsSL https://raw.githubusercontent.com/ian-klopper/Constellation/main/install.sh)
not inside Claude Code's '!' shell mode (where stdin can't accept input).
For non-interactive use (CI, scripted), set CONSTELLATION_INSTALL_DIR=<absolute-path>."
fi

# 4. Pick install dir --------------------------------------------------------

if [ -n "${CONSTELLATION_INSTALL_DIR:-}" ]; then
  INSTALL_DIR="$CONSTELLATION_INSTALL_DIR"
  case "$INSTALL_DIR" in
    /*) ;;
    *) fail "CONSTELLATION_INSTALL_DIR must be an absolute path; got '$INSTALL_DIR'." ;;
  esac
else
  say ""
  say "Where should Constellation be cloned (sibling to this repo)?"
  say "Suggestions:"
  say "  1) ~/code/constellation"
  say "  2) ~/src/constellation"
  say "  3) ~/projects/constellation"
  say "  4) (type a custom absolute path)"
  printf 'Choice [1-4 or path]: '
  read -r choice
  case "$choice" in
    1) INSTALL_DIR="$HOME/code/constellation" ;;
    2) INSTALL_DIR="$HOME/src/constellation" ;;
    3) INSTALL_DIR="$HOME/projects/constellation" ;;
    /*) INSTALL_DIR="$choice" ;;
    "~/"*) INSTALL_DIR="${choice/#\~/$HOME}" ;;
    *) fail "Need an absolute path or one of 1/2/3." ;;
  esac
fi

# 5. Idempotent clone --------------------------------------------------------

if [ -e "$INSTALL_DIR" ]; then
  if [ -f "$INSTALL_DIR/package.json" ] && [ "$(jq -r .name "$INSTALL_DIR/package.json" 2>/dev/null)" = "constellation" ]; then
    say ""
    say "Existing Constellation install found at $INSTALL_DIR (current ref tracking $REF)."
    ask "Update it (git fetch + checkout origin/$REF)? [y/N]: " n
    case "$REPLY" in
      y|Y|yes)
        # Explicit refspec so the remote-tracking branch ref actually
        # gets created/updated. A plain `fetch --depth 1 origin <ref>`
        # only updates FETCH_HEAD on a shallow clone whose configured
        # fetch refspec is just main, so the next `checkout origin/<ref>`
        # would fail.
        git -C "$INSTALL_DIR" fetch --depth 1 origin \
          "+refs/heads/$REF:refs/remotes/origin/$REF" \
          && git -C "$INSTALL_DIR" checkout "origin/$REF"
        ;;
      *) say "Skipping update — make sure $INSTALL_DIR is already on $REF." ;;
    esac
  else
    fail "$INSTALL_DIR exists but isn't a Constellation clone. Pick a different path."
  fi
else
  say ""
  say "Cloning Constellation ($REF) into $INSTALL_DIR ..."
  if [ "$REF" = "main" ]; then
    git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
  else
    # Non-main ref: clone shallow on main, then fetch and check out the
    # requested ref. The explicit refspec creates the remote-tracking
    # branch so `checkout origin/<ref>` resolves (a plain
    # `fetch --depth 1 origin <ref>` only sets FETCH_HEAD).
    git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
    git -C "$INSTALL_DIR" fetch --depth 1 origin \
      "+refs/heads/$REF:refs/remotes/origin/$REF"
    git -C "$INSTALL_DIR" checkout "origin/$REF"
  fi
fi

# Sanity check: the merge script (added in feat/ai-onboarding-flow) is
# load-bearing for step 8. If it's missing, the install dir is on a ref
# that predates it — bail out with a hint rather than exploding later.
if [ ! -f "$INSTALL_DIR/scripts/install-settings.mjs" ]; then
  fail "Your Constellation install at $INSTALL_DIR is missing scripts/install-settings.mjs.
The cloned tree is on a ref that predates the deterministic settings merger.
Re-run with CONSTELLATION_REF=<branch> set to a ref that has it (e.g. feat/ai-onboarding-flow), or update the clone manually:
  git -C $INSTALL_DIR fetch origin && git -C $INSTALL_DIR checkout <branch>"
fi

# 6. Install deps ------------------------------------------------------------

say ""
say "Installing npm dependencies in $INSTALL_DIR ..."
npm ci --prefix "$INSTALL_DIR"

# 7. Copy hooks + skills + .gitignore ----------------------------------------

copy_with_prompt() {
  src="$1"
  dst="$2"
  if [ -e "$dst" ] && ! cmp -s "$src" "$dst"; then
    ask "  $dst exists and differs. Overwrite? [y/N]: " n
    case "$REPLY" in y|Y|yes) ;; *) say "    skipped"; return ;; esac
  fi
  mkdir -p "$(dirname "$dst")"
  cp "$src" "$dst"
}

say ""
say "Copying hooks into .claude/hooks/constellation/ ..."
for f in "$INSTALL_DIR"/.claude/hooks/*.sh; do
  copy_with_prompt "$f" "$TARGET/.claude/hooks/constellation/$(basename "$f")"
done
for f in "$INSTALL_DIR"/.claude/hooks/lib/*.sh; do
  copy_with_prompt "$f" "$TARGET/.claude/hooks/constellation/lib/$(basename "$f")"
done
chmod +x "$TARGET"/.claude/hooks/constellation/*.sh

say "Copying skills into .claude/skills/constellation/ ..."
for skill in feedback; do
  for f in "$INSTALL_DIR"/.claude/skills/constellation/"$skill"/*; do
    [ -f "$f" ] || continue
    copy_with_prompt "$f" "$TARGET/.claude/skills/constellation/$skill/$(basename "$f")"
  done
done

if ! grep -qxF '.constellation/' "$TARGET/.gitignore" 2>/dev/null; then
  printf '\n.constellation/\n' >> "$TARGET/.gitignore"
  say "Appended .constellation/ to .gitignore."
fi

# 8. Merge settings.json (deterministic, no AI) -----------------------------

say ""
say "Merging Constellation hooks into .claude/settings.json ..."
if ! node "$INSTALL_DIR/scripts/install-settings.mjs" \
       --install-root "$INSTALL_DIR" \
       --target-root  "$TARGET"; then
  fail "Settings merge declined or failed. Hooks and skills are installed; re-run when ready."
fi

# 9. Start dev server in background -----------------------------------------

# Read the configured ports so we don't hardcode them in two places.
DAEMON_PORT="$(jq -r '.daemon.port' "$INSTALL_DIR/constellation.config.json")"
WEB_PORT="$(jq -r '.web.port' "$INSTALL_DIR/constellation.config.json")"

# nohup + setsid (when present) detaches the supervisor from this shell so
# closing the terminal doesn't kill it. setsid is non-portable; the nohup
# fallback works on macOS where setsid isn't installed by default.
say ""
say "Starting Constellation visualizer (target: $TARGET) ..."
LOG_DIR="$TARGET/.constellation"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/dev.log"
if command -v setsid >/dev/null 2>&1; then
  setsid sh -c "cd '$INSTALL_DIR' && CONSTELLATION_TARGET_ROOT='$TARGET' npm run dev >'$LOG_FILE' 2>&1" </dev/null &
else
  ( cd "$INSTALL_DIR" && CONSTELLATION_TARGET_ROOT="$TARGET" nohup npm run dev >"$LOG_FILE" 2>&1 </dev/null & )
fi

# Poll daemon health for up to ~10s.
ready=0
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  sleep 0.5
  if curl -fsS -m 0.5 "http://127.0.0.1:$DAEMON_PORT/health" >/dev/null 2>&1; then
    ready=1
    break
  fi
done

if [ "$ready" -ne 1 ]; then
  err "Daemon didn't come up within 10s. Logs at $LOG_FILE — try 'cd $INSTALL_DIR && npm run dev' to see what went wrong."
  exit 1
fi

say ""
say "Visualizer ready at http://localhost:$WEB_PORT"
say "  - Hover any tile to see its description; click to pin."
say "  - Live agent overlay turns on automatically inside Claude Code sessions."
say "  - Stop the visualizer with: pkill -f 'npm run dev' (logs at $LOG_FILE)"

# 10. Offer to launch Claude Code in plan mode for descriptions -------------

# The visualizer is up but most tiles only show filenames. Constellation
# reads a leading-comment description out of each file (JSDoc for code,
# `#` block for shell, first paragraph for markdown) and shows it on the
# tile and in the hover card. Adding those comments is the only thing
# left to make the visualizer genuinely useful, and it's the kind of
# work only an AI can do across hundreds of files at once. So we offer
# to hand off to the user's local `claude` CLI in plan mode with a
# self-contained prompt — no /constellation skill indirection. The user
# pays the token cost, sees the proposed scope before any descriptions
# get written, and ends up with the visualizer in its populated state.
#
# Bash 3.2 (macOS default) chokes on `VAR=$(cat <<EOF...EOF)` for some
# punctuation, so we use the `IFS='' read -r -d '' VAR <<'EOF' ... EOF`
# pattern instead. `IFS=''` preserves the indented list items inside the
# prompt body; the single-quoted `'EOF'` delimiter prevents bash from
# expanding `$var` / backticks in the prompt. We then substitute
# __WEB_PORT__ ourselves so the URL reflects the actual configured port.

IFS='' read -r -d '' DESCRIBE_PROMPT_TEMPLATE <<'EOF' || true
You're being launched at the end of Constellation's install. Constellation is now visualizing this repo as a treemap at http://localhost:__WEB_PORT__ — but most tiles only show filenames. The fix: each file gets a one- or two-sentence comment at the top saying what it's for in plain English. Constellation reads those comments and shows them on each tile and in the hover card. That's the only thing left to make the visualizer useful.

Plan mode is on. Work through this with the user.

## Step 1 — Survey

Walk the repo (cwd is the user's project). Skip these paths entirely — they're not part of what Constellation visualizes:
- `node_modules/`, `.next/`, `dist/`, `out/`, `build/`, `.git/`, `.constellation/`, `.claude/worktrees/`, `.claude/settings.local.json`, `next-env.d.ts`
- `*.tsbuildinfo`, `.DS_Store`, and lockfiles (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lockb`)
- Binaries and assets: `*.png`, `*.jpg`, `*.jpeg`, `*.gif`, `*.ico`, `*.svg`, `*.webp`, `*.bmp`, `*.woff`, `*.woff2`, `*.ttf`, `*.eot`, `*.otf`, `*.pdf`, `*.zip`, `*.gz`, `*.tar`, `*.exe`, `*.dmg`

Of what remains, only files with these extensions can hold a description Constellation will read:
- `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.css`, `.scss` — JSDoc block: `/** … */`
- `.sh` — `#` comment block (after the shebang line if there is one)
- `.md` — the first paragraph after any heading

Skip files that already have a description in the matching format — never overwrite an existing comment. If a file has an existing comment in a non-matching format (e.g. a `//` line at the top of a `.ts` file), also skip and report it; leave it alone.

Tell the user roughly how many files would get a description and which directories they're concentrated in. If the repo is large enough that scanning every file would be obviously expensive, say so.

## Step 2 — Decide scope with the user

Offer choices in plain language. Reasonable shapes:
- describe everything in one pass
- only specific directories the user names
- skip files under some line count (descriptions matter most for files big enough to matter)
- skip entirely (the user can re-run the installer to do this later)

Recommend whichever option fits this repo best and give one sentence on why. Wait for the user to pick — don't assume. The user is paying for the tokens this run uses, so make the cost shape (file count, file types) tactile, not abstract.

## Step 3 — Write the descriptions

For each candidate file in the agreed scope:
1. Read the file.
2. Write a one- or two-sentence intent description: what the file is *for*, who uses it, what a future reader needs to know before opening it. Don't restate what the code does — the code does that itself.
   - Bad: "Exports an `add` function that takes two numbers and returns their sum."
   - Good: "Cursor-anchored floating panel that shows the active tile's description, exports, and import lists. Pin-mode keeps it visible after the cursor leaves; hover-mode follows the pointer."
3. If after reading the file you genuinely can't tell what it's for, skip it. A wrong description is worse than no description for a vibecoder reading the map.
4. Prepend the description in the right syntax for the file's language:
   - `.ts/.tsx/.js/.jsx/.mjs/.cjs/.css/.scss`: a `/** ... */` block then existing contents.
   - `.sh` with shebang: keep the shebang, insert a `# <description>` line plus a blank line after it.
   - `.sh` without shebang: a `# <description>` line plus a blank line, then existing contents.
   - `.md` with a heading: description as a paragraph immediately after the first heading.
   - `.md` without a heading: description as the first paragraph.
5. Preserve the file's trailing-newline discipline. Don't add trailing whitespace.

Don't stage or commit anything. Leave every change unstaged so the user reviews with `git diff` and decides what to keep.

## Step 4 — Report

When you're done, print a short summary:
- N files described
- M files skipped, broken down by reason (existing-header / existing-non-matching-header / uncertain)
- K files unchanged (unsupported extension or matched the skip list)

Then stop. The user runs `git diff`, picks what to keep, and reloads the visualizer to see the new descriptions.

The user is an amateur developer. Talk plainly. Don't sell the feature — they already installed it.
EOF
DESCRIBE_PROMPT="${DESCRIBE_PROMPT_TEMPLATE//__WEB_PORT__/$WEB_PORT}"

print_describe_prompt() {
  say ""
  say "Open Claude Code in this directory and paste this prompt:"
  say ""
  printf '%s\n' "$DESCRIBE_PROMPT"
  say ""
}

if ! [ -t 0 ]; then
  # Non-interactive (CI, scripted): print the prompt for the caller and exit.
  print_describe_prompt
  exit 0
elif ! command -v claude >/dev/null 2>&1; then
  say ""
  say "(\`claude\` CLI not on PATH — install Claude Code, then paste this:)"
  print_describe_prompt
  exit 0
fi

say ""
say "Last step: file descriptions make tile hover-cards useful instead of blank."
say "We can launch Claude Code now in plan mode to walk through that with you,"
say "or you can re-run the installer later when you're ready."
say "(Plan mode means Claude tells you what it'll do before doing anything; if"
say "Claude exits immediately, you may need to authenticate first — see"
say "https://docs.claude.com/en/docs/claude-code.)"
ask "Launch Claude Code now? [Y/n]: " n
case "$REPLY" in
  n|N|no)
    say ""
    say "Skipped. Re-run the installer in this repo whenever you're ready to populate descriptions."
    exit 0
    ;;
  *)
    say ""
    say "Launching Claude Code in plan mode..."
    exec claude --permission-mode plan "$DESCRIBE_PROMPT"
    # Only reached if exec failed:
    err "Couldn't exec claude. Falling back to manual paste."
    print_describe_prompt
    exit 1
    ;;
esac
