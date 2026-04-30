#!/bin/bash
# Shared activity-string formatter for the visualizer hooks.
# Called by agent-touch.sh, agent-watch.sh, and agent-main-watch.sh so all three
# produce identical bubble text. Output is a single line, <= 60 chars.
#
# Usage: format_activity <tool_name> <tool_input_json>
# Echoes the formatted string to stdout. Never errors — prints the tool name
# verbatim if a field is missing.

format_activity() {
  local name="$1"
  local input="$2"
  local out=""
  local val=""

  case "$name" in
    Read)
      val=$(printf '%s' "$input" | jq -r '.file_path // empty' 2>/dev/null)
      [ -n "$val" ] && out="Reading $(basename "$val")" || out="Reading"
      ;;
    Edit|MultiEdit)
      val=$(printf '%s' "$input" | jq -r '.file_path // empty' 2>/dev/null)
      [ -n "$val" ] && out="Editing $(basename "$val")" || out="Editing"
      ;;
    Write)
      val=$(printf '%s' "$input" | jq -r '.file_path // empty' 2>/dev/null)
      [ -n "$val" ] && out="Writing $(basename "$val")" || out="Writing"
      ;;
    Bash)
      val=$(printf '%s' "$input" | jq -r '.command // empty' 2>/dev/null)
      val=$(printf '%s' "$val" | tr '\n' ' ' | head -c 40)
      [ -n "$val" ] && out="Running \`$val\`" || out="Running"
      ;;
    Grep)
      val=$(printf '%s' "$input" | jq -r '.pattern // empty' 2>/dev/null)
      [ -n "$val" ] && out="Searching for \"$val\"" || out="Searching"
      ;;
    Glob)
      val=$(printf '%s' "$input" | jq -r '.pattern // empty' 2>/dev/null)
      [ -n "$val" ] && out="Listing $val" || out="Listing"
      ;;
    Task|Agent)
      local stype desc
      stype=$(printf '%s' "$input" | jq -r '.subagent_type // empty' 2>/dev/null)
      desc=$(printf '%s' "$input" | jq -r '.description // empty' 2>/dev/null)
      if [ -n "$stype" ] && [ -n "$desc" ]; then
        out="Spawning $stype: $desc"
      elif [ -n "$stype" ]; then
        out="Spawning $stype"
      else
        out="Spawning agent"
      fi
      ;;
    WebFetch)
      val=$(printf '%s' "$input" | jq -r '.url // empty' 2>/dev/null)
      val=$(printf '%s' "$val" | sed -E 's|https?://||; s|/.*||')
      [ -n "$val" ] && out="Fetching $val" || out="Fetching the web"
      ;;
    WebSearch)
      out="Searching the web"
      ;;
    "")
      out=""
      ;;
    *)
      out="$name"
      ;;
  esac

  printf '%s' "${out:0:60}"
}
