#!/bin/bash
# Bind a subagent's agent_id to its lifecycle file and record currentPath.
# Called from PreToolUse on Read|Edit|Write|MultiEdit. Reads hook payload from stdin.
# No-op when the call isn't from a subagent or when no lifecycle file matches.

set -u

input=$(cat)
aid=$(printf '%s' "$input" | jq -r '.agent_id // empty')
[ -z "$aid" ] && exit 0

atype=$(printf '%s' "$input" | jq -r '.agent_type // empty')
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

# 1) If we've already bound this agent_id to a lifecycle file, reuse it.
target=""
for f in .constellation/agents/*.json; do
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
if jq --arg aid "$aid" --arg path "$rel" '. + {agentId: $aid, currentPath: $path}' < "$target" > "$tmp" 2>/dev/null; then
  mv "$tmp" "$target"
else
  rm -f "$tmp"
fi

exit 0
