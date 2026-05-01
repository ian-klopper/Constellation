---
date: 2026-04-30
topic: elegance-reviewer
focus: new elegance-focused review agent for compound-engineering plugin
mode: elsewhere-software
---

# Ideation: Elegance Reviewer for compound-engineering

## Grounding Context

**Topic context.** The compound-engineering plugin (`~/.claude/plugins/cache/compound-engineering-plugin/.../2.68.1/`) ships 28 review-persona agents that participate in `/ce:review`. Each persona is a markdown file with YAML frontmatter (`name`, `description`, `tools`, `model`, `color`), then standard sections: "What you're hunting for", "Confidence calibration" (0.60+ threshold for flags, P0 exception at 0.50+), "What you don't flag" (boundaries), "Output format" (JSON only). Output schema: `{reviewer, findings[], residual_risks, testing_gaps}` with severity P0–P3, confidence 0–1, autofix_class, owner.

Always-on personas: `correctness-reviewer`, `testing-reviewer`, `maintainability-reviewer`, `project-standards-reviewer`, `agent-native-reviewer`, `learnings-researcher`. Conditional personas dispatch via diff inspection (e.g., `security-reviewer` when auth touched, `adversarial-reviewer` when diff ≥50 executable lines).

**Critical differentiation constraint.** Two existing personas already overlap heavily with naïve "elegance":

- `maintainability-reviewer` flags: premature abstraction, unnecessary indirection (>2 delegation levels), dead code, coupling without domain reason, naming that obscures intent (`data`, `handler`, `process`).
- `code-simplicity-reviewer` flags: redundant error checks, defensive programming adding no value, commented-out code, over-engineering, premature generalization, complex conditionals that should use early returns.

A new elegance agent that re-treads either surface adds only noise and reviewer fatigue. The novel surfaces left open: **readability aesthetics, design consistency, intent clarity, idiomatic fit, narrative shape, and corpus-grounded local idiom** — all things a senior reader notices that no current rule-based reviewer can articulate.

**Theory grounding.** Drawn from the user's literature review: Dijkstra (simplicity as functional requirement), Hoare (correctness visible vs. argued; "small program struggling inside"), Brooks (essential vs. accidental complexity), Hickey (complecting vs. simple), Ousterhout (deep modules, "different is bad"), Beck (reveals intention, fewest elements), Naur (program as theory), Hindle (naturalness/idiomaticity from corpus), Alexander (pattern languages, quality without a name), CUPID (Composable, Unix, Predictable, Idiomatic, Domain-based).

**Plugin precedent for opinionated agents.** `dhh-rails-reviewer` and the `kieran-*` series show the plugin already accepts named, opinionated personas with concrete aesthetics — important because it frees the design from having to ship one universal-elegance verdict.

## Ranked Ideas

### 1. Repository-tuned exemplar corpus

**Description.** A new persona, `elegance-reviewer`, that does NOT carry a fixed style rulebook. On first run per repo, it auto-mines 10–30 "exemplar" files using churn + age heuristics (oldest, lowest-churn, no recent bug-fix commits — proxy for "this is how we write here") and persists a per-language idiomaticity corpus to `.claude/elegance/corpus-<lang>.json`. Every subsequent review scores changed files against the corpus. Findings are framed as deviations from local idiom: *"this file uses callbacks where the rest of `daemon/` uses async/await reducers"* or *"naming cadence here doesn't match the surrounding 12 files in `lib/scan/`."* Cross-references `docs/solutions/` before emitting any finding — a documented exception downgrades the flag to P3 with a citation. Cheapest-available model is sufficient (corpus comparison is a distributional task, not a hard-reasoning one), so the whole repo can be rescored on every run without runaway cost.

