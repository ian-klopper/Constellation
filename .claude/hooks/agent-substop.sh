#!/bin/bash
# Forwards SubagentStop to the daemon, which closes the lifecycle by
# matching agent_id against in-memory state — no glob, no jq, no race.

HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/config.sh
. "$HOOK_DIR/lib/config.sh"

PORT="$(config_get '.daemon.port')"
PORT="${PORT:-47317}"

cat | curl -s -m 0.5 -X POST -H 'Content-Type: application/json' \
  --data-binary @- "http://127.0.0.1:$PORT/event/subagent-stop" \
  >/dev/null 2>&1 || true
