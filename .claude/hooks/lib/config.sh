# Shared config helper sourced by every hook script. Resolves the project
# root, reads constellation.config.json, and exports STATE_DIR so scripts
# can stop hardcoding ".constellation/agents". Kept tiny and dependency-free
# (just jq, which the hooks already require).

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
else
  STATE_DIR_REL=".constellation/agents"
fi

STATE_DIR="$PROJECT_ROOT/$STATE_DIR_REL"
