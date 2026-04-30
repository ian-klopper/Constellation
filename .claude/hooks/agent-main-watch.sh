#!/bin/bash
# Tails the main Claude agent's JSONL transcript and writes:
#   - currentActivity: latest tool_use, formatted via lib/activity.sh
#   - currentMessage:  first sentence of the latest assistant text block
#   - status: "idle" if no new tool_use or text block in IDLE_TIMEOUT seconds
#
# Spawned (detached) by agent-touch.sh on the first main-agent tool call.
# Self-terminates when _main.json is removed (SessionStart cleanup or manual
# wipe). Dedupes by transcript_path via pgrep before re-spawning.

set -u

HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/activity.sh
. "$HOOK_DIR/lib/activity.sh"

transcript="${1:?missing transcript}"
target=".constellation/agents/_main.json"

# Wait for the transcript to exist (newly resumed sessions may not have it yet).
for _ in $(seq 1 20); do
  [ -e "$transcript" ] && break
  sleep 0.5
done

last_count=0

# Status is owned by the explicit hooks (agent-touch.sh sets "active" on
# PreToolUse, agent-idle.sh sets "idle" on Stop). The watcher only fills in
# narrative fields and bumps lastActiveAt — it must NOT touch status, or it
# will race against agent-idle.sh after Stop and re-flip the icon to active.

write_message() {
  local msg="$1"
  [ -z "$msg" ] && return 0
  [ -f "$target" ] || return 0
  local now tmp
  now=$(date +%s)
  tmp="${target}.tmp.$$"
  if jq --arg msg "$msg" --argjson ts "$now" \
       '. + {currentMessage: $msg, lastActiveAt: $ts}' \
       < "$target" > "$tmp" 2>/dev/null; then
    if [ -f "$target" ]; then
      mv "$tmp" "$target"
    else
      rm -f "$tmp"
    fi
  else
    rm -f "$tmp"
  fi
}

write_activity() {
  local activity="$1"
  [ -z "$activity" ] && return 0
  [ -f "$target" ] || return 0
  local now tmp
  now=$(date +%s)
  tmp="${target}.tmp.$$"
  if jq --arg activity "$activity" --argjson ts "$now" \
       '. + {currentActivity: $activity, lastActiveAt: $ts}' \
       < "$target" > "$tmp" 2>/dev/null; then
    if [ -f "$target" ]; then
      mv "$tmp" "$target"
    else
      rm -f "$tmp"
    fi
  else
    rm -f "$tmp"
  fi
}

while [ -f "$target" ]; do
  if [ ! -e "$transcript" ]; then
    sleep 1
    continue
  fi

  total=$(wc -l < "$transcript" 2>/dev/null | tr -d ' ' || echo 0)
  if [ -z "$total" ] || [ "$total" -le "$last_count" ]; then
    sleep 1
    continue
  fi

  new_lines=$(tail -n $((total - last_count)) "$transcript" 2>/dev/null)
  last_count=$total

  # Latest tool_use of any tool we surface.
  latest_tool=$(printf '%s' "$new_lines" | jq -r '
    .message?.content? // [] | .[]?
    | select(.type == "tool_use")
    | select(.name == "Read" or .name == "Edit" or .name == "Write" or .name == "MultiEdit" or .name == "Bash" or .name == "Grep" or .name == "Glob" or .name == "Task" or .name == "Agent" or .name == "WebFetch" or .name == "WebSearch")
    | [.name, (.input | tostring)] | @tsv
  ' 2>/dev/null | tail -n 1)

  # Latest assistant text block. Take the first sentence (up to . ! ? or 80 chars).
  latest_text=$(printf '%s' "$new_lines" | jq -r '
    select(.type == "assistant")
    | .message?.content? // [] | .[]?
    | select(.type == "text")
    | .text // empty
  ' 2>/dev/null | tail -n 1)

  if [ -n "$latest_tool" ]; then
    tool_name="${latest_tool%%	*}"
    tool_input="${latest_tool#*	}"
    activity=$(format_activity "$tool_name" "$tool_input")
    write_activity "$activity"
  fi

  if [ -n "$latest_text" ]; then
    # First sentence: trim leading whitespace, take through first sentence-end
    # punctuation, fall back to 80 chars.
    snippet=$(printf '%s' "$latest_text" \
      | tr '\n' ' ' \
      | sed -E 's/^[[:space:]]+//' \
      | awk 'BEGIN{RS="[.!?]"} NR==1{print; exit}' \
      | head -c 80)
    # If the awk-grabbed first sentence is empty (no punctuation in the chunk),
    # just take the first 80 chars of the chunk.
    if [ -z "$snippet" ]; then
      snippet=$(printf '%s' "$latest_text" | tr '\n' ' ' | sed -E 's/^[[:space:]]+//' | head -c 80)
    fi
    write_message "$snippet"
  fi

  sleep 1
done

exit 0
