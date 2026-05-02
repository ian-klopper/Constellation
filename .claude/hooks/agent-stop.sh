#!/bin/bash
# Forwards Agent PostToolUse to the daemon. The daemon decides whether to
# delete the lifecycle (foreground) or stash agentId for SubagentStop to
# clean up (background), and spawns a transcript watcher in-process for BG.

HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/config.sh
. "$HOOK_DIR/lib/config.sh"

cat | curl -s -m 0.5 -X POST -H 'Content-Type: application/json' \
  --data-binary @- "http://127.0.0.1:$PORT/event/agent-stop" \
  >/dev/null 2>&1 || true
