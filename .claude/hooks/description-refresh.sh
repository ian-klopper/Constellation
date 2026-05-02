#!/bin/bash
# Fires on PostToolUse for Edit|Write|MultiEdit. Looks up the file's
# current plain-English description in .constellation/descriptions.json
# and injects an additionalContext nudge so the active agent updates
# the sidecar entry in this same turn if the change altered what the
# file does. No daemon involvement — purely client-side. Fails silent.

PAYLOAD=$(cat)
[ -z "$PAYLOAD" ] && exit 0

FILE_PATH=$(printf '%s' "$PAYLOAD" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
[ -z "$FILE_PATH" ] && exit 0

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-}"
if [ -z "$PROJECT_DIR" ]; then
  PROJECT_DIR=$(printf '%s' "$PAYLOAD" | jq -r '.cwd // empty' 2>/dev/null)
fi
[ -z "$PROJECT_DIR" ] && exit 0

# Resolve to repo-relative. If the path is absolute and inside the project,
# strip the prefix; if absolute and outside, skip; if already relative, use
# as-is.
case "$FILE_PATH" in
  "$PROJECT_DIR"/*) REL="${FILE_PATH#$PROJECT_DIR/}" ;;
  /*) exit 0 ;;
  *) REL="$FILE_PATH" ;;
esac

# Skip generated/ignored paths so the agent isn't nudged about node_modules
# or .git or build output. Mirrors lib/scan/discover.ts:IGNORE.
case "$REL" in
  node_modules/*|*/node_modules/*) exit 0 ;;
  .git/*|*/.git/*) exit 0 ;;
  .next/*|*/.next/*) exit 0 ;;
  dist/*|*/dist/*) exit 0 ;;
  out/*|*/out/*) exit 0 ;;
  build/*|*/build/*) exit 0 ;;
  .constellation/*|*/.constellation/*) exit 0 ;;
esac

SIDECAR="$PROJECT_DIR/.constellation/descriptions.json"
CURRENT=""
if [ -f "$SIDECAR" ]; then
  CURRENT=$(jq -r --arg k "$REL" '.[$k] // ""' "$SIDECAR" 2>/dev/null)
fi

if [ -z "$CURRENT" ]; then
  STATUS="There is no plain-English description for it yet. If you have a feel for what this file is for, add an entry to .constellation/descriptions.json."
else
  STATUS="Its current plain-English description is: \"$CURRENT\". If your edit changed what this file is for, update that entry. Otherwise leave it alone."
fi

# Build the additionalContext JSON safely with jq so quoting in $CURRENT
# can't break the output.
jq -nc \
  --arg path "$REL" \
  --arg status "$STATUS" \
  '{
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: ("Constellation: you just changed `\($path)`. \($status) Tone: as short as it can be while still being clear (one sentence is usually enough; two or three short sentences is fine for files that do several distinct things). No code words like \"function\"/\"component\"/\"config\". Explain to a non-coder. Do NOT start a side quest — only update the description if your edit actually changed what the file is for.")
    }
  }' 2>/dev/null || exit 0
