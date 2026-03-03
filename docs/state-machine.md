# State Machine Reference

## Overview

The ticket state machine has **26 states**: 25 numbered states (01–25) plus BLOCKED_ERROR. It is implemented using XState v5 with typed events and context.

## State Diagram

```
DRAFT (01)
  └─ START → COUNCIL_DELIBERATING (02)

── Interview Phase ──
COUNCIL_DELIBERATING (02)
  └─ QUESTIONS_READY → COUNCIL_VOTING_INTERVIEW (03)
COUNCIL_VOTING_INTERVIEW (03)
  └─ WINNER_SELECTED → COMPILING_INTERVIEW (04)
COMPILING_INTERVIEW (04)
  └─ READY → WAITING_INTERVIEW_ANSWERS (05) [needs input]
WAITING_INTERVIEW_ANSWERS (05)
  ├─ ANSWER_SUBMITTED → VERIFYING_INTERVIEW_COVERAGE (06)
  └─ SKIP → VERIFYING_INTERVIEW_COVERAGE (06)
VERIFYING_INTERVIEW_COVERAGE (06)
  ├─ COVERAGE_CLEAN → WAITING_INTERVIEW_APPROVAL (07) [needs input]
  └─ GAPS_FOUND → WAITING_INTERVIEW_ANSWERS (05)
WAITING_INTERVIEW_APPROVAL (07)
  ├─ APPROVE → DRAFTING_PRD (08)
  └─ REJECT → COUNCIL_DELIBERATING (02)

── PRD Phase ──
DRAFTING_PRD (08)
  └─ DRAFTS_READY → COUNCIL_VOTING_PRD (09)
COUNCIL_VOTING_PRD (09)
  └─ WINNER_SELECTED → REFINING_PRD (10)
REFINING_PRD (10)
  └─ REFINED → VERIFYING_PRD_COVERAGE (11)
VERIFYING_PRD_COVERAGE (11)
  ├─ COVERAGE_CLEAN → WAITING_PRD_APPROVAL (12) [needs input]
  └─ GAPS_FOUND → REFINING_PRD (10)
WAITING_PRD_APPROVAL (12)
  ├─ APPROVE → DRAFTING_BEADS (13)
  └─ REJECT → DRAFTING_PRD (08)

── Beads Phase ──
DRAFTING_BEADS (13)
  └─ DRAFTS_READY → COUNCIL_VOTING_BEADS (14)
COUNCIL_VOTING_BEADS (14)
  └─ WINNER_SELECTED → REFINING_BEADS (15)
REFINING_BEADS (15)
  └─ REFINED → VERIFYING_BEADS_COVERAGE (16)
VERIFYING_BEADS_COVERAGE (16)
  ├─ COVERAGE_CLEAN → WAITING_BEADS_APPROVAL (17) [needs input]
  └─ GAPS_FOUND → REFINING_BEADS (15)
WAITING_BEADS_APPROVAL (17)
  ├─ APPROVE → PRE_FLIGHT_CHECK (18)
  └─ REJECT → DRAFTING_BEADS (13)

── Execution Phase ──
PRE_FLIGHT_CHECK (18)
  ├─ CHECKS_PASSED → CODING (19)
  └─ CHECKS_FAILED → BLOCKED_ERROR
CODING (19)
  ├─ ALL_BEADS_DONE → RUNNING_FINAL_TEST (20)
  ├─ BEAD_COMPLETE → CODING (self, with guard)
  └─ BEAD_ERROR → BLOCKED_ERROR
RUNNING_FINAL_TEST (20)
  ├─ TESTS_PASSED → INTEGRATING_CHANGES (21)
  └─ TESTS_FAILED → BLOCKED_ERROR
INTEGRATING_CHANGES (21)
  └─ INTEGRATION_DONE → WAITING_MANUAL_VERIFICATION (22) [needs input]

── Completion Phase ──
WAITING_MANUAL_VERIFICATION (22)
  └─ VERIFY_COMPLETE → CLEANING_ENV (23)
CLEANING_ENV (23)
  └─ CLEANUP_DONE → COMPLETED (24)

── Terminal States ──
COMPLETED (24) — final
CANCELED (25) — final

── Error State ──
BLOCKED_ERROR
  ├─ RETRY → (returns to previous state)
  └─ CANCEL → CANCELED
```

## Kanban Column Mapping

| Column | States |
|--------|--------|
| **To Do** | DRAFT |
| **In Progress** | COUNCIL_DELIBERATING, COUNCIL_VOTING_*, COMPILING_INTERVIEW, VERIFYING_*_COVERAGE, DRAFTING_*, REFINING_*, PRE_FLIGHT_CHECK, CODING, RUNNING_FINAL_TEST, INTEGRATING_CHANGES, CLEANING_ENV |
| **Needs Input** | WAITING_INTERVIEW_ANSWERS, WAITING_*_APPROVAL, WAITING_MANUAL_VERIFICATION, BLOCKED_ERROR |
| **Done** | COMPLETED, CANCELED |

## Events

| Event | Payload | Source |
|-------|---------|--------|
| START | — | User action |
| CANCEL | — | User action |
| RETRY | — | User action (from BLOCKED_ERROR) |
| APPROVE | — | User action (approval gates) |
| REJECT | — | User action (approval gates) |
| ANSWER_SUBMITTED | `{ answers }` | User via HTTP |
| SKIP | — | User via HTTP |
| QUESTIONS_READY | `{ result }` | Council actor |
| WINNER_SELECTED | `{ winner }` | Voting actor |
| READY | — | Compile actor |
| DRAFTS_READY | — | Draft actor |
| REFINED | — | Refine actor |
| COVERAGE_CLEAN | — | Coverage actor |
| GAPS_FOUND | — | Coverage actor |
| CHECKS_PASSED | — | Pre-flight actor |
| CHECKS_FAILED | `{ errors }` | Pre-flight actor |
| BEAD_COMPLETE | — | Execution actor |
| BEAD_ERROR | — | Execution actor |
| ALL_BEADS_DONE | — | Execution actor |
| TESTS_PASSED | — | Final test actor |
| TESTS_FAILED | — | Final test actor |
| INTEGRATION_DONE | — | Integration actor |
| VERIFY_COMPLETE | — | User via HTTP |
| CLEANUP_DONE | — | Cleanup actor |
| ERROR | `{ message, codes? }` | Any actor |

## Context

```typescript
interface TicketContext {
  ticketId: string
  projectId: number
  externalId: string
  title: string
  status: string
  previousStatus: string | null  // for RETRY navigation
  error: string | null
  errorCodes: string[]
  beadProgress: { total: number; completed: number; current: string | null }
  iterationCount: number
  maxIterations: number
  councilResults: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}
```
