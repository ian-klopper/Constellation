#!/bin/bash
# SubagentStop fires when any subagent (foreground or background) finishes.
# We clean up the lifecycle file by matching agent_id against the file's
# agentId field. For foreground, agent-touch.sh sets agentId during the
# agent's first Read/Edit/Write. For background, agent-stop.sh sets it from
# the spawn's tool_response. Either way, this is the universal "close" hook.

set -u
input=$(cat)
aid=$(printf '%s' "$input" | jq -r '.agent_id // empty')
[ -z "$aid" ] && exit 0

shopt -s nullglob

for f in .constellation/agents/*.json; do
  case "$(basename "$f")" in _*) continue ;; esac
  fid=$(jq -r '.agentId // empty' < "$f" 2>/dev/null) || continue
  if [ "$fid" = "$aid" ]; then
    rm -f "$f"
    exit 0
  fi
done
