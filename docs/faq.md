# Frequently Asked Questions

If you are new to LoopTroop, some of the terminology and workflow choices can look unfamiliar. This page answers the common operational questions and links to the deeper docs that own the details.

## What is a bead?

A bead is LoopTroop's smallest execution unit. Instead of asking one model to build an entire feature in one long session, LoopTroop breaks the approved plan into smaller tasks with acceptance criteria, dependencies, target files, and tests.

Read more: [Beads](beads.md)

## What is the full ticket lifecycle?

A ticket starts in `DRAFT`, moves through relevant-file scanning, interview, PRD, and beads planning, pauses at multiple approval gates, then enters execution setup, bead-by-bead coding, final verification, PR delivery, and cleanup. It can also route into `BLOCKED_ERROR` for manual retry or into `CANCELED` as a terminal outcome.

Read more: [Ticket Flow](ticket-flow.md), [State Machine](state-machine.md)

## Why use LoopTroop instead of just asking ChatGPT or Claude for code?

Plain chat loops tend to degrade as context grows. Planning quality is fragile, retries often happen in the same polluted session, and important workflow state lives only in the conversation unless you externalize it yourself.

LoopTroop responds by:

1. forcing structured planning before coding
2. using a council instead of a single first draft
3. rebuilding context from durable artifacts at each phase
4. isolating execution in ticket worktrees
5. requiring human approval at the expensive boundaries

Read more: [Core Philosophy](core-philosophy.md), [Context Isolation](context-isolation.md)

## What is an LLM council?

In LoopTroop, an `LLM council` means a structured multi-model workflow:

1. independent draft generation
2. anonymized voting
3. winner refinement
4. coverage verification

It is not a free-form multi-agent chat room. The term is useful, but it is not a universal standard term. LoopTroop uses it for a very specific planning contract.

Read more: [LLM Council](llm-council.md), [Core Philosophy](core-philosophy.md)

## What is a Ralph-style retry?

It is LoopTroop's fresh-session recovery pattern for failed coding attempts. Instead of arguing with a model inside the same broken transcript, LoopTroop records what failed, resets back to the bead start snapshot, and retries in fresh context with a compact wipe note.

The term is a community pattern, not an official standard. LoopTroop uses it in a bounded way with retry limits and explicit blockage when trust is gone.

Read more: [Execution Loop](execution-loop.md), [Core Philosophy](core-philosophy.md)

## Does LoopTroop edit my main checkout directly?

No. LoopTroop executes in a ticket-owned `git worktree`, not in the attached project checkout you normally work from. That keeps the main checkout out of the execution blast radius while still letting LoopTroop produce a reviewable branch and PR.

Read more: [System Architecture](system-architecture.md), [Execution Loop](execution-loop.md)

## Why are worktrees so important here?

Worktrees are what make LoopTroop's retry and recovery model practical. They let the system keep ticket artifacts and code changes together, reset a bead to a known commit boundary, and clean up ticket-local runtime state without confusing that with your normal development workspace.

LoopTroop uses an official Git feature for this, not a custom repository format.

Read more: [Ticket Flow](ticket-flow.md), [System Architecture](system-architecture.md), Git’s official [`git worktree`](https://git-scm.com/docs/git-worktree.html) docs

## Why mention VMs or stronger isolation if worktrees already exist?

Because worktrees solve repository isolation, not host isolation. If an agent can execute commands for hours, a disposable VM, cloud desktop, or similarly sandboxed host gives you an extra safety boundary around the whole machine, not just around the repo checkout.

The short version:

- worktrees protect the repo boundary
- VMs or sandboxes protect the host boundary

Read more: [Core Philosophy](core-philosophy.md), [System Architecture](system-architecture.md)

## What does `BLOCKED_ERROR` mean?

It means the workflow hit a failure that LoopTroop decided not to continue through automatically. The system stores the exact `previousStatus`, captures error details and history, and waits for you to either retry that phase or cancel the ticket.

It is a recovery state, not a silent dead end.

Read more: [Ticket Flow](ticket-flow.md), [State Machine](state-machine.md)

## What happens during PR review?

After coding, final test, integration, and PR creation, the ticket pauses in `WAITING_PR_REVIEW`. From there you can:

- merge the PR and finish
- finish without merge
- cancel the ticket

LoopTroop treats both successful merge and deliberate close-unmerged as valid delivery outcomes, then cleans up transient runtime state and marks the ticket complete.

Read more: [Ticket Flow](ticket-flow.md)

## Where do the important artifacts live?

The short map is:

- app-level metadata: app SQLite
- project-level workflow state: project SQLite
- human-readable ticket artifacts: `.ticket/**` in the ticket worktree
- bead plan: `.ticket/beads/<flow>/.beads/issues.jsonl`
- runtime logs: `.ticket/runtime/execution-log.jsonl` for the normal log, `.ticket/runtime/execution-log.debug.jsonl` for persisted debug/forensic detail, and `.ticket/runtime/execution-log.ai.jsonl` for AI prompts, thinking, tool calls, and streaming detail

Read more: [System Architecture](system-architecture.md), [Database Schema](database-schema.md)

## How do I customize which models LoopTroop uses?

LoopTroop reads available models through OpenCode. Your profile and project settings decide the main implementer and council members, and the final model configuration is locked when the ticket starts.

Read more: [Getting Started](getting-started.md), [OpenCode Integration](opencode-integration.md)

## Can I edit an approved interview or PRD?

Yes — approval panes expose an edit mode for interview answers, the PRD, beads plan, and execution setup plan as long as the ticket has not finished. Editing an approved artifact replaces the current version in the database and marks the planning artifact as manually modified.

Downstream phases re-derive their inputs from the updated artifact the next time they run. For example, editing the approved PRD means the beads plan will be regenerated on the next run because beads are derived from the PRD.

The `editable` field in `workflowMeta.ts` controls which phases expose the edit UI in `ApprovalView`.

Read more: [Ticket Flow](ticket-flow.md)

## What is `npm run dev:app` and when should I use it?

`npm run dev:app` starts the frontend and backend together without launching the docs server or the OpenCode watcher. Use it when:

- OpenCode is already running in another terminal or as a persistent service
- You do not need the local docs server
- You want a leaner startup for a focused coding session

`npm run dev` is the standard start command for full development. It also runs the dev preflight, starts the docs server, and manages the OpenCode watcher. See [Scripts Reference](operations.md#scripts-reference) for a full breakdown.
