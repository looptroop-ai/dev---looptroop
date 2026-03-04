# Crash Recovery

A detailed explanation of LoopTroop's persistence model and crash recovery mechanisms.

---

## Table of Contents

- [Overview](#overview)
- [Dual-Authority Persistence](#dual-authority-persistence)
- [SQLite Configuration](#sqlite-configuration)
- [Atomic I/O Pipeline](#atomic-io-pipeline)
- [XState Snapshot Hydration](#xstate-snapshot-hydration)
- [OpenCode Session Reconnection](#opencode-session-reconnection)
- [SSE Reconnection](#sse-reconnection)
- [Startup Recovery Sequence](#startup-recovery-sequence)
- [Circuit Breaker](#circuit-breaker)
- [Recovery Scenarios](#recovery-scenarios)
- [How to Demo Crash Recovery](#how-to-demo-crash-recovery)

---

## Overview

LoopTroop is designed for unattended operation lasting hours or even 10+ hours. The system must survive:

- **Process crashes** (segfaults, OOM kills)
- **Manual kills** (Ctrl+C, kill signal)
- **Power failures** (VM shutdown, host crash)
- **Network interruptions** (AI provider outage, client disconnect)

The key insight: **state is always recoverable from two authoritative sources** (SQLite + issues.jsonl), and all other data is either derived or can be regenerated.

---

## Dual-Authority Persistence

LoopTroop uses two authoritative data stores:

| Store | Authority Over | Format | Written By |
|-------|---------------|--------|-----------|
| **SQLite** (WAL mode) | Workflow/ticket runtime state, XState snapshots, session metadata | Drizzle ORM | State machine actions, route handlers |
| **issues.jsonl** | Bead tracker data: graph, status, dependencies, notes, checkpoints | JSONL (one JSON object per line) | Beads phase, execution loop |

### Non-Authoritative Derived Stores

| Store | Purpose | Rebuildable From |
|-------|---------|-----------------|
| `.ticket/runtime/state.yaml` | Projection cache for UI/SSE | SQLite → state.yaml → SSE |
| `.ticket/runtime/execution-log.jsonl` | Audit/debug log | Not recoverable (append-only evidence) |

### Recovery Rule
- **SQLite is authoritative for workflow state** — never write workflow state from YAML artifacts
- **issues.jsonl is authoritative for bead data** — never overwrite bead state from SQLite

---

## SQLite Configuration

SQLite is configured for maximum durability and concurrent access:

```sql
PRAGMA journal_mode = WAL;          -- Write-Ahead Logging for concurrent reads
PRAGMA locking_mode = NORMAL;       -- Allow other connections
PRAGMA synchronous = NORMAL;        -- Durability balanced with performance
PRAGMA busy_timeout = 5000;         -- Wait 5s if locked
PRAGMA wal_autocheckpoint = 1000;   -- Auto-checkpoint every 1000 pages
```

### WAL (Write-Ahead Logging)

WAL mode provides crash-safe writes:
1. Changes are written to the WAL file (not the main database)
2. A checkpoint merges WAL changes into the main database
3. If a crash occurs mid-write, the WAL journal ensures consistency
4. Readers don't block writers, and writers don't block readers

### WAL Checkpoint Timer

A background timer runs `PRAGMA wal_checkpoint(PASSIVE)` every 30 seconds to prevent the WAL file from growing unbounded.

### Database Schema

```
Tables:
├── profiles         # User configuration (global defaults)
├── projects         # Project records (name, path, settings)
├── tickets          # Ticket records + XState snapshots
└── opencode_sessions # OpenCode session metadata
```

---

## Atomic I/O Pipeline

All file writes use atomic operations to prevent corruption:

### Write Pipeline

```
1. Write to temporary file (.tmp suffix)
2. Call fsync() to flush to disk
3. Rename .tmp → final filename (atomic operation)
```

If a crash occurs:
- **Before fsync**: `.tmp` file may be incomplete → discarded on startup
- **After fsync, before rename**: `.tmp` file is complete → promoted on startup
- **After rename**: Write is complete and durable

### JSONL Handling

For JSONL files (issues.jsonl, execution-log.jsonl):
- **Read**: Malformed lines are **skipped** (logged to stderr)
- **Append**: New lines are written with fsync
- **Recovery**: Corrupt trailing line is **truncated** (happens when crash occurs mid-append)

### Startup Recovery Steps

1. **Promote orphan `.tmp` files** — If a complete `.tmp` exists without a corresponding final file, it's promoted
2. **Truncate corrupt trailing lines** — If the last line of a JSONL file is incomplete, it's removed
3. **Validate JSONL integrity** — Each remaining line is verified as valid JSON

---

## XState Snapshot Hydration

Each ticket has an XState v5 actor. The machine state is persisted to SQLite on every transition:

### Persistence (on state change)

```
XState transition → persistState action → Save snapshot to SQLite tickets.xstate_snapshot
```

The snapshot includes:
- Current state name
- Full context (ticketId, projectId, beadProgress, error, etc.)
- Previous state (for RETRY navigation)

### Hydration (on startup)

```
1. Query all tickets with non-terminal states (not COMPLETED or CANCELED)
2. For each ticket:
   a. Load xstate_snapshot from the tickets table
   b. Create XState actor with restored context
   c. Load active issues.jsonl as authoritative bead state
   d. Resume any interrupted actors
3. Terminal tickets are NOT hydrated (they're complete)
```

### What This Means

- A ticket in `CODING` state at crash will resume from `CODING` on restart
- The current bead will be re-attempted from the start (fresh context wipe)
- Completed beads are preserved (their status in issues.jsonl is authoritative)

---

## OpenCode Session Reconnection

### On Startup

For each non-terminal ticket:

```
1. Query active session metadata from opencode_sessions table
2. Validate session:
   a. Does the stored session still exist in OpenCode?
   b. Does ownership match the active run/phase/attempt?
3. If valid:
   → Call SDK session.messages() + event.subscribe()
   → Apply to XState context
4. If invalid or missing:
   → Create a replacement fresh session
   → Continue from artifacts (not session history)
```

### Knowledge Transfer

Knowledge is transferred between attempts via **structured artifacts**, not session history:
- Interview results → interview.yaml
- PRD → prd.yaml
- Bead specifications → issues.jsonl
- Error notes → bead `notes` field (append-only)

This means a crash never loses critical knowledge — it's always in the files.

---

## SSE Reconnection

### Client-Side

- Client auto-reconnects after **3 seconds** of disconnect
- Sends `Last-Event-ID` header with the last received event ID
- Server replays missed events from the broadcaster's buffer

### Server-Side

- Broadcaster maintains an **in-memory event buffer** (bounded size)
- On reconnection: checks `Last-Event-ID` and replays events since that ID
- If the gap is too large (events expired from buffer): sends a full state refresh

### During Disconnect

- Backend **continues processing** during client disconnect
- All state changes are persisted to SQLite (authoritative)
- SSE events are buffered for replay on reconnect
- No data is lost — the client catches up on reconnect

---

## Startup Recovery Sequence

The complete startup sequence with recovery:

```
1. Initialize SQLite database
   ├─ Apply pragmas (WAL, busy_timeout=5000, etc.)
   ├─ Verify effective values
   └─ Start WAL checkpoint timer (30s intervals)

2. Run file I/O recovery
   ├─ Promote orphan .tmp files
   └─ Truncate corrupt JSONL trailing lines

3. Create database indexes

4. Check OpenCode availability
   ├─ Try connect to localhost:4096
   ├─ If fails: log warning (startup proceeds)
   └─ Store connection status (re-checked before ticket START)

5. Hydrate XState machines
   ├─ Query non-terminal tickets from SQLite
   ├─ Load xstate_snapshot for each
   ├─ Create actors with restored context
   ├─ Load issues.jsonl per active flow
   └─ Resume interrupted actors

6. Reconnect OpenCode sessions
   ├─ Query active sessions from opencode_sessions table
   ├─ Validate ownership against active run/phase/attempt
   ├─ Reattach valid sessions
   └─ Create fresh sessions for invalid/missing

7. Start Hono HTTP server
   ├─ Register all API routes
   ├─ Start SSE broadcast channel
   └─ Listen on configured port

8. Ready
   └─ Log: "LoopTroop running"
```

---

## Circuit Breaker

LoopTroop includes a circuit breaker to prevent cascading failures:

### Behavior

- **Closed** (normal) — Operations proceed normally
- **Open** (tripped) — After 3 consecutive failures, all operations are rejected for a cooldown period
- **Half-open** (recovering) — After cooldown, one test operation is allowed; if it succeeds, the breaker closes

### Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| Failure threshold | 3 | Consecutive failures before tripping |
| Cooldown period | 30s | Time before attempting recovery |

### What Trips the Breaker

- Consecutive SQLite write failures
- Consecutive OpenCode connection failures
- Consecutive file I/O failures

---

## Recovery Scenarios

### Scenario 1: Server Crash During Council Voting

**State at crash:** `COUNCIL_VOTING_PRD` with 2/3 votes collected

**On restart:**
1. Ticket hydrated from SQLite in `COUNCIL_VOTING_PRD` state
2. The voting phase **restarts from scratch** (fresh sessions for all voters)
3. All drafts are still available (persisted before voting started)
4. No data loss — the refined draft from drafting phase is preserved

### Scenario 2: Server Crash During Bead Execution

**State at crash:** `CODING`, bead 7/34, iteration 2

**On restart:**
1. Ticket hydrated in `CODING` state
2. issues.jsonl shows beads 1-6 as `done`, bead 7 as `in_progress`
3. Bead 7 gets a **fresh session and fresh context wipe**
4. Previous attempt notes are available in the `notes` field
5. Execution continues from bead 7

### Scenario 3: Power Failure During File Write

**State at crash:** Mid-write to interview.yaml

**On restart:**
1. Atomic I/O recovery runs
2. If `.tmp` file is complete (was fsynced): promoted to final file
3. If `.tmp` file is incomplete: discarded, original file preserved
4. No corruption possible

### Scenario 4: Client Browser Crash

**Effect:** None on the backend

1. Backend continues processing normally
2. SSE events are buffered
3. When client reconnects (auto-reconnect after 3s):
   - Sends `Last-Event-ID` header
   - Server replays missed events
   - UI catches up to current state

---

## How to Demo Crash Recovery

```bash
# Terminal 1: Start LoopTroop
npm run dev

# In the browser:
# 1. Create a profile, project, and ticket
# 2. Start the ticket
# 3. Let it progress past the interview council phase

# Terminal 1: Kill the server
# Press Ctrl+C or: kill $(pgrep -f "tsx watch server/index.ts")

# Terminal 1: Restart
npm run dev

# In the browser:
# 4. Refresh the page
# 5. The ticket should be in exactly the same state as before the kill
# 6. SSE connection re-establishes automatically
# 7. Processing resumes from where it left off
```

### Programmatic Testing

```bash
# Run integration tests that verify crash recovery
npm run test -- --grep "recovers from crash"

# This test:
# 1. Creates a ticket and advances it to CODING state
# 2. Simulates a crash (tears down the actor)
# 3. Runs recovery (hydrateAllTickets)
# 4. Verifies the ticket resumes correctly
```
