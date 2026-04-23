# Context Isolation

LoopTroop's most critical anti-rot mechanism is `buildMinimalContext()` — a function that assembles the exact minimum context for each phase, enforcing strict allowlists, token budgets, and deterministic trim priorities.

---

## Table of Contents

1. [The Problem it Solves](#the-problem-it-solves)
2. [buildMinimalContext()](#buildminimalcontext)
3. [Phase Allowlists](#phase-allowlists)
4. [Context Sources Explained](#context-sources-explained)
5. [Token Budget & Trim Priority](#token-budget--trim-priority)
6. [Context Cache](#context-cache)
7. [Per-Phase Context Summary](#per-phase-context-summary)
8. [The Golden Rule](#the-golden-rule)

---

## The Problem it Solves

Without a strict context-assembly system, it would be tempting to "just send everything" to each AI prompt — the full interview, the full PRD, the full bead list, all previous session history. This is exactly what makes long-running sessions degrade.

LoopTroop solves this with a **contract**: every OpenCode prompt call must go through `buildMinimalContext()`. Direct ad-hoc prompt assembly is **forbidden** in the codebase. This is enforced architecturally — the function is the single mandatory entry point for all context assembly.

---

## buildMinimalContext()

**Module:** `server/opencode/contextBuilder.ts`

```typescript
function buildMinimalContext(
  phase: string,
  ticketState: TicketState,
  activeItem?: string,
): PromptPart[]
```

The function:
1. Looks up `phase` in `PHASE_ALLOWLISTS` — throws if phase is unknown.
2. Iterates the allowlist and extracts only the permitted sources from `ticketState`.
3. Sorts parts (ticket_details always first, then in insertion order).
4. Applies the token budget trim if needed.
5. Returns an array of `PromptPart[]` to be sent to OpenCode.

`TicketState` is the data bag that carries all available artifacts for a ticket:

```typescript
interface TicketState {
  ticketId: string
  title?: string
  description?: string
  relevantFiles?: string      // codebase-map.yaml content
  interview?: string          // Final interview YAML
  fullAnswers?: string[]      // Full-answers artifacts per council member
  prd?: string                // Final PRD YAML
  beads?: string              // Final beads JSONL/YAML
  beadsDraft?: string         // Semantic beads draft (pre-expansion)
  drafts?: string[]           // Council draft content (per member)
  votes?: string[]            // Council vote scorecards (per member)
  beadData?: string           // Active bead JSON
  beadNotes?: string[]        // Context wipe notes from prior iterations
  executionSetupProfile?: string
  executionSetupPlan?: string
  executionSetupPlanNotes?: string[]
  executionSetupNotes?: string[]
  finalTestNotes?: string[]
  userAnswers?: string
  tests?: string
  errorContext?: string
}
```

---

## Phase Allowlists

Each phase has a hard-coded allowlist specifying **exactly which context sources are permitted**. Any source not in the allowlist is silently excluded, even if available.

| Phase | Allowed Sources |
|-------|----------------|
| `interview_draft` | `relevant_files`, `ticket_details` |
| `interview_vote` | `relevant_files`, `ticket_details`, `drafts` |
| `interview_refine` | `relevant_files`, `ticket_details`, `drafts` |
| `interview_qa` | `relevant_files`, `ticket_details`, `interview`, `user_answers` |
| `interview_coverage` | `ticket_details`, `user_answers`, `interview` |
| `prd_draft` | `relevant_files`, `ticket_details`, `interview`, `full_answers` |
| `prd_vote` | `relevant_files`, `ticket_details`, `interview`, `drafts` |
| `prd_refine` | `relevant_files`, `ticket_details`, `full_answers`, `drafts` |
| `prd_coverage` | `interview`, `full_answers`, `prd` |
| `beads_draft` | `relevant_files`, `ticket_details`, `prd` |
| `beads_vote` | `relevant_files`, `ticket_details`, `prd`, `drafts` |
| `beads_refine` | `relevant_files`, `ticket_details`, `prd`, `drafts` |
| `beads_expand` | `relevant_files`, `ticket_details`, `prd`, `beads_draft` |
| `beads_coverage` | `prd`, `beads` |
| `execution_setup_plan` | `ticket_details`, `relevant_files`, `prd`, `beads`, `execution_setup_profile`, `execution_setup_plan_notes` |
| `execution_setup_plan_regenerate` | `ticket_details`, `relevant_files`, `prd`, `beads`, `execution_setup_profile`, `execution_setup_plan`, `execution_setup_plan_notes` |
| `execution_setup` | `ticket_details`, `beads`, `execution_setup_plan`, `execution_setup_notes` |
| `coding` | `bead_data`, `bead_notes`, `execution_setup_profile` |
| `context_wipe` | `bead_data`, `error_context` |
| `final_test` | `ticket_details`, `interview`, `prd`, `beads`, `final_test_notes` |
| `preflight` | `ticket_details` |

> **Note on `coding`:** The execution phase receives only the single active bead's data, its accumulated notes from prior iterations, and the execution setup profile. **Nothing else** — no PRD, no other beads, no conversation history.

---

## Context Sources Explained

| Source Key | Description |
|-----------|-------------|
| `ticket_details` | Ticket title + description, formatted with a clear "Primary User Requirement" header |
| `relevant_files` | `codebase-map.yaml` — a map of repository files relevant to this ticket (generated at `SCANNING_RELEVANT_FILES`) |
| `interview` | Final approved interview results YAML |
| `full_answers` | Full-answers artifacts produced per council member (array — one entry per member) |
| `prd` | Final approved PRD YAML |
| `beads` | Final approved beads JSONL/YAML |
| `beads_draft` | Semantic beads draft before terminal expansion (used by `beads_expand`) |
| `drafts` | Array of council draft strings (one per completed member) |
| `votes` | Array of council vote scorecards |
| `bead_data` | Single active bead JSON specification |
| `bead_notes` | Array of context wipe notes from previous failed iterations of this bead |
| `execution_setup_profile` | Environment profile (how to install deps, run tests, etc.) |
| `execution_setup_plan` | AI-generated setup plan (commands to run) |
| `execution_setup_plan_notes` | Notes from prior regenerate attempts |
| `execution_setup_notes` | Notes from prior failed setup executions |
| `final_test_notes` | Notes from prior failed final test runs |
| `user_answers` | Raw user answers from interview Q&A |
| `tests` | Test file content (used in specific verification phases) |
| `error_context` | Compiled error details for context-wipe prompt |

---

## Token Budget & Trim Priority

The default token budget is **100,000 tokens** (counted with `gpt-tokenizer`'s BPE encoder).

If assembling all allowed sources would exceed this budget, sources are trimmed **one at a time in priority order** (lowest priority removed first):

| Priority (lowest first) | Source |
|------------------------|--------|
| 1 (trimmed first) | `error_context` |
| 2 | `bead_notes` |
| 3 | `execution_setup_plan_notes` |
| 4 | `execution_setup_notes` |
| 5 | `final_test_notes` |
| 6 | `user_answers` |
| 7 | `tests` |
| 8 | `votes` |
| 9 | `drafts` |
| 10 | `full_answers` |
| 11 | `beads_draft` |
| 12 | `beads` |
| 13 | `interview` |
| 14 | `prd` |
| 15 | `relevant_files` |
| 16 | `execution_setup_plan` |
| 17 | `execution_setup_profile` |
| 18 (trimmed last) | `ticket_details` |

The most essential source — `ticket_details` — is almost never trimmed. The least essential contextual enrichment (error context, historical notes) is trimmed first.

> **Important:** Trim is applied whole-source at a time, not by truncating individual strings. If budget is tight, entire sources are dropped.

---

## Context Cache

Reusable, expensive-to-load sources are cached in memory to avoid redundant disk/YAML reads:

```typescript
// In-memory cache: key = "<ticketId>:<source>", value = { content, timestamp }
const contextCache = new Map<string, { content: string; timestamp: number }>()
const CACHE_TTL = 300_000  // 5 minutes
```

Cached sources: `relevant_files`, `interview`, `prd` (the three most frequently reused and least likely to change mid-session).

The cache is ticket-scoped: `clearContextCache(ticketId)` removes all entries for a ticket, called when artifacts are updated.

> **Note:** There is also a richer `ContextCache` class in `server/opencode/contextCache.ts` that tracks token counts and provides invalidation helpers. A future cleanup task will consolidate these two implementations.

---

## Per-Phase Context Summary

Here's a human-readable view of what each phase "sees":

### Interview Draft
> "Tell me about this ticket: {title + description}. Here are the relevant files in the codebase: {codebase-map}. Please generate interview questions."

### Coding (Bead Execution)
> "Here is the bead you need to implement: {bead JSON}. Here is what failed in previous attempts: {context wipe notes}. Here is your environment: {execution setup profile}. Build it."

The coding phase is the most minimal — only 3 sources — because it's the most performance-critical. A bloated context here directly causes execution failures.

### Final Test
> "Here's the ticket: {ticket details}. Here's the full interview: {interview}. Here's the PRD: {prd}. Here's the full bead list: {beads}. Here are notes from prior test failures: {final test notes}. Run the final tests."

---

## The Golden Rule

> **Every OpenCode prompt call must use `buildMinimalContext()`.**
> **Direct ad-hoc prompt assembly is forbidden.**

This is enforced by code review and architecture. The function is the single contract that guarantees context isolation across the entire codebase.

If you add a new phase or sub-phase, you must:
1. Add an entry to `PHASE_ALLOWLISTS` in `contextBuilder.ts`.
2. Call `buildMinimalContext(yourPhase, ticketState)` to assemble the prompt parts.
3. Document which sources your phase needs and why.
