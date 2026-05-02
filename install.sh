#!/usr/bin/env bash
# Constellation installer. Run from any shell:
#   bash <(curl -fsSL https://raw.githubusercontent.com/ian-klopper/Constellation/main/install.sh)
# Process substitution (not curl-pipe-bash) so stdin stays the user's
# terminal — `read` works without /dev/tty gymnastics.
#
# Sets up Constellation as a system-level singleton:
# 1. Clones Constellation to ~/.constellation/app/ (override with
#    CONSTELLATION_INSTALL_DIR=<absolute-path>).
# 2. npm ci + npm run build (compiles the daemon to dist/).
# 3. Symlinks the constellation CLI onto PATH.
# 4. Runs `constellation service install` to register a launchd agent
#    that keeps the daemon alive across reboots and logins.
#
# After this, end-user setup of a new repo is `cd <repo> && constellation add`.
# No more per-repo install.sh.

set -euo pipefail

REPO_URL="https://github.com/ian-klopper/Constellation.git"
REF="${CONSTELLATION_REF:-main}"
USER_DIR="${CONSTELLATION_USER_DIR:-$HOME/.constellation}"
INSTALL_DIR="${CONSTELLATION_INSTALL_DIR:-$USER_DIR/app}"

say() { printf '%s\n' "$*"; }
err() { printf '%s\n' "$*" >&2; }
fail() { err "$*"; exit 1; }

# 1. Preflight ---------------------------------------------------------------

command -v node >/dev/null 2>&1 || fail "Constellation needs Node 20 or newer (nodejs.org or 'nvm install 20')."
node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
[ "$node_major" -ge 20 ] 2>/dev/null || fail "Constellation needs Node 20 or newer; you have $(node -v)."

command -v jq >/dev/null 2>&1 || fail "Constellation's hook shims need jq. macOS: 'brew install jq'. Debian/Ubuntu: 'apt install jq'."
command -v git >/dev/null 2>&1 || fail "Constellation's installer needs git on PATH."

# 2. Idempotent clone --------------------------------------------------------

case "$INSTALL_DIR" in
  /*) ;;
  *) fail "CONSTELLATION_INSTALL_DIR must be absolute; got $INSTALL_DIR" ;;
esac

if [ -d "$INSTALL_DIR/.git" ] && [ -f "$INSTALL_DIR/package.json" ] && \
   [ "$(jq -r .name "$INSTALL_DIR/package.json" 2>/dev/null)" = "constellation" ]; then
  say "Updating existing Constellation install at $INSTALL_DIR (ref $REF)..."
  git -C "$INSTALL_DIR" fetch --depth 1 origin \
    "+refs/heads/$REF:refs/remotes/origin/$REF"
  git -C "$INSTALL_DIR" checkout "origin/$REF"
elif [ -e "$INSTALL_DIR" ]; then
  fail "$INSTALL_DIR exists but isn't a Constellation clone. Remove it or set CONSTELLATION_INSTALL_DIR to a different path."
else
  say "Cloning Constellation ($REF) into $INSTALL_DIR ..."
  mkdir -p "$(dirname "$INSTALL_DIR")"
  if [ "$REF" = "main" ]; then
    git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
  else
    git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
    git -C "$INSTALL_DIR" fetch --depth 1 origin \
      "+refs/heads/$REF:refs/remotes/origin/$REF"
    git -C "$INSTALL_DIR" checkout "origin/$REF"
  fi
fi

# 3. Install deps + build ----------------------------------------------------

say ""
say "Installing dependencies in $INSTALL_DIR ..."
npm ci --prefix "$INSTALL_DIR"

say ""
say "Building the daemon ..."
( cd "$INSTALL_DIR" && npm run build:daemon )

# 4. Symlink CLI onto PATH ---------------------------------------------------

CLI_SRC="$INSTALL_DIR/bin/constellation"
[ -f "$CLI_SRC" ] || fail "Missing $CLI_SRC after clone — install dir is corrupt."
chmod +x "$CLI_SRC"

# Pick a directory on PATH for the symlink. /usr/local/bin if it's
# writable without sudo, else ~/.local/bin (no sudo needed at all, but
# might not be on PATH on a vanilla shell).
LINK_TARGET=""
if [ -w "/usr/local/bin" ]; then
  LINK_TARGET="/usr/local/bin/constellation"
else
  mkdir -p "$HOME/.local/bin"
  LINK_TARGET="$HOME/.local/bin/constellation"
fi

if [ -e "$LINK_TARGET" ] && [ ! -L "$LINK_TARGET" ]; then
  err ""
  err "$LINK_TARGET exists and isn't a symlink — leaving it alone."
  err "Remove the file and re-run, or invoke the CLI directly: $CLI_SRC"
else
  ln -sf "$CLI_SRC" "$LINK_TARGET"
  say ""
  say "✓ Symlinked $LINK_TARGET → $CLI_SRC"
fi

# Warn if the chosen directory isn't on PATH. Most macOS shells include
# /usr/local/bin already; ~/.local/bin commonly isn't.
LINK_DIR="$(dirname "$LINK_TARGET")"
case ":$PATH:" in
  *":$LINK_DIR:"*) ;;
  *)
    say ""
    say "Note: $LINK_DIR isn't on your PATH. Add this to your shell rc:"
    say "    export PATH=\"$LINK_DIR:\$PATH\""
    ;;
esac

# 5. Set up launchd agent (Mac) ----------------------------------------------

if [ "$(uname)" = "Darwin" ]; then
  say ""
  say "Installing launchd agent ..."
  "$CLI_SRC" service install
else
  say ""
  say "Linux detected — launchd integration is Mac-only. Run the daemon manually:"
  say "    node $INSTALL_DIR/dist/daemon/index.js"
  say "or under a process manager of your choice (systemd, supervisord, pm2)."
fi

# 6. Done --------------------------------------------------------------------

say ""
say "✓ Constellation installed."
say ""
say "Next steps:"
say "  1. cd into a repo you want to track."
say "  2. Run: constellation add"
say "     (Copies hook shims, merges .claude/settings.json, registers the repo with the daemon.)"
say "  3. Run: constellation open"
say "     (Opens the visualizer in your browser, scoped to that repo.)"
say ""
say "Other useful commands:"
say "  constellation list      Show all registered repos."
say "  constellation status    Daemon health + log path."
say "  constellation logs -f   Tail the daemon log."
say "  constellation help      Full reference."
