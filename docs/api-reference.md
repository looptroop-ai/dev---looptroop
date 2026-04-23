# API Reference

LoopTroop's backend is a [Hono.js](https://hono.dev/) server. All endpoints are prefixed with `/api` (when served behind the Vite dev proxy) or served directly on the configured port.

---

## Table of Contents

1. [Base URL & Authentication](#base-url--authentication)
2. [SSE Streaming](#sse-streaming)
3. [Health](#health)
4. [Profiles](#profiles)
5. [Projects](#projects)
6. [Tickets — CRUD](#tickets--crud)
7. [Tickets — Workflow Actions](#tickets--workflow-actions)
8. [Tickets — Interview](#tickets--interview)
9. [Tickets — PRD & Beads](#tickets--prd--beads)
10. [Tickets — Execution Setup Plan](#tickets--execution-setup-plan)
11. [Tickets — Pull Request](#tickets--pull-request)
12. [Tickets — Artifacts & Phases](#tickets--artifacts--phases)
13. [Tickets — OpenCode Questions](#tickets--opencode-questions)
14. [Beads](#beads)
15. [Models](#models)
16. [Files](#files)
17. [Workflow Meta](#workflow-meta)

---

## Base URL & Authentication

In development the React dev server (Vite) proxies `/api/*` → `http://localhost:<BACKEND_PORT>`. In production, the Hono server serves everything directly.

LoopTroop is designed as a **local-only tool** — there is no authentication layer by default. All endpoints are open.

---

## SSE Streaming

Real-time events are delivered to the frontend via Server-Sent Events (SSE):

### `GET /stream`

Subscribes to live events for a ticket.

**Query parameters:**
| Parameter | Required | Description |
|-----------|----------|-------------|
| `ticketId` | ✅ | The ticket's `externalId` (e.g. `PROJ-12`) |
| `lastEventId` | — | Optional; also read from `Last-Event-ID` header for reconnect |

**Initial events:**
- `connected` — Emitted immediately; contains `{ ticketId, clientId, timestamp }`
- Missed events since `lastEventId` are replayed in order

**Ongoing events:**
- `heartbeat` — Every 30 seconds; contains `{ timestamp }`
- `ticket_update` — State machine status change
- `opencode_event` — Raw streaming event from an OpenCode session
- `log_event` — Execution log entries (commands, output lines)
- `bead_update` — Bead status change
- `progress_update` — Progress percentage update

To reconnect reliably, store the last received event ID and pass it via the `Last-Event-ID` header or `lastEventId` query parameter on reconnect. The broadcaster replays all missed events from its in-memory buffer.

---

## Health

### `GET /health`

Returns server health status.

**Response:** `200 OK`
```json
{ "status": "ok", "timestamp": "2025-01-15T14:00:00.000Z" }
```

---

## Profiles

Profiles store global AI model configuration. See [Database Schema — profiles](database-schema.md#table-profiles) for all fields.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/profiles` | List all profiles |
| `GET` | `/profiles/:id` | Get a specific profile |
| `POST` | `/profiles` | Create a new profile |
| `PATCH` | `/profiles/:id` | Update profile fields |
| `DELETE` | `/profiles/:id` | Delete a profile |

---

## Projects

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/projects` | List all projects |
| `GET` | `/projects/:id` | Get project details |
| `POST` | `/projects` | Create a project |
| `PATCH` | `/projects/:id` | Update project fields |
| `DELETE` | `/projects/:id` | Delete a project |

---

## Tickets — CRUD

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/tickets` | List all tickets (optionally filtered by `projectId`) |
| `GET` | `/tickets/:id` | Get a specific ticket (by ID or `externalId`) |
| `POST` | `/tickets` | Create a new ticket |
| `PATCH` | `/tickets/:id` | Update ticket fields (title, description, priority, etc.) |
| `DELETE` | `/tickets/:id` | Delete a ticket and its worktree |
| `GET` | `/tickets/:id/ui-state` | Get persisted UI state (tab open, scroll pos, etc.) |
| `PUT` | `/tickets/:id/ui-state` | Save UI state |

**Create ticket body:**
```json
{
  "projectId": 1,
  "title": "Add user authentication",
  "description": "Implement JWT-based login and refresh token flow",
  "priority": 2
}
```

---

## Tickets — Workflow Actions

These endpoints drive state machine transitions. Each call sends an event to the ticket's XState actor.

| Method | Path | When to call |
|--------|------|-------------|
| `POST` | `/tickets/:id/start` | Start a ticket (DRAFT → SCANNING_RELEVANT_FILES) |
| `POST` | `/tickets/:id/approve` | Approve current step (for states with user approval gates) |
| `POST` | `/tickets/:id/cancel` | Cancel the ticket |
| `POST` | `/tickets/:id/retry` | Retry from BLOCKED_ERROR (sends RETRY event) |
| `POST` | `/tickets/:id/verify` | Trigger re-verification of current phase |
| `POST` | `/tickets/:id/dev-event` | _(Dev only)_ Inject a manual XState event |

**`/start` body:**
```json
{
  "mainImplementer": "openai/o3",
  "councilMembers": ["anthropic/claude-opus-4-5", "google/gemini-2.5-pro"],
  "mainImplementerVariant": "high",
  "councilMemberVariants": { "anthropic/claude-opus-4-5": "latest" }
}
```
This locks the model configuration for the lifetime of the ticket.

---

## Tickets — Interview

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/tickets/:id/answer` | Submit a single answer to an interview question |
| `POST` | `/tickets/:id/answer-batch` | Submit up to 3 answers at once (`BATCH_ANSWERED` event) |
| `PATCH` | `/tickets/:id/edit-answer` | Edit a previously submitted answer |
| `POST` | `/tickets/:id/skip` | Skip an interview question |
| `POST` | `/tickets/:id/approve-interview` | Approve the final interview and advance to PRD generation |
| `GET` | `/tickets/:id/interview` | Get the current interview document |
| `PUT` | `/tickets/:id/interview` | Update the interview document directly |
| `PUT` | `/tickets/:id/interview-answers` | Bulk update all interview answers |
| `GET` | `/tickets/:id/opencode/questions` | List pending OpenCode clarification questions |
| `POST` | `/tickets/:id/opencode/questions/:requestId/reply` | Reply to an OpenCode question |
| `POST` | `/tickets/:id/opencode/questions/:requestId/reject` | Reject an OpenCode question |

**`/answer` body:**
```json
{
  "questionId": "q-3",
  "answer": "The user should be redirected to the dashboard after login."
}
```

**`/answer-batch` body:**
```json
{
  "answers": [
    { "questionId": "q-1", "answer": "..." },
    { "questionId": "q-2", "answer": "..." }
  ]
}
```

---

## Tickets — PRD & Beads

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/tickets/:id/approve-prd` | Approve the PRD and advance to Beads phase |
| `POST` | `/tickets/:id/approve-beads` | Approve the Beads plan and advance to Pre-flight check |

---

## Tickets — Execution Setup Plan

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/tickets/:id/execution-setup-plan` | Get the current execution setup plan |
| `PUT` | `/tickets/:id/execution-setup-plan` | Update the execution setup plan directly |
| `POST` | `/tickets/:id/regenerate-execution-setup-plan` | Trigger AI regeneration of the setup plan |
| `POST` | `/tickets/:id/approve-execution-setup-plan` | Approve and begin execution setup phase |

---

## Tickets — Pull Request

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/tickets/:id/merge` | Complete the PR review as merged |
| `POST` | `/tickets/:id/close-unmerged` | Close the ticket without merging |

---

## Tickets — Artifacts & Phases

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/tickets/:id/artifacts` | List all phase artifacts for the ticket |
| `GET` | `/tickets/:id/phases/:phase/attempts` | List all attempts for a specific phase |

---

## Beads

The beads API operates directly on the `issues.jsonl` file.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/tickets/:id/beads` | Read all beads (parses JSONL, returns array) |
| `PUT` | `/tickets/:id/beads` | Replace the entire bead list (writes JSONL atomically) |
| `GET` | `/tickets/:id/beads/:beadId/diff` | Get the git diff artifact for a completed bead |

**Query parameters for `/beads`:**
| Parameter | Description |
|-----------|-------------|
| `flow` | Branch flow name (defaults to the ticket's base branch) |

**`PUT /beads` body:** JSON array of `Bead` objects. This completely replaces the JSONL file, then calls `upsertBeadsApprovalSnapshot()` and `syncTicketRuntimeProjection()`.

**`GET /beads/:beadId/diff` response:**
```json
{
  "diff": "diff --git a/src/auth.ts b/src/auth.ts\n...",
  "captured": true
}
```
If no diff is available (bead not yet completed), returns `{ "diff": "", "captured": false }`.

---

## Models

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/models` | List available AI models from the OpenCode SDK |

Returns available models for the model selector UI.

---

## Files

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/files` | Browse files for a project |
| `GET` | `/files/content` | Read file content (for the `relevant_files` editor) |

---

## Workflow Meta

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/workflow/meta` | Get static workflow metadata (groups and phases) |

Returns `WORKFLOW_GROUPS` and `WORKFLOW_PHASES` from `shared/workflowMeta.ts` — used by the frontend to render the Kanban board phase structure.

**Response shape:**
```json
{
  "groups": ["planning", "execution", "review"],
  "phases": {
    "DRAFT": { "group": "planning", "label": "Draft", "order": 0 },
    "CODING": { "group": "execution", "label": "Coding", "order": 14 },
    ...
  }
}
```

→ See [State Machine](state-machine.md) for the full list of phases and their groups  
→ See [Frontend](frontend.md) for how the frontend consumes these endpoints  
→ See [OpenCode Integration](opencode-integration.md) for the SSE streaming architecture
