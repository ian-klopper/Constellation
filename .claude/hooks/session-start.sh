#!/bin/bash
# Forwards SessionStart to the daemon (which clears its in-memory state)
# and also wipes the on-disk lifecycle files as a belt-and-suspenders
# cleanup so a stale file from a crashed previous session can't survive.

HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/config.sh
. "$HOOK_DIR/lib/config.sh"

PORT="$(config_get '.daemon.port')"
PORT="${PORT:-47317}"

curl -s -m 0.5 -X POST -H 'Content-Type: application/json' \
  -d '{}' "http://127.0.0.1:$PORT/event/session-start" \
  >/dev/null 2>&1 || true

rm -f "$STATE_DIR"/*.json 2>/dev/null || true
