# Shared config helper sourced by every hook script. Resolves the project
# root, reads constellation.config.json when present, and exports STATE_DIR
# and PORT so scripts can stop hardcoding ".constellation/agents" and the
# daemon port. Kept tiny and dependency-free (just jq, which the hooks
# already require).
#
# Sibling-clone install: under Constellation's onboarding prompt, this
# script gets copied into <target>/.claude/hooks/constellation/lib/, and the
# target has no constellation.config.json (the plan decided against an
# install.json pointer file). The else branch below is the foreign-target
# path — its hardcoded defaults must match the install's
# constellation.config.json defaults, or hooks won't reach the daemon.

# CLAUDE_PROJECT_DIR is set by Claude Code; fall back to git toplevel for
# manual invocations.
PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
PROJECT_ROOT="${PROJECT_ROOT:-$PWD}"

CONFIG_PATH="$PROJECT_ROOT/constellation.config.json"

config_get() {
  jq -r "$1" "$CONFIG_PATH" 2>/dev/null
}

if [ -f "$CONFIG_PATH" ]; then
  STATE_DIR_REL="$(config_get '.stateDir')"
  STATE_DIR_REL="${STATE_DIR_REL:-.constellation/agents}"
  PORT="$(config_get '.daemon.port')"
  PORT="${PORT:-47317}"
else
  # Foreign-target fallback. These constants must match the install's
  # constellation.config.json defaults.
  STATE_DIR_REL=".constellation/agents"
  PORT=47317
fi

STATE_DIR="$PROJECT_ROOT/$STATE_DIR_REL"
