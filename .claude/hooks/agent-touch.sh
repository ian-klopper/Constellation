#!/bin/bash
# Record live agent activity for the visualizer.
# Called from PreToolUse on every tool we want to surface (Read, Edit, Write,
# MultiEdit, Bash, Grep, Glob, Task, WebFetch, WebSearch). Reads hook payload
# from stdin. Subagent calls (agent_id present) lazy-bind to a lifecycle file
# written by the Agent PreToolUse hook. Main-agent calls (agent_id empty)
# upsert _main.json and lazy-launch the JSONL transcript watcher.

set -u

HOOK_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib/activity.sh
. "$HOOK_DIR/lib/activity.sh"
# shellcheck source=lib/config.sh
. "$HOOK_DIR/lib/config.sh"

input=$(cat)
aid=$(printf '%s' "$input" | jq -r '.agent_id // empty')
tool_name=$(printf '%s' "$input" | jq -r '.tool_name // empty')
tool_input_json=$(printf '%s' "$input" | jq -c '.tool_input // {}')
fpath=$(printf '%s' "$tool_input_json" | jq -r '.file_path // empty')
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty')
transcript_path=$(printf '%s' "$input" | jq -r '.transcript_path // empty')

activity=$(format_activity "$tool_name" "$tool_input_json")

# Relativize file_path against cwd, fall back to absolute. Empty when no path.
rel=""
if [ -n "$fpath" ]; then
  rel="$fpath"
  if [ -n "$cwd" ] && [ "${fpath#$cwd/}" != "$fpath" ]; then
    rel="${fpath#$cwd/}"
  fi
fi

mkdir -p "$STATE_DIR"
shopt -s nullglob
now=$(date +%s)

# Build the merge payload. currentPath only when we have one; activity only when
# the formatter produced something. status is always "active".
merge_filter='. + {status: "active", lastActiveAt: $ts}'
[ -n "$activity" ] && merge_filter="$merge_filter"' + {currentActivity: $activity}'
[ -n "$rel" ] && merge_filter="$merge_filter"' + {currentPath: $path}'

# Main agent: upsert _main.json. Underscore prefix keeps it out of subagent bind loops.
if [ -z "$aid" ]; then
  target="$STATE_DIR/_main.json"
  tmp="${target}.tmp.$$"
  if [ -f "$target" ]; then
    if jq --arg path "$rel" --arg activity "$activity" --argjson ts "$now" \
         "$merge_filter" \
         < "$target" > "$tmp" 2>/dev/null; then
      mv "$tmp" "$target"
    else
      rm -f "$tmp"
    fi
  else
    create_filter='{id: "main", subagent_type: "main", description: "Claude (main)", startedAt: $ts, lastActiveAt: $ts, status: "active"}'
    [ -n "$activity" ] && create_filter="$create_filter"' + {currentActivity: $activity}'
    [ -n "$rel" ] && create_filter="$create_filter"' + {currentPath: $path}'
    if jq -n --arg path "$rel" --arg activity "$activity" --argjson ts "$now" \
         "$create_filter" \
         > "$tmp" 2>/dev/null; then
      mv "$tmp" "$target"
    else
      rm -f "$tmp"
    fi
  fi

  # Lazy-launch the main-agent transcript watcher. Dedupe by transcript_path so
  # /resume doesn't spawn duplicates.
  if [ -n "$transcript_path" ] && [ -x "$HOOK_DIR/agent-main-watch.sh" ]; then
    if ! pgrep -f "agent-main-watch.sh.*$transcript_path" > /dev/null 2>&1; then
      nohup "$HOOK_DIR/agent-main-watch.sh" "$transcript_path" > /dev/null 2>&1 &
      disown 2>/dev/null || true
    fi
  fi
  exit 0
fi

atype=$(printf '%s' "$input" | jq -r '.agent_type // empty')

# 1) If we've already bound this agent_id to a lifecycle file, reuse it.
target=""
for f in "$STATE_DIR"/*.json; do
  case "$(basename "$f")" in _*) continue ;; esac
  fid=$(jq -r '.agentId // empty' < "$f" 2>/dev/null) || continue
  if [ "$fid" = "$aid" ]; then
    target="$f"
    break
  fi
done

# 2) Otherwise lazy-bind: pick oldest lifecycle file with matching subagent_type
#    and no agentId yet.
if [ -z "$target" ]; then
  oldest=""
  oldest_mtime=""
  for f in "$STATE_DIR"/*.json; do
    case "$(basename "$f")" in _*) continue ;; esac
    fid=$(jq -r '.agentId // empty' < "$f" 2>/dev/null) || continue
    [ -n "$fid" ] && continue
    ftype=$(jq -r '.subagent_type // empty' < "$f" 2>/dev/null) || continue
    [ "$ftype" != "$atype" ] && continue
    mtime=$(stat -f %m "$f" 2>/dev/null || stat -c %Y "$f" 2>/dev/null)
    if [ -z "$oldest_mtime" ] || [ "$mtime" -lt "$oldest_mtime" ]; then
      oldest="$f"
      oldest_mtime="$mtime"
    fi
  done
  target="$oldest"
fi

[ -z "$target" ] && exit 0

# Subagent merge always sets agentId so the bind sticks.
sub_filter='. + {agentId: $aid, status: "active", lastActiveAt: $ts}'
[ -n "$activity" ] && sub_filter="$sub_filter"' + {currentActivity: $activity}'
[ -n "$rel" ] && sub_filter="$sub_filter"' + {currentPath: $path}'

# Atomic update: write to temp, then mv.
tmp="${target}.tmp.$$"
if jq --arg aid "$aid" --arg path "$rel" --arg activity "$activity" --argjson ts "$now" \
     "$sub_filter" \
     < "$target" > "$tmp" 2>/dev/null; then
  mv "$tmp" "$target"
else
  rm -f "$tmp"
fi

exit 0
