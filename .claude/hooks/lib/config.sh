# Shared config helper sourced by every hook script. Resolves the
# user-level Constellation directory and exports PORT and STATE_DIR.
# Reads ~/.constellation/config.json; if it isn't there yet (daemon
# never booted on this machine), we still know the bundled default port
# is 47317. The 500ms curl timeout in every hook means a missing
# daemon turns into a silent no-op anyway, so the fallback is forgiving.
#
# CONSTELLATION_USER_DIR overrides the home for tests and alternate
# installs. Production: ~/.constellation/.

USER_DIR="${CONSTELLATION_USER_DIR:-$HOME/.constellation}"
CONFIG_PATH="$USER_DIR/config.json"
STATE_DIR="$USER_DIR/state/agents"

config_get() {
  jq -r "$1" "$CONFIG_PATH" 2>/dev/null
}

if [ -f "$CONFIG_PATH" ]; then
  PORT="$(config_get '.daemon.port')"
  PORT="${PORT:-47317}"
else
  # Constellation hasn't booted on this machine yet (or someone wiped
  # the user dir). Fall back to the bundled default port. If the daemon
  # isn't actually running, the per-hook curl will time out at 500ms
  # and the hook exits with `|| true`.
  PORT=47317
fi
