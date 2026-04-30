#!/bin/bash
# PreToolUse on Agent. Writes a lifecycle file the visualizer reads.
# kind=background when the parent invoked Agent with run_in_background=true —
# those subagents run in a separate context and their file reads don't fire
# project-scoped hooks, so they show up as a parked icon for their lifetime
# and self-expire via the API's lastActiveAt staleness filter.

set -u

HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/config.sh
. "$HOOK_DIR/lib/config.sh"

input=$(cat)
id=$(printf '%s' "$input" | jq -r '.tool_use_id // empty')
[ -z "$id" ] && exit 0

mkdir -p "$STATE_DIR"
now=$(date +%s)

printf '%s' "$input" | jq -c --argjson ts "$now" '{
  id: .tool_use_id,
  subagent_type: (.tool_input.subagent_type // "unknown"),
  description: (.tool_input.description // ""),
  startedAt: $ts,
  lastActiveAt: $ts,
  kind: (if .tool_input.run_in_background then "background" else "foreground" end)
}' > "$STATE_DIR/${id}.json"
