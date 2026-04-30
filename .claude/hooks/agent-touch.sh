#!/bin/bash
# Forwards every PreToolUse on a watched tool to the daemon. The daemon
# does the lazy-bind for foreground subagents, the upsert for the main
# agent, the activity-string formatting, and (on first main-agent touch)
# the transcript-watcher spawn — all in one place, with a single writer.

HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/config.sh
. "$HOOK_DIR/lib/config.sh"

PORT="$(config_get '.daemon.port')"
PORT="${PORT:-47317}"

cat | curl -s -m 0.5 -X POST -H 'Content-Type: application/json' \
  --data-binary @- "http://127.0.0.1:$PORT/event/touch" \
  >/dev/null 2>&1 || true
