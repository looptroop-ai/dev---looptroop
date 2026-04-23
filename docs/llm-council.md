# LLM Council

LoopTroop uses a council whenever it is choosing a plan, not just executing one. The council is a structured draft, vote, refine pipeline that is reused across interview generation, PRD creation, and bead planning.

## Where The Council Appears

| Domain | Draft phase | Vote phase | Refine phase | Coverage follow-up |
| --- | --- | --- | --- | --- |
| Interview | `COUNCIL_DELIBERATING` | `COUNCIL_VOTING_INTERVIEW` | `COMPILING_INTERVIEW` | `VERIFYING_INTERVIEW_COVERAGE` |
| PRD | `DRAFTING_PRD` | `COUNCIL_VOTING_PRD` | `REFINING_PRD` | `VERIFYING_PRD_COVERAGE` |
| Beads | `DRAFTING_BEADS` | `COUNCIL_VOTING_BEADS` | `REFINING_BEADS` and `VERIFYING_BEADS_COVERAGE` | `VERIFYING_BEADS_COVERAGE` plus expansion |

## Council Lifecycle

```mermaid
flowchart LR
    A[Shared context assembled] --> B[Independent drafts]
    B --> C[Anonymized voting]
    C --> D[Winner selected]
    D --> E[Refinement]
    E --> F[Coverage verification]
    F --> G[Approval gate or follow-up]
```

The important detail is independence. Models do not co-author one shared draft during the draft stage.

## Step 1: Independent Drafting

Each council member receives the same allowed context for the stage and produces its own artifact:

- interview question set
- PRD draft
- bead blueprint

This is where LoopTroop deliberately seeks diversity. A single draft tends to encode one model's blind spots. Multiple independent drafts surface alternative framing, edge cases, and decomposition strategies.

## Step 2: Structured Voting

Voting is not "pick the one you like." It is a structured evaluation pass over anonymized drafts.

LoopTroop reduces obvious bias by:

- removing authorship from the drafts
- randomizing presentation order
- recording per-model vote artifacts
- resolving the winner from structured scores and ranking output

The goal is not consensus chat. The goal is competitive evaluation under the same rubric.

## Step 3: Refinement

Once a winner is selected, the winning direction is refined into the canonical artifact for the phase.

That refined artifact is what later phases see:

- the interview document feeds the Q&A loop
- the PRD feeds beads planning
- the beads plan feeds execution

## Step 4: Coverage

The council does not end at "winner picked." LoopTroop then checks whether the artifact is complete enough to move on.

| Domain | Coverage action |
| --- | --- |
| Interview | Generate targeted follow-up questions when gaps remain |
| PRD | Revise the PRD until coverage is acceptable or the pass budget is exhausted |
| Beads | Revise the bead plan, then expand it into execution-ready beads |

This is why the council is better understood as a planning discipline than as a single phase.

## Inputs And Outputs By Stage

| Domain | Main council inputs | Main output |
| --- | --- | --- |
| Interview | Ticket details, relevant files | Canonical interview document and question session |
| PRD | Ticket details, relevant files, approved interview, full answers | Approved PRD |
| Beads | Ticket details, relevant files, approved PRD | Expanded bead plan |

Each domain inherits only the artifacts it needs. See [Context Isolation](context-isolation.md) for the exact allowlists.

## Quorum And Failure

The council is configured, not open-ended.

Important controls include:

- the chosen main implementer
- council member list
- per-project or profile quorum settings
- council response timeout

If too few valid drafts or votes arrive to satisfy quorum, the pipeline does not pretend the result is trustworthy. It fails into `BLOCKED_ERROR` or a phase-specific retry path instead of silently advancing.

## Why LoopTroop Uses Council Instead Of Debate Chat

LoopTroop's council is inspired by multi-model deliberation, but the implementation is intentionally more operational than theoretical.

It chooses:

- parallel independent drafting instead of one shared brainstorm
- structured voting instead of free-form persuasion
- one winning artifact instead of a merged conversation transcript
- durable artifacts instead of latent conversational memory

That makes the result easier to inspect, compare, cache, edit, and restart.

## Human Gates Still Matter

The council does not replace the human. It prepares artifacts for review.

LoopTroop inserts explicit approvals after:

- interview
- PRD
- beads
- execution setup plan

The council improves draft quality, but the human still authorizes the next irreversible stage.

## What Lives In Storage

Council work is persisted in both artifact and runtime form:

- draft artifacts
- vote artifacts
- winner and refinement artifacts
- coverage artifacts
- per-model logs and session records

That storage is what allows phase review, restart, and auditability in the UI.

## Related Docs

- [Context Isolation](context-isolation.md)
- [State Machine](state-machine.md)
- [Beads](beads.md)
- [System Architecture](system-architecture.md)
