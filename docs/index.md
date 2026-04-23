# LoopTroop Docs

LoopTroop is a local orchestration system for repository-scale AI delivery. It separates planning from execution, keeps critical workflow state outside the model, executes code inside isolated worktrees, and forces explicit human review at the expensive boundaries.

This docs site is the navigation hub for the current system. The README stays GitHub-first; this site is where the grouped, cross-linked runtime documentation lives.

## Start Here

If you are new to LoopTroop, use this order:

1. [Getting Started](getting-started.md) for local setup and the first run.
2. [Core Philosophy](core-philosophy.md) for the system-level design goals.
3. [Ticket Flow](ticket-flow.md) for the full lifecycle from draft to completion.
4. [FAQ](faq.md) for terminology, safety, and common workflow questions.

## What LoopTroop Is

- A workflow engine, not a thin coding-chat wrapper.
- A planning pipeline that uses interview, PRD, and beads stages before code execution.
- A worktree-based execution system that keeps the attached project checkout out of the blast radius.
- A durable runtime built around SQLite, `.ticket/**` artifacts, execution logs, and resumable ownership-aware sessions.
- A human-in-the-loop system with approval gates before specs, blueprint, workspace setup, and final PR completion.

## Documentation Map

### Start Here

- [Getting Started](getting-started.md): installation, ports, environment variables, first project attach.
- [Core Philosophy](core-philosophy.md): context isolation, councils, retries, approvals, durable state.
- [FAQ](faq.md): terminology and practical operational questions.

### Workflow

- [Ticket Flow](ticket-flow.md): end-to-end ticket lifecycle, artifacts, user actions, retries, outcomes.
- [State Machine](state-machine.md): canonical phase inventory and transition model.
- [LLM Council](llm-council.md): draft, vote, refine, and coverage orchestration.
- [Beads](beads.md): execution-unit model, dependency graph, storage, diff review.
- [Execution Loop](execution-loop.md): per-bead execution, structured completion, fresh-session retry.

### Architecture

- [System Architecture](system-architecture.md): current runtime architecture, storage ownership, module map, lifecycle.
- [Context Isolation](context-isolation.md): context allowlists, trimming rules, cache behavior.
- [OpenCode Integration](opencode-integration.md): adapter, sessions, reconnect, stream handling.
- [Frontend](frontend.md): workspace composition, navigation, hooks, live updates.
- [Database Schema](database-schema.md): app DB, project DB, ownership boundaries.

### Reference

- [API Reference](api-reference.md): routes, SSE events, payload shapes.

### Direction

- [Roadmap](roadmap.md): current priorities and future directions, mirrored from the root roadmap.

## Terminology Notes

LoopTroop uses a mix of established and newer terms:

- `git worktree` is a standard Git capability for working on multiple linked trees from one repository. LoopTroop uses it as the main execution-isolation primitive.
- `Ralph-style retry` is community shorthand for abandoning a degraded coding session, keeping a compact failure note, and retrying in fresh context instead of continuing the same transcript.
- `LLM council` is LoopTroop's name for its multi-model draft, vote, and refine pattern. The idea overlaps with newer multi-model consensus research, but the exact workflow here is LoopTroop-specific.
- `AI orchestrator` is descriptive, not magical. In this repo it means a system that owns workflow state, artifact boundaries, retries, approvals, and delivery mechanics around model calls.

## Canonical Runtime Sources

When documentation and behavior disagree, the current implementation wins. The main sources of truth are:

- `shared/workflowMeta.ts` for phase labels, groups, descriptions, UI mapping, and review metadata.
- `server/machines/ticketMachine.ts` for state transitions and retry behavior.
- `server/routes/ticketHandlers.ts` for user-triggered actions like start, approve, merge, close-unmerged, and retry.

For the broad runtime picture, start with [System Architecture](system-architecture.md). For the exact lifecycle, go to [Ticket Flow](ticket-flow.md).
