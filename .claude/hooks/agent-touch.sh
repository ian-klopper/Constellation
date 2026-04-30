#!/bin/bash
# Record live agent file activity for the visualizer.
# Called from PreToolUse on Read|Edit|Write|MultiEdit. Reads hook payload from stdin.
# Subagent calls (agent_id present) lazy-bind to a lifecycle file written by the
# Agent PreToolUse hook. Main-agent calls (agent_id empty) upsert _main.json.

set -u

input=$(cat)
aid=$(printf '%s' "$input" | jq -r '.agent_id // empty')
fpath=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty')
[ -z "$fpath" ] && exit 0

# Relativize file_path against cwd, fall back to absolute.
rel="$fpath"
if [ -n "$cwd" ] && [ "${fpath#$cwd/}" != "$fpath" ]; then
  rel="${fpath#$cwd/}"
fi

mkdir -p .constellation/agents
shopt -s nullglob
now=$(date +%s)

# Main agent: upsert _main.json. Underscore prefix keeps it out of subagent bind loops.
if [ -z "$aid" ]; then
  target=".constellation/agents/_main.json"
  tmp="${target}.tmp.$$"
  if [ -f "$target" ]; then
    if jq --arg path "$rel" --argjson ts "$now" \
         '. + {lastActiveAt: $ts, currentPath: $path}' \
         < "$target" > "$tmp" 2>/dev/null; then
      mv "$tmp" "$target"
    else
      rm -f "$tmp"
    fi
  else
    if jq -n --arg path "$rel" --argjson ts "$now" \
         '{id: "main", subagent_type: "main", description: "Claude (main)", startedAt: $ts, lastActiveAt: $ts, currentPath: $path}' \
         > "$tmp" 2>/dev/null; then
      mv "$tmp" "$target"
    else
      rm -f "$tmp"
    fi
  fi
  exit 0
fi

atype=$(printf '%s' "$input" | jq -r '.agent_type // empty')

# 1) If we've already bound this agent_id to a lifecycle file, reuse it.
target=""
for f in .constellation/agents/*.json; do
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
  for f in .constellation/agents/*.json; do
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

# Atomic update: write to temp, then mv.
tmp="${target}.tmp.$$"
if jq --arg aid "$aid" --arg path "$rel" --argjson ts "$now" \
     '. + {agentId: $aid, currentPath: $path, lastActiveAt: $ts}' \
     < "$target" > "$tmp" 2>/dev/null; then
  mv "$tmp" "$target"
else
  rm -f "$tmp"
fi

exit 0