**Rationale.** This is the single most-additive move because it solves the universal failure mode of every existing style reviewer: bikeshedding generic preferences. The persona's authority is empirical (the repo's own best work), not opinionated (a named human's taste). It compounds — the corpus gets richer every run, and `learnings-researcher` can surface it during planning. It is also resistant to AI slop because its findings are *always* anchored to a citable file:line in the repo.

**Downsides.** Cold-start problem: a brand-new repo has no corpus. Auto-mining heuristics can pick the wrong files (e.g., legacy code that nobody actually likes but happens to be old and stable) — a manual nomination workflow may be needed. Persisted corpus is a new artifact the user has to maintain (or ignore). Risk of ossifying past patterns the team would rather move on from.

**Confidence:** 85%
**Complexity:** Medium
**Status:** Unexplored

---

### 2. Named-aesthetic personas (Beck / Metz / Hickey trio)

**Description.** Instead of one neutral `elegance-reviewer`, ship 2–3 named personas that each carry a concrete, opinionated rubric: `kent-beck-elegance` (four rules of simple design, tidyings, "fewest elements"), `sandi-metz-elegance` (small objects, message-passing, "duplication is far cheaper than the wrong abstraction"), `hickey-elegance` (decomplecting, "develop entanglement radar"). Each persona's primary output is **positive examples** — files or hunks the named aesthetic would celebrate, with a one-line teaching note appended to `docs/solutions/elegance-exemplars/<persona>/<file>.md`. Negative findings are capped at P3 advisory. Disagreements between the three personas are themselves the most interesting signal — they surface places where the codebase's own aesthetic hasn't been chosen yet.

**Rationale.** Plugin precedent is strong (`dhh-rails-reviewer`, `kieran-*` series). Named aesthetics force concreteness — vague "this isn't elegant" becomes "Metz would extract this; Beck would inline it; Hickey would decomplect parsing from IO" — which is genuinely useful even if you disagree. Positive-anchoring inverts the saturation problem of negative reviewers. Building a per-aesthetic exemplar corpus over time means `review-fixer` and other agents get concrete reference points.

**Downsides.** Three new personas = three new dispatches per `/ce:review` run. Risk of "aesthetic theater" where the team performs all three without internalizing any. Picking which named figures to embody is itself a design decision with bikeshed potential. Per-aesthetic exemplar corpus may grow large and stale.

**Confidence:** 75%
**Complexity:** Medium-High (3 personas + exemplar pipeline)
**Status:** Explored (2026-04-30 — handed off to /ce:brainstorm)

---

### 3. Sibling-symmetry & rhythm-break detector

**Description.** A persona whose sole rubric is detecting **uneven sibling expressions of the same concept within a scope**: three useEffect hooks in one component where two extract a helper and one inlines; a switch where two cases return and the third assigns-then-breaks; three error branches where two `throw new Error` and one `return { ok: false }`; a config object with two camelCase fields and one snake_case; sibling functions where two use early-return and the third uses nested-if. The agent counts both *construct kinds per behavior* (origami fewest-folds rule) and *parallel-structure violations* across siblings, then flags the rhythm break — never the individual choice.

**Rationale.** This is genuinely a new surface no current reviewer covers. `maintainability-reviewer` evaluates each construct in isolation; nothing in the plugin compares siblings to each other for stylistic consistency. Yet symmetry violations are one of the strongest signals to a senior reader that the code grew without a steward. It's also mechanically detectable: the heuristic ("AST nodes at the same nesting level with the same conceptual role should match in shape") is concrete and falsifiable.

**Downsides.** Risk of false positives when a sibling difference is intentional (e.g., one branch handles a genuinely special case). Needs careful "What you don't flag" boundary — should not police trivial style differences a formatter handles. Could become annoying if it fires on every PR.

**Confidence:** 80%
**Complexity:** Medium
**Status:** Unexplored

---

### 4. Complecting / entanglement radar (Hickey single-rubric)

**Description.** A persona with one job, framed in Hickey's vocabulary: detect concerns *braided through the same construct*. Examples: a function mixing parsing + IO + business logic; a class mixing config + state; a module mixing transport + domain; a parameter that changes call-site semantics (Boolean flag that flips the function's meaning rather than tuning its behavior). Output is `complecting_findings[]` — pairs of concerns and the specific construct entangling them. Maintains an **entanglement radar** at `.claude/elegance/radar.json` — a persistent map of the repo's coupling hotspots that gets refined every run and that other reviewers can read to avoid re-discovering the same tangles.

**Rationale.** Cleanly differentiated from `maintainability-reviewer` (which targets *premature* abstraction — too many layers) because complecting is often the *opposite* failure: too few layers, multiple concerns crammed into one. Hickey's "Simple Made Easy" gives the rubric a sharp definition that's mechanically detectable. The persistent radar is the compounding asset — a leading indicator of "we should refactor before adding this feature." Pairs naturally with the entanglement-radar lens that informed Constellation's whole purpose (visualizing the codebase to make complecting visible).

**Downsides.** Detecting "concerns" automatically is hard — risk of false positives (sometimes parsing + IO together IS the right factoring, e.g., streaming parsers). The persisted radar is yet another artifact. Less immediately readable to amateur developers than the named-aesthetic approach.

**Confidence:** 75%
**Complexity:** Medium-High (radar artifact + persistence)
**Status:** Unexplored

---

### 5. Essay + alternative-rewrite output (Erdős Book Proof, literate)

