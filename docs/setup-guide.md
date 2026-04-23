# Setup Guide

Everything you need to get LoopTroop running locally.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Installation](#installation)
3. [Running in Development](#running-in-development)
4. [Environment Variables](#environment-variables)
5. [Database Commands](#database-commands)
6. [Testing](#testing)
7. [File System Structure](#file-system-structure)
8. [Diagnostics](#diagnostics)

---

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| **Node.js** | ≥ 18 | LTS recommended |
| **npm** | ≥ 9 | Ships with Node 18+ |
| **Git** | Any modern version | Must be on `PATH` |
| **OpenCode** | Latest | Must be running before starting the backend |

OpenCode must be installed and running as a local server before LoopTroop's backend can function. See [opencode.ai](https://opencode.ai) for installation instructions.

> **Mock mode:** If you want to run LoopTroop without OpenCode for UI development or testing, set `LOOPTROOP_OPENCODE_MODE=mock`. See [OpenCode Integration — Mock Mode](opencode-integration.md#mock-mode).

---

## Installation

```bash
# Clone the repository
git clone <repo-url>
cd LoopTroop

# Install all dependencies
npm install
```

---

## Running in Development

### Full stack (recommended)

```bash
npm run dev
```

This is the primary development command. It automatically:
1. **Runs dev-preflight** — kills any stale LoopTroop dev processes and reclaims occupied ports (SIGTERM → wait 300ms → SIGKILL if needed)
2. **Starts frontend** — Vite dev server at `http://localhost:5173` (or next available port)
3. **Starts backend** — `tsx watch` hot-reload server at `http://localhost:3001` (or configured port)

The preflight guard prevents port conflicts from forgotten dev sessions without requiring manual `kill` commands.

### App only (no preflight)

```bash
npm run dev:app
```

Runs frontend + backend concurrently without the preflight guard. Use when you know no stale processes exist.

### Frontend only

```bash
npm run dev:frontend
```

Runs only the Vite dev server. Useful when the backend is running separately (e.g., in a debugger).

### Backend only

```bash
npm run dev:backend
```

Runs only the Hono backend with `tsx watch` hot-reload. Uses `CHOKIDAR_USEPOLLING=1` for file system compatibility.

### OpenCode companion

```bash
npm run dev:opencode
```

Starts OpenCode in the project directory. Run this in a separate terminal alongside `dev:backend` or `dev:app`.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LOOPTROOP_OPENCODE_MODE` | `real` | Set to `mock` to use the mock OpenCode adapter |
| `LOOPTROOP_BACKEND_PORT` | `3001` | Port for the Hono backend server |
| `LOOPTROOP_FRONTEND_PORT` | `5173` | Port for the Vite dev server |
| `LOOPTROOP_DEV_VERBOSE` | `0` | Set to `1` for verbose dev-preflight logging |
| `LOOPTROOP_OPENCODE_URL` | auto-detected | Override the OpenCode base URL |

Port values are resolved via `shared/appConfig.ts` which reads these env vars with the documented defaults.

---

## Database Commands

LoopTroop uses **Drizzle ORM** with **Drizzle Kit** for schema management.

### Generate migrations

```bash
npm run db:generate
```

Generates new SQL migration files in `drizzle/` when you change `server/db/schema.ts`. Run this after modifying the schema.

### Push schema to database

```bash
npm run db:push
```

Applies the current schema directly to the database without generating migration files. Used in development for rapid iteration.

> **Note:** Each project has its own `<project-folder>/.looptroop/db.sqlite`. The `db:push` command will apply the schema to whatever database is configured in `drizzle.config.ts`.

---

## Testing

### Run all tests

```bash
npm test
# or
npm run test
```

Runs all Vitest test suites in one pass.

### Run client tests only

```bash
npm run test:client
```

Runs the `client-dom` and `client-node` Vitest projects (React component tests + client-side utility tests).

### Run server tests only

```bash
npm run test:server
```

Runs the `server-pure` and `server-integration` Vitest projects (pure logic tests + integration tests with SQLite).

### Watch mode

```bash
npm run test:watch
```

Vitest in interactive watch mode — re-runs affected tests on file save.

### Type checking (no emit)

```bash
npm run typecheck
```

Runs `tsc --noEmit` across the entire codebase.

### Linting

```bash
npm run lint
```

Runs ESLint with `typescript-eslint` across all source files.

---

## File System Structure

LoopTroop creates files in a `.looptroop/` directory at the root of each attached project. These files are expected to be gitignored in your project.

```
<your-project>/
├── .looptroop/
│   ├── db.sqlite                  ← Per-project SQLite database
│   └── worktrees/
│       └── <ticket-id>/           ← Git worktree for this ticket
│           └── .ticket/
│               ├── beads/
│               │   └── main/
│               │       └── .beads/
│               │           └── issues.jsonl   ← Bead tracker (append-only)
│               ├── runtime/       ← Gitignored: active session churn
│               │   ├── locks/
│               │   ├── streams/
│               │   └── sessions/
│               └── tmp/           ← Gitignored: temp files
```

### Gitignore recommendation

Add the following to your project's `.gitignore`:

```gitignore
# LoopTroop
.looptroop/
```

The bead tracker (`issues.jsonl`) lives inside the worktree and is committed to the ticket branch as part of the planning artifacts. The `.looptroop/` directory itself (database, worktree metadata) should not be committed.

---

## Diagnostics

### Diagnose a stalled runtime

```bash
npm run diagnose:stall
```

Runs `scripts/diagnose-runtime-stall.ts` which:
- Inspects all active OpenCode sessions for the project
- Reports which sessions are alive vs stalled
- Shows last event timestamps per session
- Suggests remediation commands

Use this when a ticket appears stuck (CODING state, no progress in the UI) to understand whether the OpenCode session is still alive or has silently died.

### Verbose dev-preflight logging

```bash
LOOPTROOP_DEV_VERBOSE=1 npm run dev
```

Enables detailed logging from the dev-preflight script, including the full process tree being terminated on each startup.

### Manual database inspection

```bash
# Open the SQLite database directly (requires sqlite3 CLI)
sqlite3 <your-project>/.looptroop/db.sqlite

# List all tickets
sqlite3 <your-project>/.looptroop/db.sqlite "SELECT external_id, title, status FROM tickets;"

# Check active OpenCode sessions
sqlite3 <your-project>/.looptroop/db.sqlite "SELECT session_id, phase, bead_id, iteration, state FROM opencode_sessions WHERE state='active';"
```

→ See [OpenCode Integration](opencode-integration.md) for how to configure and run OpenCode  
→ See [Database Schema](database-schema.md) for the full schema reference
