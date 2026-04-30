# API Reference

All backend routes are mounted under `/api`.

This page documents the current HTTP surface exposed by `server/index.ts` and the route handlers in `server/routes/*`.

## Conventions

| Convention | Meaning |
| --- | --- |
| Ticket identifiers | Most ticket endpoints use the external ticket reference, not the local numeric DB id |
| JSON validation | Most write routes validate request bodies with Zod or route-specific parsers |
| Streaming | Live ticket updates use Server-Sent Events from `/api/stream` |
| Error shape | Error responses usually include `error` and sometimes `details` or `message` |

## Health, Models, Workflow Meta, And Streaming

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/health` | Basic process health |
| `GET` | `/api/health/opencode` | OpenCode reachability and version |
| `GET` | `/api/health/startup` | Startup recovery and restore status |
| `POST` | `/api/health/startup/restore-notice/dismiss` | Dismiss startup restore notice |
| `GET` | `/api/models` | Connected and full model catalog |
| `GET` | `/api/workflow/meta` | Current workflow groups and phases |
| `GET` | `/api/stream?ticketId=<id>` | Ticket-scoped SSE stream |

`/api/stream` also accepts `lastEventId` as a query parameter. Browsers normally send `Last-Event-ID` automatically only for native reconnects; the frontend persists the last event id per ticket and sends the query value after reloads so the backend can replay buffered events when possible.

Example health payload:

```json
{
  "status": "ok",
  "timestamp": "2026-04-23T09:00:00.000Z",
  "uptime": 1234.56
}
```

Example models payload:

```json
{
  "models": [],
  "allModels": [],
  "connectedProviders": [],
  "defaultModels": {},
  "message": "OpenCode server is not reachable. Start it with `opencode serve`."
}
```

## Profile Routes

LoopTroop uses a singleton profile, not a collection.

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/profile` | Returns the singleton profile or `null` |
| `POST` | `/api/profile` | Creates the singleton profile |
| `PATCH` | `/api/profile` | Updates the singleton profile |

Example profile update payload:

```json
{
  "mainImplementer": "openai/gpt-5.4",
  "mainImplementerVariant": "high",
  "councilMembers": "[\"openai/gpt-5.4\",\"anthropic/claude-sonnet-4\"]",
  "minCouncilQuorum": 2,
  "perIterationTimeout": 1800,
  "executionSetupTimeout": 900,
  "councilResponseTimeout": 240,
  "interviewQuestions": 12,
  "coverageFollowUpBudgetPercent": 35,
  "maxCoveragePasses": 3,
  "maxPrdCoveragePasses": 5,
  "maxBeadsCoveragePasses": 5,
  "maxIterations": 5,
  "toolInputMaxChars": 4000,
  "toolOutputMaxChars": 12000,
  "toolErrorMaxChars": 6000
}
```

## Project Routes

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/projects/check-git?path=...` | Validates git and GitHub origin status for a folder |
| `GET` | `/api/projects/ls?path=...` | Directory browser used by the attach-project flow |
| `GET` | `/api/projects` | List attached projects |
| `GET` | `/api/projects/:id` | Get one project |
| `POST` | `/api/projects` | Attach a project |
| `PATCH` | `/api/projects/:id` | Update project settings |
| `DELETE` | `/api/projects/:id` | Delete a project if no active tickets remain |

Example project attachment payload:

```json
{
  "name": "LoopTroop",
  "shortname": "LOOP",
  "folderPath": "/home/liviu/LoopTroop",
  "icon": "📁",
  "color": "#3b82f6",
  "profileId": 1
}
```

## Ticket Routes

### CRUD And UI State

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/tickets` | Optionally filtered with `?projectId=` |
| `GET` | `/api/tickets/:id` | Get one ticket |
| `POST` | `/api/tickets` | Create a ticket |
| `PATCH` | `/api/tickets/:id` | Update title, description, or priority |
| `DELETE` | `/api/tickets/:id` | Only allowed for `COMPLETED` or `CANCELED` |
| `GET` | `/api/tickets/:id/ui-state?scope=...` | Read persisted UI state |
| `PUT` | `/api/tickets/:id/ui-state` | Save persisted UI state |

Example ticket creation payload:

```json
{
  "projectId": 1,
  "title": "Implement refresh-token rotation",
  "description": "Rotate refresh tokens and invalidate the family on reuse.",
  "priority": 2
}
```

Example UI-state payload:

```json
{
  "scope": "interview-drafts",
  "data": {
    "draftAnswers": {},
    "skippedQuestions": {},
    "selectedOptions": {}
  }
}
```

Example UI-state response:

