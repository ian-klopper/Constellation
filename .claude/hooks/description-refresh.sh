#!/bin/bash
# Fires on PostToolUse for Edit|Write|MultiEdit. Emits a single
# additionalContext nudge with two prompts:
#   1. Description — if the edit changed what the file does, update
#      .constellation/descriptions.json so the visualizer's sidecar
#      stays accurate.
#   2. Learning — if the edit revealed something non-obvious worth
#      remembering (hidden constraint, foot-gun, reusable pattern,
#      wrong-then-right judgment call), append a tiny entry to
#      .constellation/learnings.json. Surfaced back to Claude on
#      future edits via .claude/hooks/learnings-surface.sh.
# Both prompts are advisory — Claude can act on neither, one, or both
# in the same turn. No daemon involvement; purely client-side. Fails
# silent.

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
  DESC_STATUS="There is no plain-English description for it yet. If you have a feel for what this file is for, add an entry to .constellation/descriptions.json."
else
  DESC_STATUS="Its current plain-English description is: \"$CURRENT\". If your edit changed what this file is for, update that entry. Otherwise leave it alone."
fi

# Build the additionalContext JSON safely with jq so quoting in
# $DESC_STATUS can't break the output. One payload, two prompts.
jq -nc \
  --arg path "$REL" \
  --arg desc_status "$DESC_STATUS" \
  '{
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: (
        "Constellation: you just changed `\($path)`.\n\n" +
        "1. Description. \($desc_status) Tone: as short as it can be while still being clear (one sentence is usually enough; two or three short sentences is fine for files that do several distinct things). No code words like \"function\"/\"component\"/\"config\". Explain to a non-coder. Do NOT start a side quest — only update the description if your edit actually changed what the file is for.\n\n" +
        "2. Learning. If this edit revealed something non-obvious worth remembering — a hidden constraint, a foot-gun, a reusable pattern, a wrong-then-right judgment call — append a tiny entry to .constellation/learnings.json under the key `\($path)` (or `_general` if it spans multiple files). Shape: {date, pr, insight}. Use today as the ISO date; pr can be null if no PR exists yet. One sentence per insight. Lead with the insight, not the symptom (good: \"Conditional return null must sit after every useMemo, or hook order changes between renders.\" bad: \"We had a hook ordering bug.\"). Skip entirely if the edit was mechanical (typo, rename, dependency bump) — sparse-and-sharp beats comprehensive-and-noisy."
      )
    }
  }' 2>/dev/null || exit 0
