# Core Philosophy

LoopTroop is opinionated about how AI coding systems should behave. The app trades speed and conversational convenience for controllability, recovery, and durable correctness.

## The Five Core Commitments

| Commitment | What it means in practice |
| --- | --- |
| Control context, do not accumulate it blindly | Every phase assembles only the artifacts it is allowed to see |
| Compete before you converge | Interview, PRD, and bead planning use multi-model draft, vote, and refine |
| Keep humans at the irreversible boundaries | Interview, PRD, beads, and execution setup all have approval gates |
| Retry with fresh state, not with stale chat memory | Bead execution uses bounded Ralph-style retry with context wipe notes |
| Persist important state outside the model | Databases, YAML, JSONL, and worktree artifacts outlive any single session |

## Context Degradation Is A Design Constraint

> [!NOTE]
> **What is Context Degradation?** Think of it like giving someone a 10,000-page book and asking them to remember a tiny detail from page 3 while they're on page 9,998. AI models suffer from "amnesia" in long chat threads—important details get buried, and the AI starts to hallucinate or drift from the original goal. 

Long-context models are useful, but they are still vulnerable to positional bias and long-run context drift. LoopTroop treats that as a systems problem, not as a prompt wording problem.

That leads to three hard rules:

1. Phase prompts are built from durable artifacts, not from inherited chat history.
2. A phase only sees the context keys it is explicitly allowed to see.
3. When a retry is needed, LoopTroop prefers a fresh session plus a compact post-mortem over continuing a polluted transcript.

See [Context Isolation](context-isolation.md).

## Council Instead Of Single-Draft Planning

> [!TIP]
> **Why an LLM Council?** If you ask a single AI to write a plan, it gives you its first guess, carrying all its blind spots. By using a "Council" (multiple AI models), LoopTroop forces them to brainstorm independently, vote on the best ideas, and merge them into a superior master plan. It's the difference between a solo developer and a senior engineering committee.

LoopTroop uses a council because early planning quality dominates downstream execution quality.

The council pattern is:

1. Independent drafts from multiple models.
2. Structured voting over anonymized drafts.
3. Refinement by the selected winner.
4. Coverage verification before moving forward.

This is not a free-form model group chat. It is a constrained orchestration pattern designed to surface better alternatives before the system commits to one.

See [LLM Council](llm-council.md).

## Bounded Ralph-Style Retry

> [!IMPORTANT]
> **What is a Ralph Loop?** When an AI fails at coding, continuing the same chat thread often leads to a "death spiral" of apologies and worse code. The Ralph Loop approach stops the thread, takes a note of what went wrong ("Wipe Note"), resets the code, and starts a **brand new chat** with the lessons learned.

Execution work fails in two broad ways:

- the model produces the wrong code
- the model gets stuck in a bad loop while carrying broken context forward

LoopTroop addresses the second case with a bounded Ralph-style retry discipline:

1. Capture what failed in a context wipe note.
2. Reset the worktree back to the bead start snapshot.
3. Start a fresh session with the bead spec plus the wipe note.
4. Stop after the configured retry limit.

This keeps the learning signal while discarding the poisoned conversational state.

See [Execution Loop](execution-loop.md).

## Beads Are The Unit Of Execution Memory

LoopTroop does not hand a whole feature to one coding session and hope for the best. It decomposes the approved PRD into beads:

- small enough to execute in focused context
- rich enough to encode acceptance criteria, tests, files, and dependencies
- durable enough to survive retries, restarts, and review

Beads are both the execution plan and the execution memory layer. They define what gets worked on next, what blocks what, and what context is needed for each coding attempt.

See [Beads](beads.md).

## Human Review Is Not An Afterthought

LoopTroop inserts explicit approval gates before the most expensive and hardest-to-reverse transitions:

- approve the interview before PRD generation
- approve the PRD before bead planning
- approve the beads before execution
- approve the execution setup plan before environment mutation and coding

This keeps the system honest. The model is allowed to move quickly inside a phase, but the human decides when the pipeline is good enough to cross into the next expensive stage.

## Durable State Beats Conversational Memory

LoopTroop stores meaningful workflow state in places that can be inspected, queried, and rebuilt:

- SQLite for ticket status, artifacts, attempts, sessions, and errors
- YAML and JSONL artifacts in `.ticket/**`
- execution logs in `.ticket/runtime/execution-log.jsonl`
- worktree state tied to git snapshots and PR outcomes

If the process restarts, the system should recover from storage, not from a model trying to remember what happened.

## What LoopTroop Optimizes For

LoopTroop is optimized for:

- mid-size and large feature work
- overnight or multi-hour runs
- traceable planning artifacts
- recoverable execution
- explicit delivery outcomes

It is not optimized for:

- one-shot trivial edits
- chat-first exploratory coding
- unbounded autonomous runs with no checkpoints

## Related Docs

- [System Architecture](system-architecture.md)
- [Context Isolation](context-isolation.md)
- [LLM Council](llm-council.md)
- [Execution Loop](execution-loop.md)
- [Beads](beads.md)
