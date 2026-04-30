#!/bin/bash
# Forwards PostToolUse and Stop events. Daemon flips the agent's status
# to "idle" — no atomic-write race because the daemon is the single writer.

HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/config.sh
. "$HOOK_DIR/lib/config.sh"

PORT="$(config_get '.daemon.port')"
PORT="${PORT:-47317}"

cat | curl -s -m 0.5 -X POST -H 'Content-Type: application/json' \
  --data-binary @- "http://127.0.0.1:$PORT/event/idle" \
  >/dev/null 2>&1 || true
