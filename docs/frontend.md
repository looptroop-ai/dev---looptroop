# Frontend

The frontend is a React 19 SPA that renders the ticket dashboard, the live workspace, review panes, and the navigator surfaces around them.

The UI is data-driven from:

- `/api/*` REST endpoints
- `/api/stream` SSE updates
- workflow metadata in `shared/workflowMeta.ts`
- ticket artifacts and runtime state from the backend

## Top-Level Composition

| Area | Purpose | Primary files |
| --- | --- | --- |
| App shell | App startup, configuration preload, global layout | `src/App.tsx` |
| Ticket dashboard | Ticket list, status cards, workspace selection | `src/components/ticket/*` |
| Active workspace | Chooses the live view for the selected phase | `src/components/ticket/ActiveWorkspace.tsx` |
| Navigator | Timeline, approval navigation, context tree, errors, full log entry point | `src/components/ticket/NavigatorPanel.tsx` |
| Workspace views | Draft, council, interview, approval, coding, error, canceled, review, full log | `src/components/workspace/*` |

## Active Workspace Routing

`ActiveWorkspace.tsx` maps workflow metadata to concrete views.

| `uiView` | Current component |
| --- | --- |
| `draft` | `DraftView` |
| `council` | `CouncilView` |
| `interview_qa` | `InterviewQAView` |
| `approval` | `ApprovalView` |
| `coding` | `CodingView` |
| `error` | `ErrorView` |
| `done` | `CodingView` |
| `canceled` | `CanceledView` |

Additional routing rules:

- historical phases usually render through `PhaseReviewView`
- `fullLogOpen` forces `FullLogView`
- reviewable past coding still uses `CodingView` in read-only mode
- active or selected error occurrences render `ErrorView`

## Navigator Surfaces

`NavigatorPanel.tsx` is more than a left rail. It combines several different navigation modes:

- `PhaseTimeline` for the workflow spine
- `ErrorOccurrencesPanel` for active and past failures
- `ApprovalNavigator` for interview, PRD, and beads approval context
- `ContextTree` for context visibility
- a full-log toggle that opens `FullLogView`

That split matters because the workspace is designed for both live work and historical review.

## Key Workspace Views

| View | Primary purpose |
| --- | --- |
| `DraftView` | Ticket editing and start controls |
| `CouncilView` | Multi-model draft and vote phases with artifacts |
| `InterviewQAView` | Interactive interview batches, draft persistence, skip flow |
| `ApprovalView` | Review and edit interview, PRD, beads, and execution setup artifacts; PRD approval also exposes the winning model's Full Answers as compact read-only context |
| `CodingView` | Active bead execution, bead list, logs, diffs, verification actions |
| `ErrorView` | Live blocked state or historical error occurrence review |
| `PhaseReviewView` | Historical artifact review for completed phases |
| `FullLogView` | Full folded execution log stream |

## Coding Workspace Surfaces

The coding workspace is broader than a simple log pane.

Current `CodingView` composes:

- bead list and progress UI
- `BeadDiffViewer`
- `CollapsiblePhaseLogSection`
- `LogEntryRow`
- `PhaseArtifactsPanel`
- `VerificationSummaryPanel`

It also merges persisted bead artifacts with runtime bead overlays from the live ticket payload so the UI can show in-progress status and notes without waiting for a full artifact refresh.

## Data Hooks

### Workflow And Artifacts

| Hook | Current role | Current return shape |
| --- | --- | --- |
| `useWorkflowMeta()` | Loads phase and group metadata | `{ groups, phases, phaseMap, isLoading }` |
| `useTicketArtifacts(ticketId, opts?)` | Fetches and caches ticket artifacts | `{ artifacts, isLoading }` |
| `useTicketPhaseAttempts(ticketId?, phase?)` | Reads phase-attempt history | React Query result |

### Ticket And Profile Data

| Hook | Current role |
| --- | --- |
| `useTickets(projectId?)` | Ticket list with auto-refresh for active tickets |
| `useTicket(id)` | Individual ticket with active-state refresh |
| `useProfile()` | Singleton profile query against `/api/profile` |
| `useOpenCodeModels()` | Connected models only |
| `useAllOpenCodeModels()` | Full catalog including disconnected providers |

### Live Updates

`useSSE({ ticketId, onEvent })` is the ticket stream hook.

Current behavior:

- connects to `/api/stream`
- persists the latest SSE event id per ticket in browser storage
- sends `ticketId` and `lastEventId` on reconnect when available
- listens for `state_change`, `progress`, `log`, `error`, `bead_complete`, `needs_input`, and `artifact_change`
- invalidates or patches React Query caches in response
- refetches ticket details, ticket lists, artifacts, interview state, setup-plan state, bead state, and server logs after a reconnect gap
- returns `{ lastEventIdRef, connectionState }`

Current `connectionState` values are:

- `connecting`
- `connected`
- `reconnecting`

## Interview Draft Persistence

`useBatchSubmit(ticketId)` is one of the higher-value stateful hooks in the app.

It does more than submit answers:

