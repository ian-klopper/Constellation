#!/bin/bash
# Forwards Agent PreToolUse to the constellation daemon. Fire-and-forget:
# 500ms timeout + `|| true` keeps the user's Claude Code session healthy
# even if the daemon is down. The daemon-side handler lives in
# daemon/lifecycle.ts → handleAgentStart.

HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/config.sh
. "$HOOK_DIR/lib/config.sh"

cat | curl -s -m 0.5 -X POST -H 'Content-Type: application/json' \
  --data-binary @- "http://127.0.0.1:$PORT/event/agent-start" \
  >/dev/null 2>&1 || true
