#!/bin/bash
# PostToolUse on Agent. Foreground spawns: delete the lifecycle file (the
# parent's tool returns when the agent is done, so this is the natural close).
# Background spawns: the parent's tool returns immediately at spawn-time, so
# we instead record the child's agentId from tool_response, and SubagentStop
# does the eventual cleanup when the child actually finishes.

set -u

HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/config.sh
. "$HOOK_DIR/lib/config.sh"

input=$(cat)
id=$(printf '%s' "$input" | jq -r '.tool_use_id // empty')
[ -z "$id" ] && exit 0

target="$STATE_DIR/${id}.json"
[ ! -f "$target" ] && exit 0

kind=$(jq -r '.kind // "foreground"' < "$target" 2>/dev/null)

if [ "$kind" = "foreground" ]; then
  rm -f "$target"
  exit 0
fi

child_aid=$(printf '%s' "$input" | jq -r '.tool_response.agentId // empty')
[ -z "$child_aid" ] && exit 0

tmp="${target}.tmp.$$"
if jq --arg aid "$child_aid" '. + {agentId: $aid}' < "$target" > "$tmp" 2>/dev/null; then
  mv "$tmp" "$target"
else
  rm -f "$tmp"
fi

output_file=$(printf '%s' "$input" | jq -r '.tool_response.outputFile // empty')
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty')
if [ -n "$output_file" ]; then
  nohup "$HOOK_DIR/agent-watch.sh" "$target" "$output_file" "$cwd" >/dev/null 2>&1 &
  disown 2>/dev/null || true
fi
