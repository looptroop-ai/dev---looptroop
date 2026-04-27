# OpenCode Integration

LoopTroop uses OpenCode as its model execution layer, but wraps it with its own session ownership, context assembly, event streaming, and workflow recovery logic.

## Core Modules

| Module | Responsibility |
| --- | --- |
| `server/opencode/adapter.ts` | Concrete OpenCode SDK adapter and interface |
| `server/opencode/factory.ts` | Singleton adapter creation and mock-mode switching |
| `server/opencode/sessionManager.ts` | Session ownership, reconnect, completion, abandonment |
| `server/opencode/contextBuilder.ts` | Phase-specific context assembly |
| `server/workflow/runOpenCodePrompt.ts` | Prompt orchestration and stream handling |

## Adapter Surface

The current `OpenCodeAdapter` interface exposes:

| Method | Purpose |
| --- | --- |
| `createSession()` | Create a new OpenCode session for a project path |
| `promptSession()` | Send prompt parts into an existing session |
| `listSessions()` | Enumerate remote sessions |
| `getSessionMessages()` | Read session message history |
| `subscribeToEvents()` | Stream OpenCode events |
| `listPendingQuestions()` | Read pending human-input requests |
| `replyQuestion()` | Answer a pending request |
| `rejectQuestion()` | Reject a pending request |
| `abortSession()` | Abort a remote session |
| `assembleBeadContext()` | Build bead-context prompt parts |
| `assembleCouncilContext()` | Build council prompt parts |
| `checkHealth()` | Health and availability check |

Session creation, session listing, and message reads accept `AbortSignal`s and are wrapped with bounded SDK-operation timeouts. This prevents OpenCode startup, shutdown, or stalled HTTP calls from hanging the workflow indefinitely.

## Base URL And Modes

| Setting | Meaning |
| --- | --- |
| `LOOPTROOP_OPENCODE_BASE_URL` | Base URL for the OpenCode server |
| `LOOPTROOP_OPENCODE_MODE=mock` | Use the mock adapter instead of the SDK adapter |

If no base URL is set, LoopTroop defaults to `http://127.0.0.1:4096`.

## Session Ownership

LoopTroop does not treat OpenCode sessions as anonymous chat handles. It tracks who owns a session in the project database.

Current ownership dimensions can include:

```json
{
  "ticketId": "AUTH-12",
  "phase": "CODING",
  "phaseAttempt": 1,
  "memberId": null,
  "beadId": "api-refresh-endpoint",
  "iteration": 2,
  "step": null
}
```

This is what lets the backend distinguish:

- one council member's vote session from another
- the first execution attempt for a bead from the second
- a planning session from a coding session on the same ticket

## Prompt Runner

`runOpenCodePrompt()` is the main orchestration helper.

It currently does the following:

1. Resolve or create the session.
2. If `sessionOwnership` is present, call `SessionManager.validateAndReconnect()` first.
3. Dispatch the prompt with tool policy and model settings.
4. Subscribe to stream events while the prompt is running.
5. Reconcile the final response with assistant messages and stream status.
6. Mark the session completed or abandoned depending on the outcome.

`runOpenCodeSessionPrompt()` is the lower-level helper for prompting a known session.

## Reconnect Behavior

Reconnect is intentionally conservative.

`SessionManager.validateAndReconnect()` only succeeds when:

- the ticket still exists
- the ticket is still in the same phase
- the owned active session record still exists in the project DB
- the same session still exists remotely in OpenCode

If any of those checks fail, LoopTroop falls back to creating a fresh session.

That means LoopTroop can survive restart and resume safely, but it does not try to magically continue any random broken stream from the past.

If OpenCode cannot list sessions because the server is down or restarting, validation fails closed without abandoning the database record. The prompt runner then either creates a new owned session when OpenCode is reachable or lets the phase fail into the normal retry/block path. Owned same-session reuse is also revalidated immediately before prompting, so a stale session cannot be prompted after the ticket has moved phases.

## Streaming

OpenCode stream events are consumed server-side and then translated into LoopTroop's own ticket event model.

The prompt runner tracks:

- text events
- reasoning events
- tool events
- step start and finish events
- session status events
- session error events

The frontend never talks directly to OpenCode. It receives normalized ticket events over `/api/stream`.

## Questions And Human Input

OpenCode may request user input during execution. LoopTroop exposes that queue through:

- `GET /api/tickets/:id/opencode/questions`
- `POST /api/tickets/:id/opencode/questions/:requestId/reply`
- `POST /api/tickets/:id/opencode/questions/:requestId/reject`

This lets the workflow remain durable even when the model pauses for an explicit decision.

## Health And Model Discovery

LoopTroop uses two related but different checks:

| Check | Purpose |
| --- | --- |
| `adapter.checkHealth()` | Basic OpenCode availability and version |
| `/api/models` | Provider catalog flattening and connected-model discovery |

If model discovery fails but health still passes, the API returns an empty model list plus a message instead of crashing the UI.

## Startup Recovery

On startup, LoopTroop:

- checks OpenCode health
- hydrates ticket actors from storage
- scans active session records in attached project databases
- attempts reconnect for owned sessions
- abandons stale session records that no longer exist remotely

This is why the OpenCode integration is part of the runtime architecture, not just a transport detail.

Startup session recovery is best effort. If OpenCode itself is unavailable, ticket actors are still hydrated from durable workflow state, and later phase work will either reconnect, create a fresh owned session, or block with a persisted error according to the phase's recovery rules.

## Why LoopTroop Wraps OpenCode This Heavily

OpenCode is the model execution engine. LoopTroop adds:

- phase-aware context assembly
- ticket-aware session ownership
- durable restart behavior
- workflow-aware retries
- frontend-ready event projection

Without that wrapper, the rest of the system would have no safe way to restart, audit, or recover a long-running ticket lifecycle.

## Related Docs

- [Context Isolation](context-isolation.md)
- [Execution Loop](execution-loop.md)
- [API Reference](api-reference.md)
- [System Architecture](system-architecture.md)
