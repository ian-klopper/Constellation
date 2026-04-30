#!/bin/bash
# Mark an agent's lifecycle file as idle.
# Wired to: PostToolUse on the same matcher as agent-touch.sh, and Stop (main
# agent finished its turn). Reads stdin like the other hooks. Sub-second
# transitions between active/idle are debounced on the client side; this hook
# just records the transition truthfully.

set -u

HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/config.sh
. "$HOOK_DIR/lib/config.sh"

input=$(cat)
aid=$(printf '%s' "$input" | jq -r '.agent_id // empty')
hook_event=$(printf '%s' "$input" | jq -r '.hook_event_name // empty')

mkdir -p "$STATE_DIR"
shopt -s nullglob
now=$(date +%s)

flip_idle() {
  local target="$1"
  [ -f "$target" ] || return 0
  local tmp="${target}.tmp.$$"
  if jq --argjson ts "$now" \
       '. + {status: "idle", lastActiveAt: $ts}' \
       < "$target" > "$tmp" 2>/dev/null; then
    if [ -f "$target" ]; then
      mv "$tmp" "$target"
    else
      rm -f "$tmp"
    fi
  else
    rm -f "$tmp"
  fi
}

# Main agent or Stop event: target _main.json.
if [ -z "$aid" ] || [ "$hook_event" = "Stop" ]; then
  flip_idle "$STATE_DIR/_main.json"
  exit 0
fi

# Foreground subagent: find the lifecycle file by matching agentId.
for f in "$STATE_DIR"/*.json; do
  case "$(basename "$f")" in _*) continue ;; esac
  fid=$(jq -r '.agentId // empty' < "$f" 2>/dev/null) || continue
  if [ "$fid" = "$aid" ]; then
    flip_idle "$f"
    break
  fi
done

exit 0