**Description.** Re-shape what the persona *outputs*, regardless of which lens it uses. For each touched file: a 200-word free-prose essay describing the diff's aesthetic character (read top-to-bottom, like a literate-programming note), plus a paired score in gymnastics format (`{ technical: <delegated to other reviewers>, artistic: <this agent's score>, deductions: [...] }`), plus — and this is the load-bearing piece — a **side-by-side rewrite** of the single most-leveraged hunk: "your code | my proposed alternative." The agent must produce the alternative; if it can't, no finding fires (Erdős's "Book proof" rule applied to code review). The JSON wrapper still exists for orchestrator compatibility, but each finding's payload is a unified diff, not a sentence.

**Rationale.** Elegance is famously easier to recognize than to articulate; concrete alternatives are what make elegance criticism actionable. Forcing "show, don't tell" prevents the agent from defaulting to vague "this could be simpler" findings (the failure mode of every existing AI review system). The literate essay gives the user something readable in 30 seconds even if they ignore every finding. The artistic-vs-technical pairing legibly distinguishes elegance from correctness so it doesn't compete for the same attention.

**Downsides.** Costs more per run (must generate alternatives, not just flags). The 200-word essay is exactly the kind of thing AI is good at producing slop in — needs strong constraints. Some hunks have no obviously-better alternative, and the agent will be tempted to invent one.

**Confidence:** 80%
**Complexity:** Medium
**Status:** Unexplored

---

### 6. Run elegance lens at `/ce:plan` and `/ce:brainstorm`, not just `/ce:review`

**Description.** Rather than (or in addition to) shipping an elegance persona inside `/ce:review`, hook the elegance lens into the upstream stages. At plan time: rate the *plan's* elegance — does it propose the smallest coherent change? Does the file layout match the codebase's grain? Are concerns separated cleanly across the proposed steps? At brainstorm time: rate the *requirements'* elegance — is anything complected? Does the proposed feature carve along natural joints in the domain? Findings flow back into the plan/brainstorm document as inline comments, before any code is written.

**Rationale.** Catching inelegance in a plan is worth ~50 inelegance findings on the resulting code. The cheapest moment to apply any quality lens is when the artifact is still words. The compound-engineering plugin's whole shape (brainstorm → plan → build → review) implies the same quality lenses *should* run at every stage; this just makes that explicit for elegance. Hickey's argument applies recursively: complecting in requirements becomes complecting in architecture becomes complecting in code. Intercept early.

**Downsides.** Adds a new persona to two more skills, multiplying the integration surface. Plan/brainstorm artifacts are looser than code, so the agent's signal-to-noise is harder to calibrate. Risk of slowing down the brainstorm/plan loops the user already finds productive.

**Confidence:** 70%
**Complexity:** High (touches multiple skills, not just review)
**Status:** Unexplored

---

### Design philosophy notes (apply to whichever variant ships)

These design defaults emerged repeatedly across frames and apply to *any* of the survivors above. Treat them as the persona's bones, not as separate ideas:

- **Capped at P3, never blocks merge.** Elegance findings are aesthetic notes, not gates. Rendered in a separate "aesthetic notes" section of the review output so they don't compete with correctness/security for attention. Paradoxically makes humans take them more seriously.
- **High-confidence-only with downweighting on agreement.** Flip the standard agreement-boost convention: when other reviewers flag the same area, the elegance finding gets *down*-weighted (because it's not adding new information). Forces the agent into the gaps where other reviewers don't go.
- **Refusal as a first-class output.** Add `"declined"` as a valid response when the diff is in a domain (DSLs, perf-critical code, generated code, novel architecture) where elegance heuristics would be actively misleading. Includes a one-sentence reason.
- **One finding per repo per run cap (optional).** Forces architectural altitude — agent must scan everything in the diff, hold all candidates in working memory, and emit only the single most-leveraged inelegance. Makes every finding unignorable by construction.

## Rejection Summary

| # | Idea | Reason |
|---|------|--------|
| 1 | Cognitive-load-per-line reviewer | Risks a third opinion on cognitive complexity; overlaps `code-simplicity-reviewer` at expression level |
| 3 | Narrative-flow / reads top-to-bottom | Too vague to operationalize without high false-positive rate |
| 6 | Visual-rhythm / scannability | Formatters (prettier/eslint) own this surface; not novel territory for an LLM agent |
| 7 | Conceptual-integrity / "one mind" reviewer | Too vague at agent altitude; high AI-slop risk |
| 8 | Intent-clarity / "why" reviewer | Overlaps `maintainability-reviewer` (intent-obscuring names) + `code-simplicity-reviewer` (defensive programming) |
| 9 | Run elegance FIRST in pipeline | Pipeline restructure is too disruptive for a first feature; revisit if the persona proves valuable |
| 34 | Hemingway mechanical linter | Duplicates existing cognitive-complexity metrics; would mostly add noise |
| 36 | Alexander "would I want to live here" | Vague metaphor; high AI-slop risk without concrete operationalization |
| 39 | Mise-en-place spatial layout | Same operationalization problem as #3; high false-positive risk |
| | (10 cut, 32 merged into the 6 survivors above) | |

Merge map (which raw ideas fed which survivor): see `/var/folders/.../compound-engineering/ce-ideate/elegance01/raw-candidates.md` for the full master list with cluster annotations A–H.
