# Council Pipeline

A detailed explanation of how the multi-model AI council works in LoopTroop.

---

## Table of Contents

- [Overview](#overview)
- [Why a Council?](#why-a-council)
- [Pipeline Steps](#pipeline-steps)
  - [1. Draft Phase](#1-draft-phase)
  - [2. Voting Phase](#2-voting-phase)
  - [3. Refinement Phase](#3-refinement-phase)
  - [4. Coverage Verification](#4-coverage-verification)
- [Phase-Specific Rubrics](#phase-specific-rubrics)
- [Anti-Anchoring Measures](#anti-anchoring-measures)
- [Quorum Requirements](#quorum-requirements)
- [Context Isolation](#context-isolation)
- [Session Lifecycle](#session-lifecycle)
- [Prompt Catalog](#prompt-catalog)

---

## Overview

The council pipeline is used during the three planning phases of LoopTroop:
1. **Interview** — Generate interview questions
2. **PRD** — Generate the Product Requirements Document
3. **Beads** — Generate the implementation task breakdown

Each phase runs the same 4-step pipeline:

```
Draft → Vote → Refine → Coverage Verify
  ↑                         │
  └── (loop if gaps found) ─┘
```

## Why a Council?

Using multiple AI models instead of one provides:

1. **Diversity of thought** — Different models have different strengths and biases
2. **Quality verification** — Models cross-check each other's work
3. **Reduced hallucination** — The voting step catches individual model errors
4. **Anti-anchoring** — Randomized presentation order prevents bias toward the first draft seen

## Pipeline Steps

### 1. Draft Phase

Each council member generates a draft **in parallel**:

```
┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐
│ Model A │  │ Model B │  │ Model C │  │ Model D │
│  Draft  │  │  Draft  │  │  Draft  │  │  Draft  │
└────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘
     │            │            │            │
     └────────────┴────────────┴────────────┘
                       │
                  All Drafts
```

**Key properties:**
- Each model gets a **fresh OpenCode session** (no shared history)
- Each model receives only the **phase-specific context** per the prompt allowlist
- Models work independently — no cross-pollination during drafting
- The main implementer model is also a council member

**Context provided during drafting:**

| Phase | Draft Context |
|-------|--------------|
| Interview | Ticket description, codebase map |
| PRD | Interview results, codebase map |
| Beads | PRD, interview results, codebase map |

### 2. Voting Phase

Each council member scores **all drafts** (including their own):

```
All Drafts → Randomize Order → Present to Each Voter

Voter A sees: [Draft C, Draft A, Draft D, Draft B]  (random order)
Voter B sees: [Draft B, Draft D, Draft A, Draft C]  (different random order)
Voter C sees: [Draft A, Draft C, Draft B, Draft D]  (different random order)
```

**Scoring:** Each voter assigns a score using a **5-category rubric** with 20 points per category = 100 total.

**Tally:** Scores are summed across all voters. The draft with the highest total wins.

**Key properties:**
- Drafts are **anonymized** — voters don't know which model produced which draft
- Drafts are presented in a **randomized order per voter** (anti-anchoring)
- Each voter gets a fresh session (no memory of the draft phase)
- Context for voting: all draft contents + the rubric

### 3. Refinement Phase

The winning draft is refined:

```
Winning Draft + Losing Drafts → Refiner → Refined Artifact
```

**Key properties:**
- The refiner incorporates **strong ideas from losing drafts** into the winner
- The refiner receives **only the drafts** — NOT the vote scores or results
- This ensures refinement is based on content quality, not political scoring
- Fresh session for the refinement step

**Context for refinement:**

| Phase | Refine Context |
|-------|---------------|
| Interview Refine | Winning draft + losing drafts |
| PRD Refine | Winning draft + losing drafts |
| Beads Refine | Winning draft + losing drafts |

### 4. Coverage Verification

A QA pass checks the refined artifact against its source material:

```
Refined Artifact + Source Material → QA Verifier → CLEAN or GAPS_FOUND
```

**If COVERAGE_CLEAN:** Proceed to user approval.
**If GAPS_FOUND:** Loop back to refinement with the gap report.

**Coverage checks:**

| Phase | Verified Against |
|-------|-----------------|
| Interview Coverage | Ticket description (are all requirements addressed?) |
| PRD Coverage | Interview results (does PRD cover all interview answers?) |
| Beads Coverage | PRD (does every user story have implementing beads?) |

---

## Phase-Specific Rubrics

### Interview Rubric (PROM2)

| Category | Weight | Description |
|----------|--------|-------------|
| Completeness | 20 pts | Are all aspects of the requirements covered? |
| Depth | 20 pts | Do questions probe deeply enough? |
| Clarity | 20 pts | Are questions clear and unambiguous? |
| Priority ordering | 20 pts | Are the most important questions first? |
| Feasibility focus | 20 pts | Do questions address technical feasibility? |
| **Total** | **100 pts** | |

### PRD Rubric (PROM11)

| Category | Weight | Description |
|----------|--------|-------------|
| Completeness | 20 pts | Does the PRD cover all interview topics? |
| Technical depth | 20 pts | Are technical requirements detailed enough? |
| Actionability | 20 pts | Can developers build from this spec? |
| Consistency | 20 pts | Are there no contradictions? |
| Risk coverage | 20 pts | Are risks and edge cases identified? |
| **Total** | **100 pts** | |

### Beads Rubric (PROM21)

| Category | Weight | Description |
|----------|--------|-------------|
| Granularity | 20 pts | Are beads small enough to implement independently? |
| Dependency correctness | 20 pts | Is the dependency graph correct? |
| Test coverage | 20 pts | Does every bead have meaningful tests? |
| Estimation accuracy | 20 pts | Are complexity estimates reasonable? |
| Context guidance quality | 20 pts | Are patterns/anti-patterns helpful? |
| **Total** | **100 pts** | |

---

## Anti-Anchoring Measures

Anchoring bias occurs when a voter is influenced by the first option they see. LoopTroop prevents this:

1. **Random draft order per voter** — Each voter sees drafts in a different random order
2. **Anonymized drafts** — Voters don't know which model produced which draft
3. **Fresh sessions** — Voters have no memory of the draft phase
4. **Structured rubric** — Forces evaluation across specific categories rather than overall impression

---

## Quorum Requirements

The council requires a minimum number of valid responses to proceed:

| Setting | Default | Range | Description |
|---------|---------|-------|-------------|
| `minCouncilQuorum` | 2 | 1-4 | Minimum valid responses needed |

**Response outcomes per member:**
- `completed` — Valid draft/vote received within timeout
- `timed_out` — No response before `councilResponseTimeout`
- `invalid_output` — Response received but malformed or fails validation

**If quorum is not met:** Ticket enters `BLOCKED_ERROR`. User can retry with different models or reduced quorum.

---

## Context Isolation

Every council call uses `buildMinimalContext(phase, ticketState, activeItem?)`:

- **Hard phase allowlists** — Only required sources are included per phase
- **No ad-hoc prompt assembly** — All prompts go through the context builder
- **Deterministic token budgeting** — Trims in fixed priority order when budget exceeded
- **Context slice caching** — Immutable artifacts (codebase map, approved interview) are cached

### Phase Allowlists (18 phases)

| Phase | Allowed Context Sources |
|-------|------------------------|
| `interview_draft` | ticket description, codebase map |
| `interview_vote` | all drafts, rubric |
| `interview_refine` | winning draft, losing drafts |
| `interview_qa` | compiled questions, previous answers |
| `interview_coverage` | interview results, ticket description |
| `prd_draft` | interview results, codebase map |
| `prd_vote` | all PRD drafts, rubric |
| `prd_refine` | winning PRD draft, losing drafts |
| `prd_coverage` | refined PRD, interview results |
| `beads_draft` | PRD, interview results, codebase map |
| `beads_vote` | all beads drafts, rubric |
| `beads_refine` | winning beads draft, losing drafts |
| `beads_expand` | refined beads, PRD details |
| `beads_coverage` | expanded beads, PRD |
| `bead_execution` | codebase map, PRD section, bead spec, notes |
| `context_wipe` | bead notes, error details |
| `final_test` | codebase map, all bead results |
| `preflight` | system diagnostics |

---

## Session Lifecycle

### Council Phases
- **Fresh session per member per phase attempt** (draft, vote, refine, coverage)
- Never reuse prior council-step history
- On retry: always start a new session

### Execution Phase
- **Fresh session per bead execution attempt** (`bead_id` + `iteration`)
- Never reuse sessions across beads
- Context wipe → new session with updated notes

### Reconnection Policy
- On restart: reattach only if session ownership matches active run/phase/attempt
- Mismatch or missing → create replacement fresh session
- Knowledge transfer: via structured artifacts, not chat history

---

## Prompt Catalog

LoopTroop uses a structured prompt catalog (PROM1-52) defined in `server/prompts/index.ts`:

| ID | Phase | Purpose |
|----|-------|---------|
| PROM1 | Interview | Generate interview questions |
| PROM2 | Interview | Vote on question sets (rubric) |
| PROM3 | Interview | Refine winning questions |
| PROM4 | Interview | Q&A coverage check |
| PROM5 | Interview | Compile final interview |
| PROM10 | PRD | Draft PRD from interview |
| PROM11 | PRD | Vote on PRD drafts (rubric) |
| PROM12 | PRD | Refine winning PRD |
| PROM13 | PRD | PRD coverage check |
| PROM20 | Beads | Draft beads from PRD |
| PROM21 | Beads | Vote on beads drafts (rubric) |
| PROM22 | Beads | Refine winning beads |
| PROM23 | Beads | Expand beads (detail) |
| PROM24 | Beads | Beads coverage check |
| PROM51 | Execution | Bead implementation prompt |
| PROM52 | Execution | Context wipe retry prompt |

Each prompt follows the **global rule**: "Your entire response must consist of NOTHING except the exact requested artifact. No explanations, no markdown fences, no extra text."
