# Database Schema

LoopTroop uses **per-project SQLite databases** (not a single global DB). Each project has its own isolated `.looptroop/db.sqlite` file within the project's folder. The schema is managed with [Drizzle ORM](https://orm.drizzle.team/).

---

## Table of Contents

1. [Database Isolation Model](#database-isolation-model)
2. [Tables Overview](#tables-overview)
3. [Table: profiles](#table-profiles)
4. [Table: app_meta](#table-app_meta)
5. [Table: attached_projects](#table-attached_projects)
6. [Table: projects](#table-projects)
7. [Table: tickets](#table-tickets)
8. [Table: phase_artifacts](#table-phase_artifacts)
9. [Table: ticket_phase_attempts](#table-ticket_phase_attempts)
10. [Table: opencode_sessions](#table-opencode_sessions)
11. [Table: ticket_status_history](#table-ticket_status_history)
12. [Table: ticket_error_occurrences](#table-ticket_error_occurrences)
13. [Entity Relationships](#entity-relationships)
14. [XState Snapshot Persistence](#xstate-snapshot-persistence)

---

## Database Isolation Model

There is **no global LoopTroop database**. Each project that is attached to LoopTroop gets its own:

```
<project-folder>/.looptroop/db.sqlite
```

This means:
- Projects are completely independent — you can safely delete one without affecting others.
- Each DB is small and focused on a single project's tickets.
- Schema migrations run per-project via `db:push` (Drizzle Kit).

The server loads the correct project DB dynamically based on the `projectId` in each request context.

---

## Tables Overview

| Table | Description |
|-------|-------------|
| `profiles` | Global AI model configuration (council members, timeouts, limits) |
| `app_meta` | Generic key-value store for app-level metadata |
| `attached_projects` | Registry of projects currently linked to LoopTroop |
| `projects` | Project definitions (name, path, per-project config overrides) |
| `tickets` | Core work items; contains XState snapshot for machine persistence |
| `phase_artifacts` | All intermediate artifacts (interview YAML, PRD, beads, diffs, notes) |
| `ticket_phase_attempts` | Tracks each attempt at a phase (for retry history) |
| `opencode_sessions` | Maps OpenCode session IDs to ticket/phase/bead/iteration ownership |
| `ticket_status_history` | Immutable log of every status transition |
| `ticket_error_occurrences` | Structured record of every BLOCKED_ERROR occurrence |

---

## Table: profiles

Stores the default AI model configuration. A profile is applied globally, with per-project overrides in `projects`.

**Module:** `server/db/schema.ts`

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | INTEGER PK | auto | Profile ID |
| `main_implementer` | TEXT | — | Model ID of the main implementer (e.g. `openai/o3`) |
| `main_implementer_variant` | TEXT | — | Optional variant name for the main implementer |
| `council_members` | TEXT | — | JSON array of council member model IDs |
| `council_member_variants` | TEXT | — | JSON map: `{ "provider/model": "variant" }` |
| `min_council_quorum` | INTEGER | 2 | Minimum members required to form a valid council |
| `per_iteration_timeout` | INTEGER | 1,200,000 | Per-bead iteration timeout (ms) — 20 min |
| `execution_setup_timeout` | INTEGER | varies | Timeout for execution setup phase (ms) |
| `council_response_timeout` | INTEGER | 1,200,000 | Timeout for any single council prompt (ms) |
| `interview_questions` | INTEGER | 50 | Max interview questions to generate |
| `coverage_follow_up_budget_percent` | INTEGER | 20 | Budget for coverage follow-up questions (% of main) |
| `max_coverage_passes` | INTEGER | 2 | Max coverage verification passes |
| `max_iterations` | INTEGER | 5 | Max retry iterations per bead |
| `created_at` | TEXT | now() | ISO timestamp |
| `updated_at` | TEXT | now() | ISO timestamp |

---

## Table: app_meta

A generic key-value store for application-level metadata.

| Column | Type | Description |
|--------|------|-------------|
| `key` | TEXT PK | Unique metadata key |
| `value` | TEXT | Value (any string; typically JSON) |
| `updated_at` | TEXT | ISO timestamp |

---

## Table: attached_projects

Records which project folders are currently attached (visible) in LoopTroop.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment |
| `folder_path` | TEXT UNIQUE | Absolute path to project folder |
| `created_at` | TEXT | ISO timestamp |
| `updated_at` | TEXT | ISO timestamp |

---

## Table: projects

Full project records. Projects can override profile-level settings.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | INTEGER PK | auto | Project ID |
| `name` | TEXT | — | Display name |
| `shortname` | TEXT | — | Short identifier for branch naming and external IDs |
| `icon` | TEXT | `📁` | Emoji icon for display |
| `color` | TEXT | `#3b82f6` | Hex color for project accent |
| `folder_path` | TEXT | — | Absolute path to project root |
| `profile_id` | INTEGER | — | FK → `profiles.id` (resolved profile) |
| `council_members` | TEXT | — | JSON array; overrides profile if set |
| `max_iterations` | INTEGER | — | Overrides profile `max_iterations` if set |
| `per_iteration_timeout` | INTEGER | — | Overrides profile timeout if set |
| `execution_setup_timeout` | INTEGER | — | Overrides profile execution setup timeout if set |
| `council_response_timeout` | INTEGER | — | Overrides council response timeout if set |
| `min_council_quorum` | INTEGER | — | Overrides quorum requirement if set |
| `interview_questions` | INTEGER | — | Overrides max interview questions if set |
| `ticket_counter` | INTEGER | 0 | Auto-increment counter for ticket external IDs |
| `created_at` | TEXT | now() | ISO timestamp |
| `updated_at` | TEXT | now() | ISO timestamp |

---

## Table: tickets

The central work item table. One row per ticket. Stores the XState machine snapshot for persistence.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | INTEGER PK | auto | Internal ticket ID |
| `external_id` | TEXT UNIQUE | — | Human-readable ID: `<shortname>-<N>` (e.g. `PROJ-12`) |
| `project_id` | INTEGER | — | FK → `projects.id` |
| `title` | TEXT | — | Ticket title (1–200 chars) |
| `description` | TEXT | — | Full ticket description |
| `priority` | INTEGER | 3 | Priority: 1=urgent, 5=minimal |
| `status` | TEXT | `DRAFT` | Current XState machine status (mirrors machine state) |
| `xstate_snapshot` | TEXT | — | **JSON-serialized XState v5 snapshot** — see [XState Snapshot Persistence](#xstate-snapshot-persistence) |
| `branch_name` | TEXT | — | Git branch for this ticket's worktree |
| `current_bead` | INTEGER | — | Index of the current bead being executed |
| `total_beads` | INTEGER | — | Total bead count (populated after beads approval) |
| `percent_complete` | REAL | — | Execution progress 0–100 |
| `error_message` | TEXT | — | Last error message (populated when `BLOCKED_ERROR`) |
| `locked_main_implementer` | TEXT | — | Frozen main implementer model ID (set at ticket start) |
| `locked_main_implementer_variant` | TEXT | — | Frozen variant (set at ticket start) |
| `locked_council_members` | TEXT | — | JSON array — council frozen at start |
| `locked_council_member_variants` | TEXT | — | JSON map — variants frozen at start |
| `locked_interview_questions` | INTEGER | — | Frozen interview question limit |
| `locked_coverage_follow_up_budget_percent` | INTEGER | — | Frozen follow-up budget |
| `locked_max_coverage_passes` | INTEGER | — | Frozen max coverage passes |
| `started_at` | TEXT | — | ISO timestamp when ticket started |
| `planned_date` | TEXT | — | Optional planned date for kanban display |
| `created_at` | TEXT | now() | ISO timestamp |
| `updated_at` | TEXT | now() | ISO timestamp |

> **Note on locked_ columns:** All model configuration is **frozen at ticket start** via `lockTicketStartConfiguration()`. Changing the active profile mid-ticket does not affect in-flight tickets.

---

## Table: phase_artifacts

Stores all intermediate and final artifacts produced during ticket processing. Every generated document (interview YAML, PRD, beads plan, bead diffs, context wipe notes, etc.) is stored here.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | INTEGER PK | auto | Auto-increment |
| `ticket_id` | INTEGER | — | FK → `tickets.id` |
| `phase` | TEXT | — | Phase name (e.g. `COUNCIL_DELIBERATING`, `CODING`) |
| `phase_attempt` | INTEGER | 1 | Attempt number for this phase (increments on retry) |
| `artifact_type` | TEXT | — | Specific artifact type (e.g. `interview_draft`, `bead_diff:epic-1--story-2--bead-3`) |
| `content` | TEXT | — | **JSON-stringified artifact content** |
| `created_at` | TEXT | now() | ISO timestamp |
| `updated_at` | TEXT | now() | ISO timestamp |

Common `artifact_type` values:

| Artifact Type | Content Format | Phase |
|--------------|----------------|-------|
| `interview_compiled` | YAML string | Interview phases |
| `prd_structured` | JSON (PrdDocument) | PRD phases |
| `beads_structured` | JSON (Bead[]) | Beads phases |
| `bead_diff:<beadId>` | Git diff string | `CODING` |
| `execution_setup_plan` | YAML string | Execution setup phases |
| `codebase_map` | YAML string | `SCANNING_RELEVANT_FILES` |

---

## Table: ticket_phase_attempts

Tracks each attempt at a phase. When a user retries from `BLOCKED_ERROR`, the old phase attempt is archived and a fresh attempt is created.

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | INTEGER PK | auto | Auto-increment |
| `ticket_id` | INTEGER | — | FK → `tickets.id` |
| `phase` | TEXT | — | Phase name |
| `attempt_number` | INTEGER | — | Sequential attempt number (1-based) |
| `state` | TEXT | `active` | `active` or `archived` |
| `archived_reason` | TEXT | — | Why this attempt was archived (e.g. `retry`, `user_edit`) |
| `created_at` | TEXT | now() | ISO timestamp |
| `archived_at` | TEXT | — | ISO timestamp when archived |

---

## Table: opencode_sessions

Maps OpenCode session IDs to their ticket/phase/bead/iteration ownership. This enables the reconnect mechanism (when the server restarts, active sessions can be re-attached).

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | INTEGER PK | auto | Auto-increment |
| `session_id` | TEXT | — | OpenCode SDK session ID |
| `ticket_id` | INTEGER | — | FK → `tickets.id` |
| `phase` | TEXT | — | Phase that owns this session (e.g. `CODING`, `COUNCIL_DELIBERATING`) |
| `phase_attempt` | INTEGER | 1 | Which attempt number of this phase |
| `member_id` | TEXT | — | Council member model ID (nullable if not council) |
| `bead_id` | TEXT | — | Bead ID (nullable if not execution phase) |
| `iteration` | INTEGER | — | Bead iteration number (nullable if not execution phase) |
| `step` | TEXT | — | Optional sub-step when a phase owns multiple sessions |
| `state` | TEXT | `active` | `active` \| `completed` \| `abandoned` |
| `last_event_id` | TEXT | — | ID of the last SSE event received (for reconnect) |
| `last_event_at` | TEXT | — | Timestamp of last event |
| `created_at` | TEXT | now() | ISO timestamp |
| `updated_at` | TEXT | now() | ISO timestamp |

---

## Table: ticket_status_history

An **immutable audit log** of every status transition. Never updated — only inserted.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment |
| `ticket_id` | INTEGER | FK → `tickets.id` |
| `previous_status` | TEXT | State before transition (null if first transition) |
| `new_status` | TEXT | State after transition |
| `reason` | TEXT | Human-readable reason (e.g. `"User approved interview"`) |
| `changed_at` | TEXT | ISO timestamp |

---

## Table: ticket_error_occurrences

Records every time a ticket enters `BLOCKED_ERROR`, capturing the error details and tracking the resolution outcome.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment |
| `ticket_id` | INTEGER | FK → `tickets.id` |
| `occurrence_number` | INTEGER | Sequential error occurrence counter (1-based, per ticket) |
| `blocked_from_status` | TEXT | Which state the ticket was in when it errored |
| `error_message` | TEXT | Human-readable error message |
| `error_codes` | TEXT | JSON array of error codes (e.g. `["BEAD_RETRY_BUDGET_EXHAUSTED"]`) |
| `occurred_at` | TEXT | ISO timestamp when error occurred |
| `resolved_at` | TEXT | ISO timestamp when resolved (null if still blocked) |
| `resolution_status` | TEXT | `retried` \| `cancelled` \| `skipped` |
| `resumed_to_status` | TEXT | Status the ticket resumed from after resolution |

---

## Entity Relationships

```
profiles (1) ─────────────────────────── (many) projects
projects (1) ─────────────────────────── (many) tickets
tickets (1) ──────────────────────────── (many) phase_artifacts
tickets (1) ──────────────────────────── (many) ticket_phase_attempts
tickets (1) ──────────────────────────── (many) opencode_sessions
tickets (1) ──────────────────────────── (many) ticket_status_history
tickets (1) ──────────────────────────── (many) ticket_error_occurrences
```

---

## XState Snapshot Persistence

The `tickets.xstate_snapshot` column is the key to machine durability. After every state transition, the XState v5 machine's full snapshot is serialized and stored:

```typescript
// server/machines/persistence.ts
const snapshot = actor.getSnapshot()
const serialized = JSON.stringify(snapshot)
await patchTicket(ticketId, { xstateSnapshot: serialized })
```

On server restart, the machine is **restored from the snapshot** rather than starting fresh:

```typescript
// Restore from snapshot
const savedSnapshot = ticket.xstateSnapshot
if (savedSnapshot) {
  const restoredSnapshot = JSON.parse(savedSnapshot)
  const actor = createActor(ticketMachine, {
    snapshot: restoredSnapshot,
  })
  actor.start()
}
```

This means a ticket that was mid-way through `COUNCIL_DELIBERATING` when the server crashed will resume exactly from that state when the server restarts — it won't re-run work that was already completed.

The `tickets.status` column is a **denormalized convenience field** that mirrors the machine's current state name. It's used for list views and filtering without needing to deserialize the full XState snapshot.

→ See [State Machine](state-machine.md) for the full state diagram and all 30 states  
→ See [Setup Guide](setup-guide.md) for database migration commands