```json
{
  "scope": "interview-drafts",
  "exists": true,
  "data": {
    "draftAnswers": {},
    "skippedQuestions": {},
    "selectedOptions": {}
  },
  "updatedAt": "2026-04-23T09:00:00.000Z"
}
```

### Workflow Actions

| Method | Route | Notes |
| --- | --- | --- |
| `POST` | `/api/tickets/:id/start` | Starts a `DRAFT` ticket using locked profile and project settings |
| `POST` | `/api/tickets/:id/approve` | Generic workflow approval endpoint |
| `POST` | `/api/tickets/:id/cancel` | Cancel active work — accepts an optional JSON body (see below) |
| `POST` | `/api/tickets/:id/approve-interview` | Approve interview artifact |
| `POST` | `/api/tickets/:id/approve-prd` | Approve PRD artifact |
| `POST` | `/api/tickets/:id/approve-beads` | Approve bead plan artifact |
| `POST` | `/api/tickets/:id/approve-execution-setup-plan` | Approve execution setup plan |
| `POST` | `/api/tickets/:id/merge` | Merge delivered PR |
| `POST` | `/api/tickets/:id/close-unmerged` | Close without merge |
| `POST` | `/api/tickets/:id/verify` | Currently handled by the merge handler alias |
| `POST` | `/api/tickets/:id/retry` | Retry a blocked ticket or failed phase |
| `POST` | `/api/tickets/:id/dev-event` | Development event injection endpoint |

The cancel endpoint accepts an optional JSON request body to trigger cleanup at cancellation time. Both fields default to `false`; the ticket record itself is never deleted.

```json
{
  "deleteContent": false,
  "deleteLog": false
}
```

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `deleteContent` | `boolean` | `false` | Permanently removes all AI-generated artifacts (interview Q&A, PRD drafts, beads plan) from the database and deletes the isolated git worktree and its branch |
| `deleteLog` | `boolean` | `false` | Permanently removes both execution log files (`.ticket/runtime/execution-log.jsonl` and `.ticket/runtime/execution-log.debug.jsonl`) for this ticket. This is only effective when the worktree still exists; if `deleteContent` is also `true` the worktree removal already covers the logs |

### Interview And Planning Editing

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/tickets/:id/interview` | Returns interview payload with `winnerId`, `raw`, `document`, `session`, and `questions` |
| `PUT` | `/api/tickets/:id/interview` | Save raw interview YAML |
| `PUT` | `/api/tickets/:id/interview-answers` | Save structured interview answers during approval or planning restart |
| `POST` | `/api/tickets/:id/answer` | Deprecated, returns `410`; use `answer-batch` |
| `POST` | `/api/tickets/:id/answer-batch` | Submit interview answers |
| `POST` | `/api/tickets/:id/skip` | Skip remaining interview questions |
| `PATCH` | `/api/tickets/:id/edit-answer` | Edit a previously recorded answer while waiting for interview answers |

Interview and PRD approval edits are planning-only. After approval, saving an interview edit is allowed while the ticket is still before `PRE_FLIGHT_CHECK`; if PRD or beads planning already exists, LoopTroop archives the current approved interview version and downstream PRD/beads phase attempts, cancels active downstream sessions as intentional cancellation, clears stale downstream artifacts and approval UI state, saves and approves the edited interview as the new active version, and starts `DRAFTING_PRD`. Saving a PRD edit follows the same contract for the current approved PRD version and downstream beads attempts, then starts `DRAFTING_BEADS`.

Archived versions are read-only approved planning generations backed by phase attempts. Once a ticket reaches `PRE_FLIGHT_CHECK` or any later execution-band status, interview and PRD edit saves return `409`. Intentional downstream session aborts during these planning restarts are cancellation, not blocked errors, and existing tickets/projects such as `PCKM-22` are not migrated or repaired.

Current batch-answer payload:

```json
{
  "answers": {
    "q-auth-1": "Support both password login and SSO."
  },
  "selectedOptions": {
    "q-auth-2": ["option-password", "option-sso"]
  }
}
```

Possible `answer-batch` response shapes:

```json
{
  "accepted": true
}
```

```json
{
  "questions": [],
  "progress": {
    "answered": 4,
    "total": 8
  },
  "isComplete": false,
  "isFinalFreeForm": false,
  "aiCommentary": "Need one more clarification about session lifetime.",
  "batchNumber": 2,
  "source": "coverage",
  "roundNumber": 1
}
```

Structured interview-answer approval payload:

```json
{
  "questions": [
    {
      "id": "q-auth-1",
      "answer": {
        "skipped": false,
        "selected_option_ids": [],
        "free_text": "Support password login and SSO."
      }
    }
  ]
}
```

### Execution Setup Plan Routes

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/tickets/:id/execution-setup-plan` | Read the current setup plan |
| `PUT` | `/api/tickets/:id/execution-setup-plan` | Save setup plan as raw content or structured plan |
| `POST` | `/api/tickets/:id/regenerate-execution-setup-plan` | Regenerate the plan with commentary |

