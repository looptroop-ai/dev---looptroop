# Beads

Beads are LoopTroop's execution units. They are the bridge between an approved PRD and an actual coding run.

The current model lives in `server/phases/beads/types.ts`.

## What A Bead Is

A bead is small enough to execute in focused context, but rich enough to encode:

- what must be changed
- what depends on what
- how to verify completion
- what happened in prior attempts

LoopTroop plans features as a bead graph and executes the graph in dependency order.

## Current Bead Shape

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | `string` | Stable bead identifier |
| `title` | `string` | Short execution title |
| `prdRefs` | `string[]` | PRD references that justify the bead |
| `description` | `string` | Full execution task description |
| `contextGuidance` | `{ patterns: string[]; anti_patterns: string[] }` | Local implementation guidance |
| `acceptanceCriteria` | `string[]` | Completion requirements |
| `tests` | `string[]` | What should be verified |
| `testCommands` | `string[]` | Concrete commands to run |
| `priority` | `number` | Execution order |
| `status` | `'pending' | 'in_progress' | 'done' | 'error'` | Current execution state |
| `issueType` | `string` | Task, bug, chore, or similar |
| `externalRef` | `string` | Parent ticket reference |
| `labels` | `string[]` | PRD or planning labels |
| `dependencies` | `{ blocked_by: string[]; blocks: string[] }` | Execution graph edges |
| `targetFiles` | `string[]` | Expected file touch set |
| `notes` | `string` | Durable notes string carried across attempts |
| `iteration` | `number` | Current attempt count for the bead |
| `createdAt` | `string` | ISO timestamp |
| `updatedAt` | `string` | ISO timestamp |
| `completedAt` | `string` | Completion timestamp |
| `startedAt` | `string` | Start timestamp |
| `beadStartCommit` | `string \| null` | Git snapshot used for reset and retry |

## Example Bead

This example matches the current stored shape.

```json
{
  "id": "auth-refresh-token-rotation",
  "title": "Implement refresh-token rotation",
  "prdRefs": ["EPIC-AUTH", "STORY-SESSION-2"],
  "description": "Add refresh-token rotation and invalidation on reuse.",
  "contextGuidance": {
    "patterns": ["Reuse the existing session repository abstraction"],
    "anti_patterns": ["Do not introduce a second token storage format"]
  },
  "acceptanceCriteria": [
    "Refresh tokens rotate on successful refresh",
    "Reused refresh tokens invalidate the session family"
  ],
  "tests": [
    "Cover normal refresh flow",
    "Cover reused refresh token invalidation"
  ],
  "testCommands": [
    "npm run test:server"
  ],
  "priority": 3,
  "status": "pending",
  "issueType": "task",
  "externalRef": "AUTH-12",
  "labels": ["epic:auth", "story:sessions"],
  "dependencies": {
    "blocked_by": ["session-store-foundation"],
    "blocks": ["api-refresh-endpoint"]
  },
  "targetFiles": [
    "server/auth/sessionStore.ts",
    "server/routes/auth.ts"
  ],
  "notes": "",
  "iteration": 1,
  "createdAt": "2026-04-23T09:00:00.000Z",
  "updatedAt": "2026-04-23T09:00:00.000Z",
  "completedAt": "",
  "startedAt": "",
  "beadStartCommit": null
}
```

## Storage Model

The editable bead plan for a ticket is stored under:

```text
.ticket/beads/<flow>/.beads/issues.jsonl
```

Important details:

- `flow` defaults to the ticket base branch when not provided
- the file is line-oriented JSONL
- `PUT /api/tickets/:id/beads` rewrites the full file atomically
- the server also refreshes the approval snapshot and clears execution-setup state after updates

So `issues.jsonl` is durable and canonical, but it is not append-only in the event-log sense.

## Lifecycle

Beads move through a small local lifecycle even while the ticket moves through a much larger workflow lifecycle.

| Bead status | Meaning |
| --- | --- |
| `pending` | Planned but not yet started |
| `in_progress` | Currently selected by the execution loop |
| `done` | Successfully implemented and accepted by the executor |
| `error` | Last attempt failed and needs retry or manual recovery |

The scheduler decides which `pending` bead becomes active based on dependency satisfaction.

## Scheduler Rules

The scheduler logic is intentionally simple and deterministic:

- `getRunnable(beads)` returns dependency-unblocked pending work
- `getNextBead(beads)` picks the next runnable bead
- `isAllComplete(beads)` decides whether the execution stage can advance

This prevents the coding model from deciding its own work order.

## Notes And Iteration

Two fields matter for retry behavior:

| Field | Why it matters |
| --- | --- |
| `notes` | Carries durable execution commentary across attempts |
| `iteration` | Records how many times the bead has been attempted |

The stored bead model uses a single `notes` string. Some runtime context assembly logic may split or project note material into prompt slices, but the canonical bead object itself stores one notes field.

## Diffs And Review

Execution writes bead diff artifacts with artifact types like:

```text
bead_diff:<beadId>
```

Those diffs are exposed through:

```text
GET /api/tickets/:id/beads/:beadId/diff
```

This is how the UI can show what changed for a specific bead without treating the whole ticket as one opaque patch.

## Why Beads Matter Architecturally

Beads are more than tasks:

- they limit coding context
- they provide retry boundaries
- they preserve execution memory
- they create inspectable diffs
- they allow the scheduler to enforce dependencies outside the model

Without beads, LoopTroop would collapse back into a single long-running coding chat with weaker recovery and weaker auditability.

## Related Docs

- [Execution Loop](execution-loop.md)
- [Context Isolation](context-isolation.md)
- [API Reference](api-reference.md)
- [System Architecture](system-architecture.md)
