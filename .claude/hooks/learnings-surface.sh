#!/bin/bash
# Fires on PreToolUse for Edit|Write|MultiEdit. Looks up the file's
# entries in .constellation/learnings.json (exact path, immediate
# parent dir, plus the most recent _general entries) and injects an
# additionalContext nudge so the active agent sees prior insights
# before making its edit. Mirror of description-refresh.sh, inverted
# direction — recall instead of capture. Fails silent.

PAYLOAD=$(cat)
[ -z "$PAYLOAD" ] && exit 0

FILE_PATH=$(printf '%s' "$PAYLOAD" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
[ -z "$FILE_PATH" ] && exit 0

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-}"
if [ -z "$PROJECT_DIR" ]; then
  PROJECT_DIR=$(printf '%s' "$PAYLOAD" | jq -r '.cwd // empty' 2>/dev/null)
fi
[ -z "$PROJECT_DIR" ] && exit 0

# Resolve to repo-relative — same logic as description-refresh.sh.
case "$FILE_PATH" in
  "$PROJECT_DIR"/*) REL="${FILE_PATH#$PROJECT_DIR/}" ;;
  /*) exit 0 ;;
  *) REL="$FILE_PATH" ;;
esac

# Skip generated/ignored paths so we never nudge inside node_modules etc.
case "$REL" in
  node_modules/*|*/node_modules/*) exit 0 ;;
  .git/*|*/.git/*) exit 0 ;;
  .next/*|*/.next/*) exit 0 ;;
  dist/*|*/dist/*) exit 0 ;;
  out/*|*/out/*) exit 0 ;;
  build/*|*/build/*) exit 0 ;;
  .constellation/*|*/.constellation/*) exit 0 ;;
esac

SIDECAR="$PROJECT_DIR/.constellation/learnings.json"
[ -f "$SIDECAR" ] || exit 0

# Compute the immediate parent dir (or empty if file is at root).
PARENT=$(dirname "$REL")
[ "$PARENT" = "." ] && PARENT=""

# Pull last 3 entries from each of: exact path, immediate parent dir,
# _general. Caps total context at 9 entries so the nudge stays small.
ENTRIES=$(jq -r --arg p "$REL" --arg parent "$PARENT" '
  [
    ((.[$p] // [])[-3:]),
    (if $parent != "" then ((.[$parent] // [])[-3:]) else [] end),
    ((._general // [])[-3:])
  ]
  | flatten
  | map("- \(.date) (PR #\(.pr // "?")): \(.insight)")
  | .[]
' "$SIDECAR" 2>/dev/null)

[ -z "$ENTRIES" ] && exit 0

# Build the additionalContext JSON safely with jq so quoting in
# entries can't break the output.
jq -nc \
  --arg path "$REL" \
  --arg entries "$ENTRIES" \
  '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: ("Constellation: before you edit `\($path)`, here is what we have already learned about this area. Factor these in — do not re-discover what is already written down.\n\n\($entries)")
    }
  }' 2>/dev/null || exit 0
