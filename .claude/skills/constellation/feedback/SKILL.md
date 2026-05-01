---
name: constellation:feedback
description: File a labeled GitHub issue against the Constellation public repo describing something that's broken or confusing in the visualizer. Privacy-redacted — only the target repo's basename, daemon health, OS, and Node version go in the body. Shows the rendered draft and your GitHub identity before submitting; nothing is sent without your single explicit confirmation.
---

# constellation:feedback

File one issue against `ian-klopper/Constellation` describing what the user said is broken or confusing. One issue per invocation. Multiple findings from the same workflow or session can be combined into a single issue when they share root cause, surface area, or were discovered together — render them as a checklist in the body. Two unrelated problems still need two invocations: ask the user to re-invoke for the second. Privacy is a positive allowlist: only the fields enumerated below ever go in the issue. No transcript content, no file contents, no environment variables, no `$HOME`, no absolute paths. Repo identity is `basename "$PWD"`, never the full path. Never run `gh auth login` for the user.

## Context to gather

Run these commands. If a command fails or returns empty, record `(unknown)` — never substitute a guess.

| Field | Command | Notes |
|---|---|---|
| `repo_basename` | `basename "$PWD"` | Just the directory name. Never the path. |
| `daemon_health` | `curl -s -m 1 http://127.0.0.1:47317/health` | Parse the JSON response. Keep ONLY the keys `ok`, `uptime`, `agentCount`, `port`. Drop every other key. If the call fails, record `(daemon down or unreachable)`. |
| `os` | `uname -s` | One word: `Darwin`, `Linux`, etc. |
| `node_version` | `node -v` | e.g. `v22.16.0`. |
| `user_description` | (the free-form text passed when invoking the skill) | Use as-is, but strip any absolute paths you can detect (`/Users/...`, `/home/...`, `C:\Users\...`) before including. If you redact, note `[path redacted]` in place. |

The Constellation install path is **not** auto-detected. If version info is needed for triage, the issue body asks the user to follow up with the SHA in a comment.

## Drafting

Title: `[via:dogfood] <one-line summary derived from user_description>`. Keep under 70 chars; truncate the summary if needed; strip leading whitespace and quotation marks.

Body:

    **Reported via** `/constellation:feedback`

    ## What's wrong

    <user_description>

    ## Environment

    - Repo (basename only): `<repo_basename>`
    - Daemon health: `<daemon_health JSON, whitelisted keys only>`
    - OS: `<os>`
    - Node: `<node_version>`
    - Constellation install: not auto-detected. If the bug appears
      version-related, run `git -C <your-clone-path> log -1 --format=%H`
      and paste the SHA in a follow-up comment.

    ---
    Filed via the `/constellation:feedback` skill. No transcript content,
    file contents, or absolute paths were included.

## Show + confirm

Print, in this order: the rendered title, the rendered body exactly as it would land on GitHub, then the GitHub identity disclosure (use `gh api user --jq .login`; on silent failure use `(not authenticated)`):

    This issue will be filed under your GitHub identity (@<username>) and is publicly visible at https://github.com/ian-klopper/Constellation/issues.

    Submit this issue? [y/N]

Anything other than literal `y` or `yes` exits cleanly with `Cancelled — no issue filed.` Do not retry, do not partially submit.

## Submit

On confirmation, write the body to a tempfile and pass it to `gh` via `--body-file`. The quoted heredoc delimiter (`'BODY_EOF'`) is what keeps backticks, fenced code blocks, dollar signs, and embedded newlines intact — process substitution + `echo` mangles all of these. The `[via:dogfood]` prefix already in the title is the searchable signal; we deliberately don't pass `--label`, because non-collaborators can't make `gh` accept custom labels and the whole `gh issue create` call fails when the label doesn't exist.

    body_tmp="$(mktemp -t constellation-feedback)"
    trap 'rm -f "$body_tmp"' EXIT
    cat > "$body_tmp" <<'BODY_EOF'
    <body>
    BODY_EOF

    gh issue create \
      --repo ian-klopper/Constellation \
      --title "<title>" \
      --body-file "$body_tmp"

Print `Filed: <url>`.

## `gh` failures

In every failure case, print the rendered draft so the user has it to paste manually — they never lose what they wrote. Specifically: if `gh` isn't found, also try `/opt/homebrew/bin/gh` (Apple Silicon Homebrew) and `/usr/local/bin/gh` (Intel Homebrew) — `command -v gh` fails when Homebrew's bin dir isn't on the PATH inherited by the agent, which is common on macOS. If one of those exists, use the absolute path for the rest of this skill. Only when all three lookups fail do you hint the user to install from `https://cli.github.com/`. If `gh auth status` fails, hint them to run `gh auth login` and re-invoke; if `gh issue create` fails for any other reason (network, repo missing, rate limit), print the error verbatim and the draft. Exit non-zero in every failure case.
