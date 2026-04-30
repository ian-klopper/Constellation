#!/bin/bash
# Tails a background subagent's JSONL transcript and mirrors its tool calls
# into its lifecycle file (currentPath, currentActivity, status, lastActiveAt).
# BG subagents run in a separate execution context whose own tool calls don't
# fire parent hooks, so the transcript file is the only available source of
# truth for what they're touching. Spawned (detached) by agent-stop.sh after a
# BG launch and polls at 1Hz to match the visualizer's polling cadence.
#
# Self-terminates when the lifecycle file is removed by agent-substop.sh.
# Marks the agent idle if no new tool_use is seen for IDLE_TIMEOUT seconds.

set -u

HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/activity.sh
. "$HOOK_DIR/lib/activity.sh"

target="${1:?missing target}"
transcript="${2:?missing transcript}"
cwd="${3:-}"

IDLE_TIMEOUT=3

[ ! -f "$target" ] && exit 0

for _ in $(seq 1 20); do
  [ -e "$transcript" ] && break
  sleep 0.5
done

last_count=0
last_tool_at=$(date +%s)
is_idle=0

apply_idle() {
  [ -f "$target" ] || return 0
  local now tmp
  now=$(date +%s)
  tmp="${target}.tmp.$$"
  if jq --argjson ts "$now" \
       '. + {status: "idle", lastActiveAt: $ts}' \
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
    # No new lines. Check if we've crossed the idle threshold.
    now=$(date +%s)
    if [ $((now - last_tool_at)) -ge "$IDLE_TIMEOUT" ] && [ "$is_idle" -eq 0 ]; then
      apply_idle
      is_idle=1
    fi
    sleep 1
    continue
  fi

  # Pull the latest tool_use from the new lines. Output a TSV-ish "name<TAB>input"
  # so we can format with the shared activity formatter.
  latest=$(tail -n $((total - last_count)) "$transcript" 2>/dev/null | jq -r '
    .message?.content? // [] | .[]?
    | select(.type == "tool_use")
    | select(.name == "Read" or .name == "Edit" or .name == "Write" or .name == "MultiEdit" or .name == "Bash" or .name == "Grep" or .name == "Glob" or .name == "Task" or .name == "Agent" or .name == "WebFetch" or .name == "WebSearch")
    | [.name, (.input | tostring)] | @tsv
  ' 2>/dev/null | tail -n 1)

  last_count=$total

  if [ -z "$latest" ]; then
    sleep 1
    continue
  fi

  tool_name="${latest%%	*}"
  tool_input="${latest#*	}"

  activity=$(format_activity "$tool_name" "$tool_input")

  # Only Read/Edit/Write/MultiEdit have file_path -> currentPath. Other tools
  # leave currentPath untouched so the icon stays anchored to the last file.
  fpath=""
  case "$tool_name" in
    Read|Edit|Write|MultiEdit)
      fpath=$(printf '%s' "$tool_input" | jq -r '.file_path // empty' 2>/dev/null)
      ;;
  esac

  rel=""
  if [ -n "$fpath" ]; then
    rel="$fpath"
    if [ -n "$cwd" ] && [ "${fpath#$cwd/}" != "$fpath" ]; then
      rel="${fpath#$cwd/}"
    fi
  fi

  now=$(date +%s)
  last_tool_at=$now
  is_idle=0

  merge_filter='. + {status: "active", lastActiveAt: $ts}'
  [ -n "$activity" ] && merge_filter="$merge_filter"' + {currentActivity: $activity}'
  [ -n "$rel" ] && merge_filter="$merge_filter"' + {currentPath: $path}'

  tmp="${target}.tmp.$$"
  if [ ! -f "$target" ]; then
    break
  fi
  if jq --arg path "$rel" --arg activity "$activity" --argjson ts "$now" \
       "$merge_filter" \
       < "$target" > "$tmp" 2>/dev/null; then
    if [ -f "$target" ]; then
      mv "$tmp" "$target"
    else
      rm -f "$tmp"
      break
    fi
  else
    rm -f "$tmp"
  fi

  sleep 1
done

exit 0
