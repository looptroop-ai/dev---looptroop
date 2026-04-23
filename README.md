# LoopTroop

> Durable repo-scale AI delivery through council planning, isolated worktrees, and explicit approvals.

> [!TIP]
> **New to LoopTroop?** Start with the [Docs Home](docs/index.md), then read the [Getting Started Guide](docs/getting-started.md) and [FAQ](docs/faq.md).

LoopTroop is a local orchestration app for repository-sized coding work. It attaches to a GitHub-backed project, drives the ticket through interview, PRD, and beads planning, then executes the approved plan inside isolated worktrees with fresh OpenCode sessions, explicit recovery paths, and human approval gates.

`docs/system-architecture.md` is the canonical reference for the current runtime.

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
    A[Draft Ticket] --> B[Relevant File Scan]
    B --> C[Interview Council]
    C --> D[PRD Council]
    D --> E[Beads Council]
    E --> F[Workspace Setup Approval]
    F --> G[Bead-by-Bead Coding]
    G --> H[PR Review and Finish]
```

For the full status lifecycle, approval gates, and recovery rules, see [Ticket Flow](docs/ticket-flow.md) and [State Machine](docs/state-machine.md).

## Documentation

| Document | What it covers |
| --- | --- |
| [Docs Home](docs/index.md) | Cross-doc navigation hub and recommended reading paths |
| [System Architecture](docs/system-architecture.md) | Current runtime architecture, storage ownership, lifecycle, diagrams |
| [Ticket Flow](docs/ticket-flow.md) | End-to-end status lifecycle, approval gates, retries, delivery outcomes |
| [State Machine](docs/state-machine.md) | Canonical phase inventory and transition model |
| [Core Philosophy](docs/core-philosophy.md) | Design principles behind context control, council flow, retries, approvals |
| [Context Isolation](docs/context-isolation.md) | Per-phase context allowlists, token budget, trimming, cache behavior |
| [LLM Council](docs/llm-council.md) | Draft, vote, refine orchestration across interview, PRD, and beads |
| [Execution Loop](docs/execution-loop.md) | Bead execution, retry discipline, context wipe notes, recovery |
| [Beads](docs/beads.md) | Bead model, storage, scheduler behavior, execution semantics |
| [Database Schema](docs/database-schema.md) | App DB, project DB, tables, and ownership boundaries |
| [API Reference](docs/api-reference.md) | HTTP routes, SSE events, and example payloads |
| [Frontend](docs/frontend.md) | Workspace composition, hooks, live updates, review surfaces |
| [OpenCode Integration](docs/opencode-integration.md) | Adapter, session manager, reconnect behavior, streaming |
| [Roadmap](docs/roadmap.md) | Current priorities and future directions |
| [FAQ](docs/faq.md) | Frequently asked questions about terms, workflow, safety, and artifacts |

## Getting Started

Install dependencies:

```bash
npm install
```

Then start the app:

```bash
npm run dev
```

For the full setup flow, environment variables, and OpenCode expectations, read the [Getting Started Guide](docs/getting-started.md).

For the runtime module layout after the removed repository-shape snapshot, see [Docs Home](docs/index.md) and the [System Architecture module map](docs/system-architecture.md#module-map).
