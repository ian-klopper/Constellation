#!/bin/bash
# Forwards SessionStart to the daemon (which clears that session's
# in-memory state) and also wipes the on-disk lifecycle files for this
# session as a belt-and-suspenders cleanup so a stale file from a
# crashed previous run can't survive. With multi-session support, the
# wipe is scoped to ${SESSION_ID}__*.json — other sessions' files in
# the same repo are left alone.

HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/config.sh
. "$HOOK_DIR/lib/config.sh"

PORT="$(config_get '.daemon.port')"
PORT="${PORT:-47317}"

# Buffer stdin once so we can both forward it to the daemon and pull
# session_id out of it for the on-disk cleanup.
PAYLOAD="$(cat)"

printf '%s' "$PAYLOAD" \
  | curl -s -m 0.5 -X POST -H 'Content-Type: application/json' \
      --data-binary @- "http://127.0.0.1:$PORT/event/session-start" \
      >/dev/null 2>&1 || true

SESSION_ID="$(printf '%s' "$PAYLOAD" | jq -r '.session_id // empty' 2>/dev/null)"
if [ -n "$SESSION_ID" ]; then
  # Sanitize the session id the same way atomic-write.ts does
  # ([^A-Za-z0-9._-] → _) so the glob matches the filenames the
  # daemon would have written.
  SAFE_SESSION="$(printf '%s' "$SESSION_ID" | tr -c 'A-Za-z0-9._-' '_')"
  rm -f "$STATE_DIR/${SAFE_SESSION}__"*.json 2>/dev/null || true
fi
