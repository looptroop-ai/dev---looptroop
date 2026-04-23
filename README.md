# LoopTroop

> Slow, deliberate, and durable AI feature delivery for real repositories.

LoopTroop is a local orchestration app for repo-sized coding work. It attaches to a GitHub-backed project, plans through an interview, a PRD, and an execution bead plan, then executes the work inside isolated worktrees with fresh OpenCode sessions, explicit recovery paths, and human approval gates.

`docs/system-architecture.md` is the canonical reference for the current system.

## Why LoopTroop Exists

LoopTroop is built around four constraints:

| Constraint | What breaks in naive agent loops | LoopTroop response |
| --- | --- | --- |
| Long-context degradation | Important details get buried or compacted away | Strict phase-specific context assembly and fresh sessions |
| Weak single-shot planning | A single draft misses tradeoffs and edge cases | Multi-model council: draft, vote, refine |
| Infinite repair loops | The same broken attempt keeps retrying in polluted context | Bounded Ralph-style retry with context wipe notes |
| Hidden runtime state | Work becomes hard to inspect, recover, or review | Durable artifacts in SQLite, JSONL logs, and `.ticket/**` |

See [Core Philosophy](docs/core-philosophy.md), [Context Isolation](docs/context-isolation.md), and [Execution Loop](docs/execution-loop.md).

## Workflow Snapshot

```mermaid
flowchart LR
    A[Draft Ticket] --> B[Scan Relevant Files]
    B --> C[Interview Council]
    C --> D[Interview Approval]
    D --> E[PRD Council]
    E --> F[PRD Approval]
    F --> G[Beads Council]
    G --> H[Beads Approval]
    H --> I[Execution Setup]
    I --> J[Bead-by-Bead Coding]
    J --> K[Final Test]
    K --> L[PR Delivery]
    L --> M[Completed or Review Follow-up]
```

The current phase list, UI groupings, and review behavior are documented in [State Machine](docs/state-machine.md).

## Canonical Docs

| Document | What it covers |
| --- | --- |
| [System Architecture](docs/system-architecture.md) | Current runtime architecture, storage ownership, lifecycle, diagrams |
| [Core Philosophy](docs/core-philosophy.md) | Design principles behind context control, council flow, retries, approvals |
| [Context Isolation](docs/context-isolation.md) | Per-phase context allowlists, token budget, trimming, cache behavior |
| [LLM Council](docs/llm-council.md) | Draft, vote, refine orchestration across interview, PRD, and beads |
| [Execution Loop](docs/execution-loop.md) | Bead execution, retry discipline, context wipe notes, recovery |
| [Beads](docs/beads.md) | Bead model, storage, scheduler behavior, execution semantics |
| [State Machine](docs/state-machine.md) | The current workflow phases and transition model |
| [Database Schema](docs/database-schema.md) | App DB, project DB, tables, and ownership boundaries |
| [API Reference](docs/api-reference.md) | HTTP routes, SSE events, and example payloads |
| [Frontend](docs/frontend.md) | Workspace composition, hooks, live updates, review surfaces |
| [OpenCode Integration](docs/opencode-integration.md) | Adapter, session manager, reconnect behavior, streaming |
| [Setup Guide](docs/setup-guide.md) | Local setup, ports, env vars, and developer commands |

## Quick Start

1. Install dependencies.

```bash
npm install
```

2. Make sure an OpenCode server is reachable.

```bash
opencode serve
```

By default LoopTroop expects OpenCode at `http://127.0.0.1:4096`. Override that with `LOOPTROOP_OPENCODE_BASE_URL` if needed.

3. Start LoopTroop.

```bash
npm run dev
```

The default local ports are:

| Service | Default |
| --- | --- |
| Frontend | `http://localhost:5173` |
| Backend API | `http://localhost:3000` |
| OpenCode | `http://127.0.0.1:4096` |

## Repository Shape

```text
src/        React application, workspace UI, hooks
server/     Hono API, workflow phases, persistence, OpenCode adapter
shared/     Phase metadata, shared types, app config
docs/       Canonical documentation for the current system
```

For the detailed runtime breakdown, start with [System Architecture](docs/system-architecture.md).