Execution setup plan read response:

```json
{
  "exists": true,
  "artifactId": 42,
  "updatedAt": "2026-04-23T09:00:00.000Z",
  "raw": "{\n  \"schema_version\": \"1\",\n  \"ticket_id\": \"AUTH-12\"\n}",
  "plan": {
    "schemaVersion": "1",
    "ticketId": "AUTH-12"
  }
}
```

Regeneration payload:

```json
{
  "commentary": "Tighten the temp-root cleanup steps and add the full lint command.",
  "rawContent": "{\n  \"schema_version\": \"1\",\n  \"ticket_id\": \"AUTH-12\"\n}"
}
```

### OpenCode Question Routes

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/tickets/:id/opencode/questions` | List pending OpenCode question requests |
| `POST` | `/api/tickets/:id/opencode/questions/:requestId/reply` | Submit question answers |
| `POST` | `/api/tickets/:id/opencode/questions/:requestId/reject` | Reject a question request |

Reply payload:

```json
{
  "answers": [
    ["yes"],
    ["postgres", "redis"]
  ]
}
```

### Artifact And History Routes

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/tickets/:id/artifacts` | List ticket artifacts, optionally filtered |
| `GET` | `/api/tickets/:id/phases/:phase/attempts` | List phase attempt history |

## File Routes

These routes are intentionally narrow.

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/files/:ticketId/logs` | Read folded normal execution logs from `.ticket/runtime/execution-log.jsonl` |
| `GET` | `/api/files/:ticketId/logs?channel=debug` | Read folded debug/forensic execution logs from `.ticket/runtime/execution-log.debug.jsonl`; the same `status`, `phase`, and `phaseAttempt` filters apply |
| `GET` | `/api/files/:ticketId/:file` | Only `interview` or `prd` |
| `PUT` | `/api/files/:ticketId/:file` | Only `interview` or `prd` |

Log routes accept optional `status`, `phase`, and `phaseAttempt` filters. The same filters apply to the default normal log channel and `channel=debug`.

There is no generic filesystem browser or arbitrary file read route under `/api/files`.

## Bead Routes

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/tickets/:id/beads` | Read bead plan; accepts optional `?flow=` |
| `PUT` | `/api/tickets/:id/beads` | Replace bead plan; accepts optional `?flow=` |
| `GET` | `/api/tickets/:id/beads/:beadId/diff` | Read diff artifact for a bead |

## SSE Events

The stream endpoint emits:

- `connected`
- `heartbeat`
- `state_change`
- `log`
- `progress`
- `error`
- `bead_complete`
- `needs_input`
- `artifact_change`

Current custom event types are defined in `server/sse/eventTypes.ts`.

SSE replay is an optimization, not the only recovery path. After a reconnect with a remembered event id, the frontend also invalidates the ticket, list, artifacts, interview, setup-plan, bead, and server-log queries so missed events outside the replay buffer are reconciled from durable storage.

Example `state_change` event payload:

```json
{
  "ticketId": "AUTH-12",
  "from": "DRAFTING_PRD",
  "to": "WAITING_PRD_APPROVAL",
  "previousStatus": "VERIFYING_PRD_COVERAGE",
  "timestamp": "2026-04-23T09:00:00.000Z"
}
```

Example `artifact_change` event payload:

```json
{
  "ticketId": "AUTH-12",
  "phase": "CODING",
  "artifactType": "bead_diff:api-refresh-endpoint",
  "artifact": {
    "id": 84,
    "ticketId": "AUTH-12",
    "phase": "CODING",
    "phaseAttempt": 1,
    "artifactType": "bead_diff:api-refresh-endpoint",
    "filePath": null,
    "content": "diff --git a/server/routes/auth.ts b/server/routes/auth.ts\n...",
    "createdAt": "2026-04-23T09:00:00.000Z",
    "updatedAt": "2026-04-23T09:00:00.000Z"
  },
  "timestamp": "2026-04-23T09:00:00.000Z"
}
```

## Related Docs

- [Frontend](frontend.md)
- [OpenCode Integration](opencode-integration.md)
- [State Machine](state-machine.md)
- [System Architecture](system-architecture.md)
