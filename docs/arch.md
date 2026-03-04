# Architecture Overview

A deep dive into LoopTroop's system architecture, data flow, and design decisions.

---

## Table of Contents

- [System Diagram](#system-diagram)
- [Architecture Layers](#architecture-layers)
- [Dual-Authority Persistence](#dual-authority-persistence)
- [XState Actor Model](#xstate-actor-model)
- [Council Voting System](#council-voting-system)
- [Context Engineering](#context-engineering)
- [SSE Streaming Architecture](#sse-streaming-architecture)
- [Atomic I/O Pipeline](#atomic-io-pipeline)
- [OpenCode Integration](#opencode-integration)
- [Startup Sequence](#startup-sequence)
- [Security Model](#security-model)
- [Error Handling Architecture](#error-handling-architecture)

---

## System Diagram

```
┌─────────────────────────────────────────────────────────┐
│                      Browser                             │
│  React 19 + TanStack Query + SSE EventSource Client      │
├─────────────────────────────────────────────────────────┤
│                  Vite Dev Proxy (:5173)                   │
├─────────────────────────────────────────────────────────┤
│               Hono HTTP Server (:3000)                    │
│  ┌──────────────┬──────────────┬──────────────────────┐  │
│  │  REST API     │ SSE Stream   │ Workflow Actions      │  │
│  │  (CRUD)       │ (real-time)  │ (XState events)       │  │
│  └──────┬───────┴──────┬───────┴──────────┬──────────┘  │
│         │              │                  │               │
│  ┌──────┴──────┐ ┌─────┴──────┐ ┌────────┴──────────┐  │
│  │  SQLite DB  │ │    SSE     │ │   XState v5        │  │
│  │  (WAL mode) │ │ Broadcaster│ │   State Machine    │  │
│  │  Drizzle ORM│ │ + Buffer   │ │   (26 states)      │  │
│  └──────┬──────┘ └────────────┘ └────────┬──────────┘  │
│         │                                │               │
│  ┌──────┴──────────────────────────────────────────────┐ │
│  │              File System (.ticket/)                  │ │
│  │  YAML artifacts + JSONL beads + execution logs       │ │
│  │  Atomic writes: .tmp → fsync → rename                │ │
│  └──────────────────────────┬──────────────────────────┘ │
│                             │                             │
├─────────────────────────────┼─────────────────────────────┤
│                             ▼                             │
│  ┌──────────────────────────────────────────────────────┐ │
│  │          OpenCode Adapter (SDK Client)                │ │
│  │  Session management, health checks, streaming         │ │
│  └──────────────────────────┬───────────────────────────┘ │
└─────────────────────────────┼─────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────┐
│             OpenCode Server (:4096)                       │
│  Multi-model AI access + streaming + MCP tools            │
│  (Separate long-lived process — not embedded)             │
└─────────────────────────────────────────────────────────┘
```

---

## Architecture Layers

### Frontend Layer (React 19)
- **TanStack Query** for server state management with automatic cache invalidation
- **SSE EventSource** for real-time updates (state changes, logs, progress)
- **Tailwind CSS 4.2** + **shadcn/ui** for styling
- **localStorage** for UI state persistence (selected phase, panel sizes, etc.)
- All state changes flow: User Action → API Call → XState Event → SSE → React

### Backend Layer (Hono)
- **Hono HTTP server** handles REST API and SSE streaming
- **Zod validation** on all request bodies
- **Middleware** for request validation and error handling
- Routes are organized by domain: profiles, projects, tickets, files, beads, stream, health, models

### State Machine Layer (XState v5)
- Each ticket gets its own **XState v5 actor**
- 26 states with typed events and context
- Every transition triggers: `persistState` (SQLite) → `notifyFrontend` (SSE)
- Snapshot hydration from SQLite on startup

### Persistence Layer (SQLite + File System)
- **SQLite** (WAL mode) for structured data and state snapshots
- **File system** for artifacts (YAML, JSONL) with atomic I/O
- Dual-authority model: SQLite owns workflow state, issues.jsonl owns bead state

### AI Integration Layer (OpenCode SDK)
- **OpenCode adapter** wraps the SDK with session management
- **Context builder** enforces phase-specific allowlists
- **Token budgeting** prevents context overflow
- **Health checking** validates OpenCode availability

---

## Dual-Authority Persistence

LoopTroop splits data authority between two stores to prevent conflicts:

### SQLite (Authoritative for Workflow)

| What's Stored | Why SQLite |
|--------------|------------|
| Ticket status, XState snapshot | Fast indexed queries, transactional |
| Profile configuration | Structured CRUD |
| Project metadata | Relational (project → tickets) |
| OpenCode session metadata | Quick lookup for reconnection |

### issues.jsonl (Authoritative for Beads)

| What's Stored | Why JSONL |
|--------------|-----------|
| Bead graph (dependencies) | Atomic append-only format |
| Bead status (pending/in_progress/done/error) | Git-friendly, diffable |
| Bead notes (error history) | Append-only growth pattern |
| Bead checkpoints (start commit SHA) | Tied to file system state |

### Non-Authoritative Stores

| Store | Purpose | Can Be Rebuilt? |
|-------|---------|----------------|
| `.ticket/runtime/state.yaml` | Projection cache for SSE fan-out | ✅ From SQLite |
| `.ticket/runtime/execution-log.jsonl` | Audit/debug evidence | ❌ Append-only log |

### Critical Rule
- **Never** write workflow state from YAML artifacts into SQLite
- **Never** overwrite issues.jsonl bead data from SQLite/index projections

---

## XState Actor Model

### Machine Structure
- **26 states**: 25 numbered (01-25) + BLOCKED_ERROR
- **Typed events**: START, CANCEL, RETRY, APPROVE, ANSWER_SUBMITTED, etc.
- **Context**: ticketId, projectId, beadProgress, error, previousStatus, etc.

### State Transitions Flow

```
DRAFT → COUNCIL_DELIBERATING → COUNCIL_VOTING_INTERVIEW → COMPILING_INTERVIEW
    → WAITING_INTERVIEW_ANSWERS ↔ VERIFYING_INTERVIEW_COVERAGE
    → WAITING_INTERVIEW_APPROVAL → DRAFTING_PRD → COUNCIL_VOTING_PRD
    → REFINING_PRD ↔ VERIFYING_PRD_COVERAGE → WAITING_PRD_APPROVAL
    → DRAFTING_BEADS → COUNCIL_VOTING_BEADS → REFINING_BEADS
    ↔ VERIFYING_BEADS_COVERAGE → WAITING_BEADS_APPROVAL
    → PRE_FLIGHT_CHECK → CODING → RUNNING_FINAL_TEST
    → INTEGRATING_CHANGES → WAITING_MANUAL_VERIFICATION
    → CLEANING_ENV → COMPLETED
```

### Persistence on Transition

Every state transition triggers:
1. **persistState** — Save XState snapshot to SQLite (authoritative, first)
2. **persistBeadsTracker** — Write bead tracker updates to issues.jsonl (when bead data changes)
3. **notifyFrontend** — Emit SSE event (after authoritative persists complete)

### Error Handling

Any state can transition to `BLOCKED_ERROR` on failure. From `BLOCKED_ERROR`:
- **RETRY** → Returns to the `previousStatus` (stored in context)
- **CANCEL** → Moves to CANCELED (terminal)

---

## Council Voting System

### Pipeline: Draft → Vote → Refine → Coverage

Each planning phase (Interview, PRD, Beads) uses this pipeline:

1. **Draft**: Each council member generates a draft in parallel (fresh session each)
2. **Vote**: Each member scores all drafts with a phase-specific rubric (5×20=100)
3. **Refine**: Winning draft refined by incorporating ideas from losing drafts
4. **Coverage**: QA verification against source material; loops back if gaps found

### Phase-Specific Rubrics

| Phase | Rubric Categories |
|-------|-------------------|
| Interview (PROM2) | Completeness, Depth, Clarity, Priority ordering, Feasibility focus |
| PRD (PROM11) | Completeness, Technical depth, Actionability, Consistency, Risk coverage |
| Beads (PROM21) | Granularity, Dependency correctness, Test coverage, Estimation accuracy, Context guidance |

### Anti-Anchoring
- Drafts presented in **randomized order per voter**
- Drafts are **anonymized** (no model identification)
- Fresh session per voter (no memory of drafting)

---

## Context Engineering

### The `buildMinimalContext()` Function

All AI prompts are assembled by `buildMinimalContext(phase, ticketState, activeItem?)`:

1. **Phase allowlist lookup** — Only approved context sources are included
2. **Source assembly** — Load required artifacts from file system
3. **Token budgeting** — Trim in fixed priority order if budget exceeded
4. **Caching** — Reuse immutable context slices across calls

### 18 Phase Allowlists

Each phase has a strict allowlist defining what context it can access. This is the core mechanism that prevents context rot.

Examples:
- `interview_draft` → ticket description + codebase map (nothing else)
- `prd_draft` → interview results + codebase map (no ticket description)
- `bead_execution` → codebase map + PRD section + bead spec + notes (minimal)

### Key Principle

> No ad-hoc prompt assembly allowed. Every AI call goes through `buildMinimalContext()`.

---

## SSE Streaming Architecture

### Two-Tier Streaming

```
High-frequency (token-by-token):
  OpenCode Stream → streamBypass → SSE Broadcaster → Browser
  (bypasses XState/SQLite for performance)

Checkpoints (state changes):
  XState Transition → persistState → SQLite → SSE Broadcaster → Browser
  (goes through full persistence pipeline)
```

### Event Types

| Event | Frequency | Description |
|-------|-----------|-------------|
| `state_change` | Low | XState state transition |
| `log` | High | AI output streaming (thinking, code) |
| `progress` | Medium | Bead execution progress (bead N/M) |
| `error` | Low | Error notification |
| `bead_complete` | Low | Bead finished successfully |
| `needs_input` | Low | User input required |
| `heartbeat` | Fixed (30s) | Keep-alive ping |

### Reconnection

- Client sends `Last-Event-ID` header on reconnect
- Broadcaster replays missed events from its in-memory buffer
- If gap too large: sends full state refresh instead

---

## Atomic I/O Pipeline

### Write Pipeline

```
1. Generate content in memory
2. Write to .tmp file
3. fsync() to flush to disk
4. rename() .tmp → final (atomic operation)
```

### JSONL Handling

- **Read**: Skip malformed lines (log warning to stderr)
- **Append**: Write new line + fsync
- **Recovery**: Truncate corrupt trailing line on startup

### Startup Recovery

1. Promote orphan `.tmp` files (complete writes that missed rename)
2. Truncate corrupt JSONL trailing lines (writes interrupted mid-append)
3. Validate JSONL line integrity

---

## OpenCode Integration

### Architecture
- OpenCode runs as **separate long-lived process** on port 4096
- LoopTroop connects via `@opencode-ai/sdk` (client library)
- LoopTroop is a **client**, never embedded

### Why This Architecture

| Requirement | How OpenCode Satisfies It |
|-------------|--------------------------|
| 24+ hour execution | OpenCode server survives LoopTroop restart |
| Real-time logs | SDK supports SSE streaming |
| Multi-model council | Send same prompt to multiple models |
| Resume after crash | Reattach sessions or create fresh ones |
| Context isolation | Each phase gets a fresh session |

### Session Lifecycle

1. **Create**: Fresh session per council member per phase step
2. **Stream**: Token-by-token output via SSE → streamBypass
3. **Complete**: Collect response, validate output
4. **Cleanup**: Session data retained for reconnection only

### Health Checks

- Checked on startup (non-blocking — warning if unavailable)
- Re-checked before any ticket START action
- Status available via `GET /api/health/opencode`

---

## Startup Sequence

```
1. Initialize SQLite → WAL pragmas → checkpoint timer
2. Run file I/O recovery → promote .tmp, truncate corrupt lines
3. Create database indexes
4. Check OpenCode availability (non-blocking)
5. Hydrate XState actors from SQLite snapshots
6. Reconnect OpenCode sessions (validate ownership)
7. Start Hono HTTP server → register routes → start SSE
8. Ready → log startup message
```

---

## Security Model

### MVP Stance
- Runs with `--yolo` mode (AI agent has full file access in project folder)
- **Runner scope restriction**: AI operations are restricted to the ticket worktree
- Isolation via VM/container is recommended

### Security Boundaries
| Component | Access |
|-----------|--------|
| AI agent | Full read/write within ticket worktree only |
| Hono server | Local only (no external exposure) |
| SQLite | Local file, no network exposure |
| OpenCode | Localhost connection only |

---

## Error Handling Architecture

### Error Types and Responses

| Error Type | Detection | Response | Recovery |
|-----------|-----------|----------|----------|
| Doctor critical | Pre-flight check fail | BLOCKED_ERROR + codes | User fixes, retries |
| Council timeout | Member doesn't respond | Check quorum | Retry with fresh session |
| Bead max iterations | Tests keep failing | BLOCKED_ERROR | User edits bead, retries |
| OpenCode disconnect | Health check failure | BLOCKED_ERROR | Restart OpenCode, retry |
| SQLite failure | Write error | Circuit breaker | Auto-recover after cooldown |
| File I/O failure | Atomic write error | Circuit breaker | Auto-recover after cooldown |

### Circuit Breaker
- Trips after **3 consecutive failures** of the same type
- **30-second cooldown** before allowing retry
- Half-open state: one test operation allowed to verify recovery
