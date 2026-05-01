#!/usr/bin/env bash
# Constellation installer. Invoked from inside the user's git working
# tree (TARGET) via:
#   bash <(curl -fsSL https://raw.githubusercontent.com/ian-klopper/Constellation/main/install.sh)
# Process substitution (not curl-pipe-bash) so the script's stdin stays
# the user's terminal — `read` works without /dev/tty gymnastics, which
# fail in any environment whose bash subshell lacks a controlling
# terminal (some IDE terminals, CI runners, sandboxes).
# Clones Constellation to a sibling directory, installs deps, copies
# hooks + skills into TARGET, then either launches Claude Code in plan
# mode with the settings.json-merge prompt loaded, or prints it for
# manual paste. Refuses to run non-interactively unless
# CONSTELLATION_INSTALL_DIR is set.

set -euo pipefail

REPO_URL="https://github.com/ian-klopper/Constellation.git"
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
    say "Existing Constellation install found at $INSTALL_DIR."
    ask 'Update it (git fetch + checkout main)? [y/N]: ' n
    case "$REPLY" in
      y|Y|yes) git -C "$INSTALL_DIR" fetch --depth 1 origin main && git -C "$INSTALL_DIR" checkout origin/main ;;
      *) say "Skipping update." ;;
    esac
  else
    fail "$INSTALL_DIR exists but isn't a Constellation clone. Pick a different path."
  fi
else
  say ""
  say "Cloning Constellation into $INSTALL_DIR ..."
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
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

# 8. Handoff to Claude Code in plan mode -------------------------------------

HANDOFF_PROMPT_TEMPLATE=""
IFS='' read -r -d '' HANDOFF_PROMPT_TEMPLATE <<'EOF' || true
Constellation's installer just laid hook shims under .claude/hooks/constellation/ and skills under .claude/skills/constellation/. The canonical matcher set Constellation needs lives at __INSTALL_DIR__/.claude/settings.json — read it to see exactly which PreToolUse / PostToolUse / Stop / SubagentStop / SessionStart matchers to add.

Plan the following (you are in plan mode — produce the plan, wait for my approval, then execute):

1. Merge Constellation's hook matchers into MY ./.claude/settings.json (creating the file if it is missing). For each matcher in __INSTALL_DIR__/.claude/settings.json, add an equivalent entry to mine with the command path rewritten from .claude/hooks/<script>.sh to .claude/hooks/constellation/<script>.sh. APPEND-NOT-FUSE: never edit my existing matchers. If I already have an overlapping matcher (e.g. on Read|Edit|Write), add Constellation's as a sibling so both fire.

2. In your plan, include (a) the unified JSON diff to MY settings.json and (b) the full contents of every script under .claude/hooks/constellation/ so I can audit what runs on every tool call.

3. After my plan-mode approval, start the visualizer in the background:
       CONSTELLATION_TARGET_ROOT="$PWD" npm run dev --prefix __INSTALL_DIR__
   Wait ~2 seconds, verify http://127.0.0.1:47317/health returns {"ok":true}, and tell me the visualizer is at http://localhost:47318.
EOF
HANDOFF_PROMPT="${HANDOFF_PROMPT_TEMPLATE//__INSTALL_DIR__/$INSTALL_DIR}"

print_manual_paste() {
  say ""
  say "Open Claude Code in this directory and paste this prompt:"
  say ""
  printf '%s\n' "$HANDOFF_PROMPT"
  say ""
  say "(Once Claude finishes, the visualizer will be at http://localhost:47318.)"
}

if [ -t 0 ] && command -v claude >/dev/null 2>&1; then
  say ""
  printf 'Open Claude Code now in this directory with the handoff prompt loaded? [Y/n]: '
  read -r ans
  case "$ans" in
    n|N|no)
      print_manual_paste
      ;;
    *)
      say ""
      say "Launching Claude Code in plan mode..."
      exec claude --permission-mode plan "$HANDOFF_PROMPT"
      # Only reached if exec failed:
      err "Couldn't exec claude. Falling back to manual paste."
      print_manual_paste
      ;;
  esac
elif ! command -v claude >/dev/null 2>&1; then
  say ""
  say "(\`claude\` CLI not on PATH — install Claude Code, then paste this:)"
  print_manual_paste
else
  # Non-interactive: just print so the caller can use it.
  print_manual_paste
fi
