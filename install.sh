#!/usr/bin/env bash
# Constellation installer. Pipes from
# https://raw.githubusercontent.com/ian-klopper/Constellation/main/install.sh
# into bash, run from inside the user's git working tree (TARGET).
# Clones Constellation to a sibling directory, installs deps, copies
# hooks + skills into TARGET, and prints a one-paste handoff for Claude
# Code to do the .claude/settings.json merge + supervisor start.

set -euo pipefail

REPO_URL="https://github.com/ian-klopper/Constellation.git"
TARGET="$PWD"

say() { printf '%s\n' "$*"; }
err() { printf '%s\n' "$*" >&2; }
fail() { err "$*"; exit 1; }

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

# 3. Pick install dir --------------------------------------------------------

say ""
say "Where should Constellation be cloned (sibling to this repo)?"
say "Suggestions:"
say "  1) ~/code/constellation"
say "  2) ~/src/constellation"
say "  3) ~/projects/constellation"
say "  4) (type a custom absolute path)"
printf 'Choice [1-4 or path]: '
read -r choice </dev/tty
case "$choice" in
  1) INSTALL_DIR="$HOME/code/constellation" ;;
  2) INSTALL_DIR="$HOME/src/constellation" ;;
  3) INSTALL_DIR="$HOME/projects/constellation" ;;
  /*) INSTALL_DIR="$choice" ;;
  "~/"*) INSTALL_DIR="${choice/#\~/$HOME}" ;;
  *) fail "Need an absolute path or one of 1/2/3." ;;
esac

# 4. Idempotent clone --------------------------------------------------------

if [ -e "$INSTALL_DIR" ]; then
  if [ -f "$INSTALL_DIR/package.json" ] && [ "$(jq -r .name "$INSTALL_DIR/package.json" 2>/dev/null)" = "constellation" ]; then
    say ""
    say "Existing Constellation install found at $INSTALL_DIR."
    printf 'Update it (git fetch + checkout main)? [y/N]: '
    read -r ans </dev/tty
    case "$ans" in
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

# 5. Install deps ------------------------------------------------------------

say ""
say "Installing npm dependencies in $INSTALL_DIR ..."
npm ci --prefix "$INSTALL_DIR"

# 6. Copy hooks + skills + .gitignore ----------------------------------------

copy_with_prompt() {
  src="$1"
  dst="$2"
  if [ -e "$dst" ] && ! cmp -s "$src" "$dst"; then
    printf '  %s exists and differs. Overwrite? [y/N]: ' "$dst"
    read -r ans </dev/tty
    case "$ans" in y|Y|yes) ;; *) say "    skipped"; return ;; esac
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

# 7. Handoff -----------------------------------------------------------------

cat <<EOF

Constellation files installed.

To wire up the Claude Code hooks (modifies .claude/settings.json),
open Claude Code in this directory and paste:

    Wire up Constellation. Show me the JSON diff to add the matchers
    under .claude/hooks/constellation/* into .claude/settings.json,
    and the full contents of every script in .claude/hooks/constellation/.
    Wait for my approval before writing. Then start the visualizer with:
        CONSTELLATION_TARGET_ROOT="\$PWD" npm run dev --prefix $INSTALL_DIR
    in the background, wait ~2s, curl 127.0.0.1:47317/health, and tell
    me where to look.

The visualizer will run at http://localhost:47318 once the supervisor
is up.

EOF