- stores draft answers per interview batch
- tracks skipped questions
- tracks selected options
- restores drafts from persisted UI state
- auto-saves drafts with debounce through ticket UI-state artifacts and only marks a draft saved after the write succeeds
- flushes the latest unsaved snapshot with a keepalive request on `pagehide` or `beforeunload`
- coordinates submit and skip mutations
- listens for interview batch updates coming back from the runtime

That makes `InterviewQAView` resilient across reloads, view changes, and follow-up question rounds.

Approval panes use the same success-aware debounced UI-state pattern for editor drafts. This protects large manual edits if the browser tab closes before the debounce timer finishes.

`PrdApprovalPane` keeps the PRD editor as the primary surface. When the winning PRD draft has a Part 1 Full Answers artifact, the header shows a compact `Full Answers` chip that opens the read-only complete interview answer set used by that winning draft.

## Artifact And Review Surfaces

Several UI components exist specifically to inspect durable workflow state:

| Component | Purpose |
| --- | --- |
| `PhaseArtifactsPanel` | Phase-specific artifact viewer |
| `PrdApprovalPane` | PRD approval editor plus compact read-only Full Answers context for the winning draft |
| `WorkspacePhaseSummary` | Compact summary for the selected phase |
| `VerificationSummaryPanel` | Delivery actions during PR review |
| `PhaseReviewView` | Historical artifact review with phase-attempt support |
| `FullLogView` | Ticket-wide log inspection |

The frontend is built around the assumption that users must be able to inspect prior attempts and artifacts without replaying the run mentally from logs.

`LogProvider` treats the server-side normal execution log as durable truth for the lifecycle view. SSE-delivered rows merge into the in-memory log state immediately so the phase log viewer and full log can render live updates without waiting for file persistence. The browser opens the ticket stream through the same-origin `/api/stream` route, matching normal API fetches and avoiding dev-environment host/CORS drift. Browser-local logs are merged for responsiveness, but reconnect recovery requests the server log again and merges by stable entry identity so a frontend restart does not leave the visible log pane stale.

Streaming AI upserts are also written to `.ticket/runtime/execution-log.ai.jsonl`, a separate AI detail channel that is loaded only for AI and model log views. The backend still does not append those intermediate snapshots to `execution-log.jsonl`; finalized AI rows remain in the normal log for lifecycle history, while the AI detail log preserves prompts, thinking, tool calls, session rows, and latest streaming snapshots for reopening a ticket.

### Artifact Processing Notices

Future artifact companion payloads should persist parser and normalizer intervention details in `structuredOutput.interventions`. The collapsed notice stays compact and may include cheap category or rule labels, while the expanded notice treats `interventions` as the display source of truth for exact corrections, before/after examples, rule, category, stage, target, raw validator/parser messages, validation errors, and retry diagnostics.

`structuredOutput.repairWarnings` remains a raw audit string list and can be shown as source messages. When a legacy `.ticket/**` artifact has recognized warning strings but no explicit interventions, the frontend derives best-effort notice categories at render time without rewriting or migrating the artifact. Generic legacy repair strings stay quiet unless a structured intervention or retry diagnostic is present.

Parser repairs and structured retries are artifact processing notices, not coverage warnings. Coverage warnings should stay reserved for unresolved planning gaps, including unresolved contradictions inside the source artifacts when a prompt reports them.

## Frontend-State Relationship To Workflow Metadata

The frontend does not hardcode the full workflow. Instead, it derives major behavior from `shared/workflowMeta.ts`:

- group ordering for the timeline
- phase labels
- `uiView` mapping
- whether a phase exposes a review artifact type
- whether a phase is editable
- whether multi-model logs are expected
- whether a phase has question or bead progress semantics

The current timeline group order is To Do, Discovery, Interview, Specs (PRD), Blueprint (Beads), Pre-Implementation, Implementation, Post-Implementation, Done, and Errors. `PhaseTimeline` hides empty groups, so Errors only appears when the blocked-error phase is visible.

This is why keeping the docs aligned with `workflowMeta` matters: the UI is built around that shared metadata contract.

## Ticket Cancel Confirmation Dialog

The cancel button in `DashboardHeader` is labeled **"Cancel…"** (the ellipsis signals that a dialog will open before any action is taken).

Clicking the button opens a confirmation dialog with two optional, unchecked-by-default cleanup checkboxes:

| Checkbox | Effect when checked |
| --- | --- |
| **Delete AI-generated artifacts and worktree** | Permanently removes interview Q&A, PRD drafts, and beads plan entries from the database, and deletes the isolated git worktree (including its branch and any code written to it) |
| **Delete execution log** | Permanently removes `.ticket/runtime/execution-log.jsonl`, `.ticket/runtime/execution-log.debug.jsonl`, and `.ticket/runtime/execution-log.ai.jsonl` for this ticket; effective only when the worktree still exists (worktree removal via the first checkbox already covers these logs) |

Both options default to unchecked — canceling without checking anything preserves all artifacts exactly as the basic cancel behavior did before.

The dialog calls `useCancelTicket` which POSTs `{ deleteContent, deleteLog }` to `POST /api/tickets/:id/cancel`. The hook invalidates the ticket and ticket-list queries on success.

## Related Docs

- [API Reference](api-reference.md)
- [State Machine](state-machine.md)
- [OpenCode Integration](opencode-integration.md)
- [System Architecture](system-architecture.md)
