# Configuration Reference

Complete reference for all LoopTroop configuration options.

---

## Table of Contents

- [Profile Configuration](#profile-configuration)
- [Project Configuration](#project-configuration)
- [Ticket Fields](#ticket-fields)
- [Per-Project Overrides](#per-project-overrides)
- [SQLite Pragmas](#sqlite-pragmas)
- [Server Configuration](#server-configuration)
- [Timeout Configuration](#timeout-configuration)

---

## Profile Configuration

Profile settings are global defaults that apply to all projects and tickets unless overridden.

### Required Fields

| Field | Type | Validation | Description |
|-------|------|-----------|-------------|
| `username` | string | Non-empty | Your display name throughout the application |
| `mainImplementer` | string | Valid OpenCode model ID | Primary AI model used for bead execution |
| `councilMembers` | string (JSON array) | Valid model IDs, max 4 | AI models for council deliberation |

### Optional Fields

| Field | Type | Default | Validation | Description |
|-------|------|---------|-----------|-------------|
| `icon` | string | Auto | Any string | Profile avatar or emoji |
| `background` | string | None | Any string | Your expertise level (e.g., "Senior SWE", "PM") |
| `maxIterations` | integer | 5 | ≥ 0 | Max retry attempts per bead. 0 = infinite retries |
| `perIterationTimeout` | integer | 1,200,000 (20 min) | ≥ 0 | Timeout per bead iteration in ms. 0 = no timeout |
| `councilResponseTimeout` | integer | 900,000 (15 min) | ≥ 0 | Timeout for council member responses in ms |
| `minCouncilQuorum` | integer | 2 | 1-4 | Minimum valid council responses required |
| `interviewQuestions` | integer | 50 | ≥ 0 | Max interview questions. 0 = infinite |
| `disableAnalogies` | integer | 0 | 0 or 1 | Disable simplified analogies for non-technical users |

### Zero Value Semantics

| Field | Zero Means |
|-------|-----------|
| `maxIterations = 0` | Infinite retries (keep trying until success) |
| `perIterationTimeout = 0` | No timeout (wait indefinitely for bead completion) |
| `interviewQuestions = 0` | Infinite questions (AI decides when to stop) |

> **Tip:** Setting `perIterationTimeout` to 0 is not recommended. Set it to at least 60 minutes (3,600,000 ms) for complex tasks.

---

## Project Configuration

### Required Fields

| Field | Type | Validation | Description |
|-------|------|-----------|-------------|
| `name` | string | Non-empty | Full project name |
| `shortname` | string | 3-5 uppercase letters | Prefix for ticket IDs (e.g., "PROJ" → PROJ-1) |
| `folderPath` | string | Absolute path, git-initialized | Path to the project repository |

### Optional Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `icon` | string | Default icon | Project emoji or image |
| `color` | string | Random from palette | Ticket border color (hex, 32 options) |
| `profileId` | number | None | Associated profile ID |

### Color Palette Rules

- 32 color options available
- **Red** and **yellow** are excluded (reserved for error/warning states)
- Colors are applied as ticket card border colors on the Kanban board
- Visually distinguishes tickets from different projects

### Editable After Creation

Only these fields can be modified after project creation:
- `name` — Rename the project
- `icon` — Change the icon
- `color` — Change the border color

The `shortname` and `folderPath` are immutable after creation.

---

## Ticket Fields

### On Creation

| Field | Type | Required | Validation | Description |
|-------|------|----------|-----------|-------------|
| `projectId` | number | ✅ | Must exist | Parent project |
| `title` | string | ✅ | Max 200 chars | Ticket title |
| `description` | string | ❌ | Any | Detailed requirements |
| `priority` | number | ❌ | 1-5, default 3 | 1=Very High, 5=Very Low |

### System-Managed Fields

| Field | Description |
|-------|-------------|
| `id` | Auto-incremented integer (database ID) |
| `externalId` | Auto-generated (e.g., "PROJ-12") |
| `status` | Current XState state name |
| `xstateSnapshot` | Serialized XState snapshot (JSON) |
| `createdAt` | Ticket creation timestamp |
| `startedAt` | When ticket was started (To Do → In Progress) |
| `updatedAt` | Last state change timestamp |

### Editable After Creation

Only these fields can be modified:
- `title` — Rename the ticket
- `priority` — Change priority level

**Status is API-protected** — use workflow actions (start, cancel, retry, approve, etc.).

---

## Per-Project Overrides

Projects can override profile-level settings. If set on a project, these take precedence over the profile defaults:

| Override | Description |
|----------|-------------|
| `councilMembers` | Use different models for this project (NULL = use profile) |
| `maxIterations` | Different retry limit for this project |
| `perIterationTimeout` | Different timeout for this project |
| `councilResponseTimeout` | Different council timeout for this project |
| `minCouncilQuorum` | Different quorum for this project |
| `interviewQuestions` | Different question limit for this project |

### Resolution Order

```
Project override → Profile default → System default
```

Example: If a project has `maxIterations = 10` and the profile has `maxIterations = 5`, the project's tickets will use 10.

---

## SQLite Pragmas

Applied on database initialization:

| Pragma | Value | Purpose |
|--------|-------|---------|
| `journal_mode` | WAL | Write-Ahead Logging for crash safety |
| `locking_mode` | NORMAL | Allow concurrent connections |
| `synchronous` | NORMAL | Balance durability and performance |
| `busy_timeout` | 5000 | Wait 5s if database is locked |
| `wal_autocheckpoint` | 1000 | Auto-checkpoint every 1000 pages |

### WAL Checkpoint

A background timer runs `PRAGMA wal_checkpoint(PASSIVE)` every **30 seconds** to prevent WAL file bloat.

---

## Server Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| Backend port | 3000 | Hono HTTP server port |
| Frontend port | 5173 | Vite dev server port |
| OpenCode port | 4096 | OpenCode server port |
| SSE heartbeat | 30s | Keep-alive ping interval |
| SSE buffer size | bounded | Event replay buffer for reconnection |
| Checkpoint interval | 30s | WAL checkpoint timer |

### Node.js Memory

For long unattended runs:
```bash
NODE_OPTIONS="--max-old-space-size=4096" npm run dev
```

---

## Timeout Configuration

### Bead Execution Timeouts

| Timeout | Setting | Default | Description |
|---------|---------|---------|-------------|
| Per-iteration | `perIterationTimeout` | 20 min | Max time for a single bead attempt |
| Max iterations | `maxIterations` | 5 | Max retry attempts per bead |
| Total bead time | iterations × timeout | ~100 min | Worst case per bead |

### Council Timeouts

| Timeout | Setting | Default | Description |
|---------|---------|---------|-------------|
| Council response | `councilResponseTimeout` | 15 min | Max wait per council member |
| Draft phase | Per member | 15 min | Time for each member to generate draft |
| Vote phase | Per member | 15 min | Time for each member to score all drafts |

### Member Outcomes

Each council member's response is tracked:

| Outcome | Description | Counts Toward Quorum? |
|---------|-------------|----------------------|
| `completed` | Valid response within timeout | ✅ Yes |
| `timed_out` | No response before timeout | ❌ No |
| `invalid_output` | Malformed or fails validation | ❌ No |

If fewer than `minCouncilQuorum` members produce `completed` responses → `BLOCKED_ERROR`.
