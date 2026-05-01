---
name: constellation:feedback
description: File a labeled GitHub issue against the Constellation public repo describing something that's broken or confusing in the visualizer. Privacy-redacted — only the target repo's basename, daemon health, OS, and Node version go in the body. Shows the rendered draft and your GitHub identity before submitting; nothing is sent without your single explicit confirmation.
---

# constellation:feedback

File one issue against `ian-klopper/Constellation` describing what the user said is broken or confusing. One issue per invocation — if the user describes two unrelated problems, ask them to invoke twice. Privacy is a positive allowlist: only the fields enumerated below ever go in the issue. No transcript content, no file contents, no environment variables, no `$HOME`, no absolute paths. Repo identity is `basename "$PWD"`, never the full path. Never run `gh auth login` for the user.

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

On confirmation:

    gh issue create \
      --repo ian-klopper/Constellation \
      --label via:dogfood \
      --title "<title>" \
      --body-file <(echo "<body>")

Then verify the label landed:

    gh issue view <number> --repo ian-klopper/Constellation --json labels --jq '.labels[].name'

If `via:dogfood` is missing from the returned labels, print that the issue was filed at `<url>` but the label was dropped (the user isn't a collaborator, so custom labels were ignored — triage may take longer; the issue itself is fine). Otherwise print `Filed: <url>`.

## `gh` failures

In every failure case, print the rendered draft so the user has it to paste manually — they never lose what they wrote. Specifically: if `gh` isn't on PATH, hint them to install it (`https://cli.github.com/`); if `gh auth status` fails, hint them to run `gh auth login` and re-invoke; if `gh issue create` fails for any other reason (network, repo missing, rate limit), print the error verbatim and the draft. Exit non-zero in every failure case.
