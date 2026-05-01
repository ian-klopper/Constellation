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
# merge (scripts/install-settings.mjs), and starts the visualizer in
# the background. Refuses to run non-interactively unless
# CONSTELLATION_INSTALL_DIR is set.

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
        git -C "$INSTALL_DIR" fetch --depth 1 origin "$REF" \
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
    # requested ref. Avoids needing to know whether the ref is a branch,
    # tag, or SHA at clone time.
    git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
    git -C "$INSTALL_DIR" fetch --depth 1 origin "$REF"
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
for skill in describe-codebase feedback; do
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

if [ "$ready" -eq 1 ]; then
  say ""
  say "Visualizer ready at http://localhost:$WEB_PORT"
  say "  - Hover any tile to see its description; click to pin."
  say "  - Run /constellation:describe-codebase later to populate tile descriptions."
  say "  - Live agent overlay turns on automatically inside Claude Code sessions."
  say "  - Stop the visualizer with: pkill -f 'npm run dev' (logs at $LOG_FILE)"
  exit 0
fi

err "Daemon didn't come up within 10s. Logs at $LOG_FILE — try 'cd $INSTALL_DIR && npm run dev' to see what went wrong."
exit 1
