# Context Isolation

LoopTroop treats context assembly as a systems boundary, not as an implementation detail. Every planning or execution phase gets a fresh prompt built from a strict allowlist of durable artifacts.

The source of truth for this behavior is `server/opencode/contextBuilder.ts`.

## Why This Exists

Long-running agent loops degrade for predictable reasons:

- important facts drift toward the middle of a long prompt
- retries accumulate stale reasoning and failed attempts
- later phases inherit details they were never meant to see
- compaction replaces exact artifacts with summaries that lose precision

LoopTroop responds by rebuilding context from storage for each phase instead of inheriting one giant transcript.

## The Contract

`buildMinimalContext()` accepts:

- a phase key such as `prd_vote` or `coding`
- a `TicketState` snapshot assembled from durable artifacts

It returns ordered `PromptPart[]` slices after:

1. applying the phase allowlist
2. loading cacheable slices where appropriate
3. sorting the result
4. trimming to the token budget if necessary

## TicketState Inputs

The current `TicketState` fields used by the context builder are:

```yaml
ticketState:
  ticketId: string
  title: string
  description: string
  relevantFiles: string
  interview: string
  fullAnswers: string[]
  prd: string
  beads: string
  beadsDraft: string
  drafts: string[]
  votes: string[]
  beadData: string
  beadNotes: string[]
  executionSetupProfile: string
  executionSetupPlan: string
  executionSetupPlanNotes: string[]
  executionSetupNotes: string[]
  finalTestNotes: string[]
  userAnswers: string
  tests: string
  errorContext: string
```

## Current Phase Allowlists

The following block mirrors the current phase mapping in `server/opencode/contextBuilder.ts`.

```yaml
interview_draft:
  - relevant_files
  - ticket_details
interview_vote:
  - relevant_files
  - ticket_details
  - drafts
interview_refine:
  - relevant_files
  - ticket_details
  - drafts
interview_qa:
  - relevant_files
  - ticket_details
  - interview
  - user_answers
interview_coverage:
  - ticket_details
  - user_answers
  - interview
prd_draft:
  - relevant_files
  - ticket_details
  - interview
  - full_answers
prd_vote:
  - relevant_files
  - ticket_details
  - interview
  - drafts
prd_refine:
  - relevant_files
  - ticket_details
  - full_answers
  - drafts
prd_coverage:
  - interview
  - full_answers
  - prd
beads_draft:
  - relevant_files
  - ticket_details
  - prd
beads_vote:
  - relevant_files
  - ticket_details
  - prd
  - drafts
beads_refine:
  - relevant_files
  - ticket_details
  - prd
  - drafts
beads_expand:
  - relevant_files
  - ticket_details
  - prd
  - beads_draft
beads_coverage:
  - prd
  - beads
execution_setup_plan:
  - ticket_details
  - relevant_files
  - prd
  - beads
  - execution_setup_profile
  - execution_setup_plan_notes
execution_setup_plan_regenerate:
  - ticket_details
  - relevant_files
  - prd
  - beads
  - execution_setup_profile
  - execution_setup_plan
  - execution_setup_plan_notes
execution_setup:
  - ticket_details
  - beads
  - execution_setup_plan
  - execution_setup_notes
coding:
  - bead_data
  - bead_notes
context_wipe:
  - bead_data
  - error_context
final_test:
  - ticket_details
  - interview
  - prd
  - beads
  - final_test_notes
preflight:
  - ticket_details
```

`prd_draft` is a two-part phase: Part 1 uses `interview` to produce member-specific `full_answers`, and Part 2 drafts each PRD from that member's completed answer set.

## What Each Context Slice Means

| Key | Meaning |
| --- | --- |
| `ticket_details` | Canonical ticket title and description |
| `relevant_files` | The relevant file scan artifact from `relevant-files.yaml` |
| `drafts` | Competing council outputs for the current stage |
| `votes` | Structured council vote artifacts |
| `interview` | The current interview document |
| `full_answers` | Member-specific interview answers with skipped items filled for PRD generation |
| `user_answers` | Interview answer summary collected so far |
| `prd` | The current PRD document |
| `beads` | The current expanded bead plan |
| `beads_draft` | Pre-expansion bead blueprint |
| `bead_data` | The active bead specification for execution |
| `bead_notes` | Prior execution notes used during retries |
| `execution_setup_profile` | Concrete runtime environment profile; setup-plan phases may receive it inline, while coding reads `.ticket/runtime/execution-setup-profile.json` only when needed |
| `execution_setup_plan` | Approved setup plan artifact |
| `execution_setup_plan_notes` | Regeneration notes for the plan stage |
| `execution_setup_notes` | Setup retry notes |
| `final_test_notes` | Retry notes for final test runs |
| `tests` | Test-specific material when present |
| `error_context` | Failure summary used by the context wipe prompt |

## Ordering Rules

Context parts are sorted before prompting:

- `ticket_details` always comes first
- other slices preserve assembly order
- each slice is emitted as a separate `PromptPart`

That keeps the primary requirement visible even when later slices are large.

## Token Budget And Trimming

The current default token budget is `100000`.

If assembled context exceeds that budget, LoopTroop trims low-priority slices first. The current trim order is:

1. `error_context`
2. `bead_notes`
3. `execution_setup_plan_notes`
4. `execution_setup_notes`
5. `final_test_notes`
6. `user_answers`
7. `tests`
8. `votes`
9. `drafts`
10. `full_answers`
11. `beads_draft`
12. `beads`
13. `interview`
14. `prd`
15. `relevant_files`
16. `execution_setup_plan`
17. `execution_setup_profile`
18. `ticket_details`

The key point is architectural, not cosmetic: the most disposable slices disappear first, while the core ticket requirement is protected as long as possible.

## Cache Behavior

The context builder keeps a lightweight per-ticket cache for reusable slices.

| Setting | Current value |
| --- | --- |
| Cache structure | `Map<string, { content: string; timestamp: number }>` |
| TTL | `300000` ms |
| Cached slices | reusable content like relevant files, interview, PRD |
| Invalidation | `clearContextCache(ticketId)` |

This cache is a performance helper, not a source of truth. Durable artifacts remain the authoritative input.

## Why `relevant-files.yaml` Matters

The relevant-file scan is the first major context artifact because it gives later phases a repo-grounded input without forcing them to scan the whole codebase again. Interview, PRD, and bead planning all depend on it.

That artifact is the current canonical scan output. Older documentation often referenced `codebase-map.yaml`; that is no longer the primary planning artifact.

## Execution Isolation

Planning phases work with broad artifact context. Execution does the opposite:

- `coding` only gets `bead_data` and retry notes inline, with a read-only pointer to `.ticket/runtime/execution-setup-profile.json` for optional setup/tooling lookup
- `context_wipe` only gets the active bead plus failure context
- `final_test` expands back out to ticket, interview, PRD, and bead context

This narrowing is intentional. Coding quality improves when the prompt is dominated by the exact bead contract instead of by the full planning transcript.

## Practical Consequence

LoopTroop does not ask the model to remember what happened. It asks the model to read the exact artifacts that matter for the current job.

That is the core defense against long-run context degradation.

## Related Docs

- [Core Philosophy](core-philosophy.md)
- [LLM Council](llm-council.md)
- [Execution Loop](execution-loop.md)
- [System Architecture](system-architecture.md)
