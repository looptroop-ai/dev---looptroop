# API Reference

## Base URL

Development: `http://localhost:5173/api` (proxied through Vite to Hono backend)

## Profiles

### GET /api/profile
Get the current user profile.

**Response:** `Profile | null`

### POST /api/profile
Create a new profile (first run).

**Body:**
```json
{
  "username": "string (required)",
  "icon": "string (optional)",
  "background": "string (optional, e.g. 'Senior SWE')",
  "mainImplementer": "string (optional, model ID)",
  "councilMembers": "string (optional, JSON array of model IDs)",
  "maxIterations": "number (optional, 0=infinite, default 5)",
  "perIterationTimeout": "number (optional, 0=no timeout, default 1200000ms)",
  "councilResponseTimeout": "number (optional, default 900000ms)",
  "minCouncilQuorum": "number (optional, 1-4, default 2)",
  "interviewQuestions": "number (optional, 0=infinite, default 50)",
  "disableAnalogies": "number (optional, 0 or 1, default 0)"
}
```

### PATCH /api/profile
Update profile settings.

## Projects

### GET /api/projects
List all projects.

### POST /api/projects
Create a new project.

**Body:**
```json
{
  "name": "string (required)",
  "shortname": "string (required, 3-5 uppercase letters)",
  "icon": "string (optional)",
  "color": "string (optional, hex color)",
  "folderPath": "string (required, absolute path)",
  "profileId": "number (optional)"
}
```

### GET /api/projects/:id
Get project details.

### PATCH /api/projects/:id
Update project (name, icon, color, per-project overrides).

### DELETE /api/projects/:id
Remove a project.

## Tickets

### GET /api/tickets
List all tickets. Filter with `?project=X` or `?projectId=X`.

### POST /api/tickets
Create a new ticket.

**Body:**
```json
{
  "projectId": "number (required)",
  "title": "string (required, max 200)",
  "description": "string (optional)",
  "priority": "number (optional, 1-5, default 3)"
}
```

### GET /api/tickets/:id
Get ticket details.

### PATCH /api/tickets/:id
Update ticket (title, description, priority). **Status is API-protected** — use workflow actions.

## Workflow Actions

All workflow actions are POST requests that send XState events.

### POST /api/tickets/:id/start
Start ticket execution (DRAFT → COUNCIL_DELIBERATING).

### POST /api/tickets/:id/cancel
Cancel a ticket (any non-terminal state → CANCELED).

### POST /api/tickets/:id/retry
Retry from BLOCKED_ERROR (returns to previous state).

### POST /api/tickets/:id/answer
Submit interview answers.

**Body:**
```json
{
  "answers": { "q1": "answer text", "q2": "answer text" }
}
```

### POST /api/tickets/:id/skip
Skip the current interview question.

### POST /api/tickets/:id/approve-interview
Approve interview results (WAITING_INTERVIEW_APPROVAL → DRAFTING_PRD).

### POST /api/tickets/:id/approve-prd
Approve PRD (WAITING_PRD_APPROVAL → DRAFTING_BEADS).

### POST /api/tickets/:id/approve-beads
Approve beads (WAITING_BEADS_APPROVAL → PRE_FLIGHT_CHECK).

### POST /api/tickets/:id/verify
Complete manual verification (WAITING_MANUAL_VERIFICATION → CLEANING_ENV).

## Files

### GET /api/files/:ticketId/:file
Read a ticket artifact file. `:file` is `interview` or `prd`.

**Response:**
```json
{
  "content": "string (YAML content)",
  "exists": true
}
```

### PUT /api/files/:ticketId/:file
Write a ticket artifact file. Atomic write (temp + rename).

**Body:**
```json
{
  "content": "string (YAML content)"
}
```

## Beads

### GET /api/tickets/:id/beads?flow=main
Read beads for a ticket (parsed JSONL → JSON array).

### PUT /api/tickets/:id/beads?flow=main
Write beads for a ticket (JSON array → JSONL). Atomic write.

## Streaming

### GET /api/stream?ticketId=X
SSE connection for real-time updates.

**Headers:** `Accept: text/event-stream`
**Reconnection:** Send `Last-Event-ID` header to replay missed events.

**Event types:**

| Event | Fields | Description |
|-------|--------|-------------|
| `connected` | `ticketId`, `clientId`, `timestamp` | Initial connection |
| `state_change` | `ticketId`, `from`, `to` | State transition |
| `log` | `ticketId`, `type`, `content` | AI output streaming |
| `progress` | `ticketId`, `bead`, `total`, `percent` | Execution progress |
| `error` | `ticketId`, `message`, `recoverable` | Error notification |
| `bead_complete` | `ticketId`, `beadId`, `attempts` | Bead finished |
| `needs_input` | `ticketId`, `type`, `questionIndex` | User input needed |
| `heartbeat` | `timestamp` | Keep-alive (30s) |

## Health

### GET /api/health
LoopTroop server status.

### GET /api/health/opencode
OpenCode server connectivity status.

## Models

### GET /api/models
List available AI models (via OpenCode SDK).
