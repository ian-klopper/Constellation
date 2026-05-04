# Live thought bubbles for agents and their subagents

## Problem
The visualizer already shows agent icons drifting between tiles, with trails and pulses, and a side rail of recent activity. But none of those tell you *what the agent is doing right now*. You can see "something is happening over there" without seeing the thought behind it. When several agents (or an agent plus its subagents) are working at once, it gets even harder to follow which one is doing what.

## Outcome
Each active agent has a small bubble anchored to its icon that shows a short, plain-English description of what it is currently doing. The text updates as the agent moves between steps. Subagents spawned by the main agent each get their own bubble alongside the parent's. When an agent finishes, its bubble fades out with the rest of its UI.

## Users
Anyone watching the Constellation visualizer while Claude Code (or any of its subagents) works on a registered repo — primarily Ian, dogfooding the tool on itself.

## Acceptance criteria
- [ ] When an agent becomes active, a bubble appears near its icon within ~1 second.
- [ ] Bubble text updates as the agent's current activity changes (new tool call, new step, finished step).
- [ ] Bubble text is plain English a non-engineer can skim — not raw JSON, not full tool arguments, not file paths longer than the bubble.
- [ ] Bubble fades out on the same timeline as the rest of the agent's UI when the agent goes idle or exits.
- [ ] Each subagent the main agent spawns gets its own bubble, visually distinct from the parent's, anchored to the subagent's own icon.
- [ ] When two or more agents land on or near the same tile, their bubbles remain individually readable (no fully overlapping text).
- [ ] If the daemon is down, no bubble appears, but the Claude Code session is unaffected — same silent-no-op contract as every other hook path.

## Out of scope
- Full transcript scrollback or "history of thoughts" per agent — the side rail already serves that role.
- User interaction with bubbles (click to pin, expand, copy) — read-only first pass.
- Persisting thoughts to disk after the agent finishes; bubbles are an in-the-moment UI only.
- Styling work beyond "readable, on-brand, doesn't break the existing layout."

## Constraints
- Must flow through the existing daemon → SSE → web client transport. No new long-lived connections, no parallel sidecar.
- Hook shims must stay 3–5 line `curl` calls with a 500 ms timeout and `|| true` — the daemon-down ⇒ silent no-op invariant is non-negotiable.
- Must not slow Claude Code tool calls perceptibly (the hook shim is on the critical path of every matched tool).
- Bubble state lives in the same single-writer reducer as the rest of agent lifecycle; no second source of truth for "what is this agent doing."

## Open questions
- **Where does the thought text actually come from?** Claude Code's hooks expose tool calls and their payloads, but not streaming model reasoning. Plausible sources: (a) derive a one-liner from `PreToolUse` payloads (e.g. "reading `lib/scan.ts`", "running `npm test`"), (b) tail the session transcript JSONL the CLI writes and extract the most recent assistant text, (c) wait for / request a first-class "thinking" hook. Which is acceptable for v1?
- **Subagent identity.** Subagents show up via the `Task` tool. Does the current hook payload give us a stable id for the spawned subagent, distinct from the parent session, that the daemon can key bubble state on? If not, scope of the subagent half of this spec needs to shrink.
- **Collision behavior.** When N agents share a tile, should bubbles fan out around the tile, stack vertically with leader lines, or collapse into one bubble that cycles through each agent? Default assumption: fan out, but flag for review.
