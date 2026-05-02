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
#
# We need git (clone), node 20+ (build), and jq (the hook shims read the
# daemon port from JSON config). Missing deps used to be a hard fail; now
# the installer offers to install them via the platform package manager
# (brew on macOS — bootstrapped on the fly if absent — and apt/dnf/pacman/apk
# on Linux). Set CONSTELLATION_AUTO_INSTALL=1 to skip prompts (assume yes),
# or CONSTELLATION_NO_AUTO_INSTALL=1 to revert to today's fail-hard behavior.

prompt_yn() {
  # $1: prompt text. Default Y on bare Enter.
  if [ "${CONSTELLATION_AUTO_INSTALL:-0}" = "1" ]; then return 0; fi
  if [ "${CONSTELLATION_NO_AUTO_INSTALL:-0}" = "1" ]; then return 1; fi
  printf '%s [Y/n] ' "$1"
  local reply=""
  read -r reply || true
  case "${reply:-y}" in
    [yY]|[yY][eE][sS]|"") return 0 ;;
    *) return 1 ;;
  esac
}

detect_pkg_manager() {
  # Echoes brew | apt | dnf | pacman | apk | "" (none found).
  if [ "$(uname)" = "Darwin" ]; then
    if command -v brew >/dev/null 2>&1; then echo brew; else echo ""; fi
    return
  fi
  if command -v apt-get >/dev/null 2>&1; then echo apt; return; fi
  if command -v dnf     >/dev/null 2>&1; then echo dnf; return; fi
  if command -v pacman  >/dev/null 2>&1; then echo pacman; return; fi
  if command -v apk     >/dev/null 2>&1; then echo apk; return; fi
  echo ""
}

bootstrap_brew() {
  # macOS-only. Installs Homebrew if it's not already on PATH, then sources
  # `brew shellenv` so the rest of this script can call `brew` directly.
  command -v brew >/dev/null 2>&1 && return 0
  prompt_yn "Homebrew (brew) is needed to install missing deps on macOS. Install it now from brew.sh?" || return 1
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" || return 1
  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [ -x /usr/local/bin/brew ]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
  command -v brew >/dev/null 2>&1
}

install_pkg() {
  # $1: package name. Caller must have already detected a manager.
  local pkg="$1"
  local mgr; mgr="$(detect_pkg_manager)"
  case "$mgr" in
    brew)   brew install "$pkg" ;;
    apt)    sudo apt-get update && sudo apt-get install -y "$pkg" ;;
    dnf)    sudo dnf install -y "$pkg" ;;
    pacman) sudo pacman -S --noconfirm "$pkg" ;;
    apk)    sudo apk add "$pkg" ;;
    *)      return 1 ;;
  esac
}

ensure_dep() {
  # $1: command to probe (e.g. jq)
  # $2: package name to install (often same as $1)
  # $3: failure message if we can't auto-install or the user declines.
  local cmd="$1" pkg="$2" failmsg="$3"
  command -v "$cmd" >/dev/null 2>&1 && return 0

  local mgr; mgr="$(detect_pkg_manager)"
  if [ -z "$mgr" ] && [ "$(uname)" = "Darwin" ]; then
    say ""
    say "$cmd is missing, and Homebrew isn't installed yet."
    bootstrap_brew || fail "$failmsg"
    mgr="brew"
  fi
  if [ -z "$mgr" ]; then
    fail "$failmsg"
  fi

  say ""
  say "$cmd is missing. The installer can install '$pkg' via $mgr."
  case "$mgr" in
    apt|dnf|pacman|apk) say "(This will use sudo and may prompt for your password.)" ;;
  esac
  prompt_yn "Install $pkg now?" || fail "$failmsg"
  install_pkg "$pkg" || fail "$failmsg"
  command -v "$cmd" >/dev/null 2>&1 || fail "$failmsg (install ran but $cmd is still not on PATH)"
}

install_node_20() {
  # Install Node 20 via the detected package manager. Only called when no
  # `node` is on PATH at all — we never auto-upgrade an existing Node, since
  # the user may have nvm/asdf/fnm pinning a version on purpose.
  local mgr; mgr="$(detect_pkg_manager)"
  if [ -z "$mgr" ] && [ "$(uname)" = "Darwin" ]; then
    say ""
    say "Node is missing, and Homebrew isn't installed yet."
    bootstrap_brew || return 1
    mgr="brew"
  fi
  if [ -z "$mgr" ]; then
    return 1
  fi
  say ""
  say "Node is missing. The installer can install Node 20 via $mgr."
  case "$mgr" in
    brew)
      prompt_yn "Run: brew install node@20 (and brew link --overwrite --force node@20)?" || return 1
      brew install node@20 || return 1
      brew link --overwrite --force node@20 || return 1
      ;;
    apt)
      say "(Uses NodeSource — Debian/Ubuntu's own 'nodejs' package is too old. Will use sudo.)"
      prompt_yn "Run NodeSource setup_20.x + apt-get install -y nodejs?" || return 1
      curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - || return 1
      sudo apt-get install -y nodejs || return 1
      ;;
    dnf)
      say "(Uses NodeSource. Will use sudo.)"
      prompt_yn "Run NodeSource setup_20.x + dnf install -y nodejs?" || return 1
      curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash - || return 1
      sudo dnf install -y nodejs || return 1
      ;;
    pacman)
      prompt_yn "Run: sudo pacman -S --noconfirm nodejs npm?" || return 1
      sudo pacman -S --noconfirm nodejs npm || return 1
      ;;
    apk)
      prompt_yn "Run: sudo apk add nodejs npm?" || return 1
      sudo apk add nodejs npm || return 1
      ;;
    *)
      return 1
      ;;
  esac
  command -v node >/dev/null 2>&1
}

ensure_dep git git "Constellation's installer needs git on PATH."
ensure_dep jq  jq  "Constellation's hook shims need jq. macOS: 'brew install jq'. Debian/Ubuntu: 'apt install jq'."

if ! command -v node >/dev/null 2>&1; then
  install_node_20 || fail "Constellation needs Node 20 or newer (nodejs.org or 'nvm install 20')."
fi
node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
[ "$node_major" -ge 20 ] 2>/dev/null || fail "Constellation needs Node 20 or newer; you have $(node -v). Run 'nvm install 20' to upgrade without affecting other Node projects."

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
