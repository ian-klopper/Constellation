---
name: constellation:feedback
description: File a labeled GitHub issue against the Constellation public repo describing something that's broken or confusing in the visualizer. Privacy-redacted — only the target repo's basename, daemon health, OS, and Node version go in the body. Shows the rendered draft and your GitHub identity before submitting; nothing is sent without your single explicit confirmation.
---

# constellation:feedback

You file a single GitHub issue against `ian-klopper/Constellation` describing what the user said is broken or confusing about Constellation. Everything happens in one tool-use pass: gather redacted context, draft the issue, show it to the user, ask for confirmation, then either submit via `gh` or fall back to printing the draft for manual filing.

## Hard rules

1. **One issue per invocation.** Do not split a single complaint across multiple issues. If the user describes two unrelated problems, ask them to invoke the skill twice.
2. **Privacy is a positive allowlist.** Only the fields enumerated in *Context to gather* below ever go in the issue. If you find yourself wanting to include something not on that list, do not include it.
3. **No transcript content. No file contents. No environment variables. No `$HOME`. No absolute paths.** Repo identity is `basename "$PWD"`, never the full path.
4. **One confirmation gate.** The user sees the rendered draft, the GitHub-identity disclosure, then a `[y/N]` prompt. Anything other than literal `y` or `yes` is a no-op exit.
5. **Never `gh auth login` for the user.** If `gh` is unauthenticated, print the hint and the draft; let them log in and re-run.

## Context to gather

Run these commands. If a command fails or returns empty, record the field as `(unknown)` — never substitute a guess.

| Field | Command | Notes |
|---|---|---|
| `repo_basename` | `basename "$PWD"` | Just the directory name. Never the path. |
| `daemon_health` | `curl -s -m 1 http://127.0.0.1:47317/health` | Parse the JSON response. Keep ONLY the keys `ok`, `uptime`, `agentCount`, `port`. Drop every other key. If the call fails, record `(daemon down or unreachable)`. |
| `os` | `uname -s` | One word: `Darwin`, `Linux`, etc. |
| `node_version` | `node -v` | e.g. `v22.16.0`. |
| `user_description` | (the free-form text the user passed when invoking the skill) | Use as-is, but strip any absolute paths you can detect (`/Users/...`, `/home/...`, `C:\Users\...`) before including. If you redact, note `[path redacted]` in place. |

The Constellation install path is **not** auto-detected (the install/target architecture deliberately doesn't write a pointer file in the target). The issue body asks the user to follow up with the SHA in a comment if version info is needed for triage.

## Drafting

Title format:

    [via:dogfood] <one-line summary derived from user_description>

Keep the title under 70 characters; truncate the summary if needed. Strip leading whitespace and quotation marks the user might have included.

Body format (markdown):

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

## Show the draft + identity disclosure

Print, in this order:

1. The rendered title.
2. The rendered body, exactly as it would land on GitHub.
3. The GitHub identity disclosure line. Get the username with `gh api user --jq .login` (silent failure → use `(not authenticated)`):

       This issue will be filed under your GitHub identity (@<username>) and is publicly visible at https://github.com/ian-klopper/Constellation/issues.

4. The confirmation prompt:

       Submit this issue? [y/N]

If the user types anything other than `y` or `yes`, exit cleanly with the message `Cancelled — no issue filed.` Do not retry, do not partially submit.

## Submit

If the user confirms:

    gh issue create \
      --repo ian-klopper/Constellation \
      --label via:dogfood \
      --title "<title>" \
      --body-file <(echo "<body>")

After the call returns, read the resulting issue:

    gh issue view <number> --repo ian-klopper/Constellation --json labels --jq '.labels[].name'

If `via:dogfood` is **not** in the returned labels, print:

    Issue filed at <url>, but the via:dogfood label was dropped (your GitHub
    account isn't a collaborator on this repo, so custom labels were ignored).
    Triage may take longer. The issue itself is fine.

Otherwise print:

    Filed: <url>

## `gh` failure paths

| Failure | Action |
|---|---|
| `gh` is not on PATH | Print: `gh isn't installed. Install: https://cli.github.com/. Below is the rendered draft you can paste at https://github.com/ian-klopper/Constellation/issues/new manually.` Then print title + body. Exit non-zero. |
| `gh auth status` fails (not authenticated) | Print: `gh is not authenticated. Run \`gh auth login\` and re-invoke the skill. Below is the rendered draft.` Then print title + body. Exit non-zero. |
| `gh issue create` errors out for any other reason (network, repo missing, rate limit, etc.) | Print the gh error verbatim, then: `Submission failed. Below is the rendered draft you can paste at https://github.com/ian-klopper/Constellation/issues/new manually.` Then print title + body. Exit non-zero. |

In every failure case, the rendered draft is printed so the user has it to paste manually. They never lose what they wrote.

## Examples

User invocation:

    /constellation:feedback "tile descriptions are clipping mid-word at narrow widths"

Expected title:

    [via:dogfood] tile descriptions are clipping mid-word at narrow widths

Expected body (illustrative — your gathered values will differ):

    **Reported via** `/constellation:feedback`

    ## What's wrong

    tile descriptions are clipping mid-word at narrow widths

    ## Environment

    - Repo (basename only): `my-side-project`
    - Daemon health: `{"ok":true,"uptime":342,"agentCount":1,"port":47317}`
    - OS: `Darwin`
    - Node: `v22.16.0`
    - Constellation install: not auto-detected. If the bug appears
      version-related, run `git -C <your-clone-path> log -1 --format=%H`
      and paste the SHA in a follow-up comment.

    ---
    Filed via the `/constellation:feedback` skill. No transcript content,
    file contents, or absolute paths were included.
