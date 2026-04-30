#!/bin/bash
# Tails a background subagent's JSONL transcript and mirrors its Read/Edit/Write
# tool calls into its lifecycle file's currentPath/lastActiveAt. BG subagents
# run in a separate execution context whose own tool calls don't fire parent
# hooks, so the transcript file is the only available source of truth for what
# they're touching. Spawned (detached) by agent-stop.sh after a BG launch and
# polls at 1Hz to match the visualizer's polling cadence.
#
# Self-terminates when the lifecycle file is removed by agent-substop.sh.

set -u

target="${1:?missing target}"
transcript="${2:?missing transcript}"
cwd="${3:-}"

[ ! -f "$target" ] && exit 0

for _ in $(seq 1 20); do
  [ -e "$transcript" ] && break
  sleep 0.5
done

last_count=0

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

  fpath=$(tail -n $((total - last_count)) "$transcript" 2>/dev/null | jq -r '
    .message?.content? // [] | .[]?
    | select(.type == "tool_use")
    | select(.name == "Read" or .name == "Edit" or .name == "Write" or .name == "MultiEdit")
    | .input.file_path // empty
  ' 2>/dev/null | tail -n 1)

  last_count=$total

  [ -z "$fpath" ] && { sleep 1; continue; }

  rel="$fpath"
  if [ -n "$cwd" ] && [ "${fpath#$cwd/}" != "$fpath" ]; then
    rel="${fpath#$cwd/}"
  fi

  now=$(date +%s)
  tmp="${target}.tmp.$$"
  if [ ! -f "$target" ]; then
    break
  fi
  if jq --arg path "$rel" --argjson ts "$now" \
       '. + {currentPath: $path, lastActiveAt: $ts}' \
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
