# LoopTroop

> **LLM councils plan it. Ralph loops recover it. OpenCode worktrees ship it.**

> [!TIP]
> **New to LoopTroop?** Start with the [Docs Home](docs/index.md), then read the [Getting Started Guide](docs/getting-started.md) and [FAQ](docs/faq.md).

LoopTroop is a local AI coding orchestration control plane for repo-scale work.
It turns a GitHub-backed task into an interview, PRD, bead plan, isolated worktree execution, and human-approved PR.

Its coding agent workflow combines LLM orchestration, agent orchestration, multi-agent orchestration, OpenCode orchestration, durable agent artifacts, and human-in-the-loop PR automation without moving work out of your local checkout.

Instead of one long, fragile agent loop, LoopTroop uses:

- **LLM Council planning** - multiple models draft, vote, refine, and verify plans.
- **Ralph-loop recovery** - bounded fresh-context retries with preserved failure notes.
- **OpenCode execution** - implementation runs in fresh OpenCode sessions.
- **Worktree isolation** - each execution happens away from your main checkout in isolated git worktrees.
- **Human approval gates** - you approve interview, PRD, bead plan, workspace setup, draft PR review, and delivery.

`docs/system-architecture.md` is the canonical reference for the current runtime.

## Why Not Just Run a Coding Agent?

Single-agent coding loops usually fail in four ways:

| Failure mode | What happens | LoopTroop response |
| --- | --- | --- |
| Context rot | The model loses important details in a long thread | Phase-specific context assembly and fresh sessions |
| Weak planning | One draft misses edge cases | LLM Council and multi-model council flow: draft, vote, refine, verify |
| Infinite repair | The agent retries inside polluted context | Ralph-loop recovery with bounded attempts and fresh-context retry |
| Hidden state | Nobody can inspect what happened | SQLite state, JSONL logs, and `.ticket/**` artifacts |

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

The comprehensive documentation lives in [Docs Home](docs/index.md). When the app is running, you can also open the same docs from the top-right `Docs` button in the main dashboard.

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

That starts the dashboard and the docs site together. Before the watchers launch, the dev preflight now:

- upgrades the local `opencode` CLI to the latest available version when it is installed
- syncs direct dependencies to the latest stable npm releases
- runs `npm audit fix` without `--force`
- prints a concise audit summary, including known stable-upstream leftovers
- prints a startup plan that lists each dev service command and its purpose before the live logs begin

The slower maintenance work is daily-gated during normal `npm run dev` usage: the OpenCode CLI upgrade check, npm latest dependency sync, and npm audit remediation now run on the first local dev start of the day. If `package.json` or `package-lock.json` changes later the same day, the affected maintenance step runs again immediately instead of waiting until tomorrow.

Use `LOOPTROOP_DEV_SKIP_DEPS=1 npm run dev` if you want to skip npm dependency/audit mutation for a given run, `LOOPTROOP_DEV_SKIP_OPENCODE_UPGRADE=1 npm run dev` to skip the CLI upgrade step, `LOOPTROOP_DEV_FORCE_MAINTENANCE=1 npm run dev` to bypass the once-per-day gate, and `LOOPTROOP_DEV_VERBOSE=1 npm run dev` to see the raw maintenance output.

You can also run the same maintenance steps directly:

```bash
npm run deps:sync
npm run audit:remediate
npm run opencode:upgrade
```

Use the top-right `Docs` button in the dashboard, or open [Docs Home](docs/index.md) directly from the repo.

For the full setup flow, environment variables, and the current stable-upstream warning caveats (`drizzle-kit`, `better-sqlite3`, `vitepress`, `mermaid`), read the [Getting Started Guide](docs/getting-started.md).

For the runtime module layout after the removed repository-shape snapshot, see [Docs Home](docs/index.md) and the [System Architecture module map](docs/system-architecture.md#module-map).
