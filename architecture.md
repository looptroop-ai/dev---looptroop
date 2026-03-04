# LoopTroop — Consolidated Specification

## 1. Summary

LoopTroop is a local GUI orchestrator for long-running, high-correctness AI software delivery — from idea to merged code. It runs a council-of-models planning pipeline (draft, vote, refine, coverage verify), then executes bead-scoped implementation loops with strict context isolation. OpenCode runs as an external long-lived process; LoopTroop manages workflow, state, approvals, persistence, recovery, and live UX. Runtime authority is split: SQLite for workflow/ticket state, `issues.jsonl` for bead tracker state, and `.ticket/runtime/execution-log.jsonl` for audit/debug. This document is the single consolidated source for product behavior, architecture, state machine, data contracts, and prompt contracts.

## 2. Description

*   **What it does** — LoopTroop takes a user through a modern Kanban-style dashboard and moves a ticket from idea → spec → tasks/tests → implementation → review, aiming for a "near-perfect-as-imagined" result (even if it takes hours). It is a graphical interface (GUI) only. While other tools focus on speed or cost-efficiency, LoopTroop optimizes for correctness and completeness ("slow and perfect") and alignment with the user's vision. It is designed for complex features where a perfect result is more valuable than a quick one.

*   **Core pipeline ("AI primitives")**
    1.  **Interview phase (AI-generated, tailored)**
        *   An AI-driven interview gathers all requirements and clarifies intent.
        *   This can take **1+ hour** by design to align tightly with the user's vision.
        *   Optionally, interview style adapts to the user's background (non-technical vs expert).
    2.  **PRD generation**
        *   Based on interview results, LoopTroop generates a **Product Requirements Document (PRD)** including epics + user stories.
        *   The PRD includes **detailed implementation steps**, decomposed as far as possible.
    3.  **Beads-style breakdown**
        *   Epics and user stories are split into **"beads"** (tasks + tests), using Steve Yegge's beads project methodology.
        *   A bead is a small, independently implementable unit of work with its own acceptance criteria and tests.
    4.  **Council of LLMs (multi-model drafting + voting)**
        *   Interview, PRD, and Beads are each produced by a "council":
            *   Each model produces a draft.
            *   Models vote using a weighted scoring rubric.
            *   The winning draft incorporates strong ideas from losing drafts.
    5.  **Execution via AI coding agent (OpenCode) + "Ralph Loop"**
        *   Beads are implemented by an AI coding agent (OpenCode).
        *   A retry loop ("Ralph Wiggum loop") repeatedly attempts a bead with refreshed context until:
            *   All tasks + tests pass, or
            *   Maximum iterations are reached.
        *   Execution can take **several hours**, sometimes **10+ hours**, by design. This is intended for unattended operation; leave LoopTroop running overnight.

*   LoopTroop is a pass-through to your AI provider. Whatever MCP tools, skills, permissions, or authentication you have configured in OpenCode work identically in LoopTroop.

*   **Why this exists** — Context rot is the main enemy. Context rot happens when too much data is fed to an AI model, overflowing the maximum context, causing compaction and loss of important data. Quality degrades severely even at ~60% of maximum context. At each step in the lifecycle, the AI agent receives the absolute minimum context it needs — no more. This keeps the AI's working context fresh and relevant, which is critical for complex multi-step projects that take hours.

*   **What it is NOT for**
    *   **Cost-sensitive use cases:** Running models via API can be expensive (cost can be lowered by using subscriptions through providers in OpenCode).
    *   **Urgent delivery:** If you need a feature fast, this isn't designed for speed.
    *   **Very small/simple tasks:** For simple apps/features, prefer IDE+AI or tools like Replit / Bolt / Lovable, etc.

## 3. MVP Requirements & Principles

### 3.1 Environment Requirements

*   **Infrastructure:** A VM / disposable cloud desktop VM / VPS / container environment is recommended.
    *   Reason: the app runs by default with `--yolo` (which runs all commands an agent gives, including dangerous ones) and can run unattended for hours, so isolation helps prevent accidental local file damage.
*   **System requirements:** minimum **4 GB RAM** and **15 GB free space**. The host system must be configured to prevent sleep/hibernation during execution.
*   **OS support:** Windows (WSL) + Linux out of the box; macOS not tested yet but should work.
*   **Dependencies**
    *   OpenCode installed + configured
    *   Git installed + configured per project folder

### 3.2 Architecture Principles

**General**: Keep LoopTroop code simple: minimal complexity, avoid duplication. It should run as fast as possible; LoopTroop is primarily a **wrapper/orchestrator** for OpenCode, which does the effective execution (using an AI model).

**OpenCode integration:** (SYS)
*   LoopTroop talks to OpenCode via `opencode serve` (background service) + `@opencode-ai/sdk` (client library).
*   **Why this setup works**
    *   24+ hour execution: OpenCode server runs independently (survives UI crash/restart)
    *   Real-time logs: SDK supports SSE streaming
    *   Multi-model council: send same prompt to multiple models; collect responses
    *   Resume after crash: app reattaches only the active owned session; if invalid/missing, it starts a fresh session and rebuilds context from artifacts
    *   Send structured context: ticket-local codebase map (`.ticket/codebase-map.yaml`) + PRD + beads, etc.
    *   Simple integration: OpenCode handles retries/errors
*   **Model selection and key management** — API keys/subscriptions are configured in OpenCode, LoopTroop queries OpenCode for available configured models.

**Security & safety (MVP stance)**
*   MVP does not prioritize security because it runs locally, ideally in an isolated VM/container.

**Architectural constraints:**
*   **API key management:** LoopTroop must not store provider API keys — it only queries OpenCode for available configured models via the SDK.
*   **Process isolation:** OpenCode runs as a separate long-lived process; LoopTroop is a client, never embedded.
*   **Retry responsibility split:** OpenCode handles low-level retries/errors (API call failures, rate limits, transient provider issues). LoopTroop handles higher-level bead lifecycle retries (context wipes, iteration limits, circuit breakers for stagnation).
*   **Runner scope:** The runner (MAI/OpenCode) may only read/write the active ticket worktree. No access to other worktrees or the main branch during execution.

**Artifact persistence:** Ticket artifacts live under `.ticket/` in each active worktree; beads workspace at `.ticket/beads/main/.beads/`. SQLite is authoritative for state; `.ticket/runtime/state.yaml` is a rebuildable projection (`SQLite → state.yaml → SSE`); `.ticket/runtime/execution-log.jsonl` is append-only audit/debug evidence. `codebase-map.yaml` is generated by SYS on ticket start. Runner scope is restricted to the active ticket worktree. Per-bead commits/pushes use an explicit artifact allowlist (not `git add .ticket` blindly): commit stable planning/intent artifacts (`interview.yaml`, `prd.yaml`, `codebase-map.yaml`, `issues.jsonl`, approval receipts, commit-state sync receipts) plus code changes; never commit runtime churn files (`.ticket/runtime/**`, `.ticket/locks/**`, `.ticket/streams/**`, `.ticket/sessions/**`, `.ticket/tmp/**`).

**Folder tree:**
```
project/                                        ← main repo (main branch)
├── .git/
├── .looptroop/                                  ← PROJECT scope
│   ├── config.yaml                              ← models, timeouts, council settings, name, shortname, icon, color and any other project-level config
│   ├── db.sqlite                                ← SQLite database
│   └── worktrees/                               ← all worktrees live here flat
│       ├── PROJ-1/                              ← ticket workspace path (reserved at creation; git worktree on Start)
│       │   ├── src/...                          ← source code (exists after Start)
│       │   ├── package.json                     ← exists after Start
│       │   └── .ticket/                         ← TICKET scope (committed on PROJ-1 branch after Start)
│       │       ├── meta/                        ← created at ticket creation only
│       │       │   └── ticket.meta.json
│       │       ├── interview.yaml               ← created after Start
│       │       ├── prd.yaml                     ← created after Start
│       │       ├── codebase-map.yaml            ← created at Start
│       │       ├── approvals/
│       │       ├── runtime/                     ← runtime-only (gitignored)
│       │       │   ├── state.yaml
│       │       │   ├── execution-log.jsonl
│       │       │   ├── streams/
│       │       │   ├── sessions/
│       │       │   ├── locks/
│       │       │   └── tmp/
│       │       └── beads/
│       │           └── main/
│       │               └── .beads/
│       │                   └── issues.jsonl
│       ├── PROJ-2/                              ← another ticket worktree
│       │   ├── src/...
│       │   └── .ticket/...
│       ├── PROJ-1--bead-3/                      ← future: parallel bead worktree (PROJ-1--bead-3 branch)
│       │   ├── src/...                          ← source code only, no .ticket/
│       │   └── package.json
│       └── PROJ-1--bead-7/                      ← future: parallel bead worktree
├── src/                                         ← main branch source code
└── package.json
```

### 3.3 Council Voting System

1.  **Drafting:** Each council model produces a draft independently based on the same input context.
2.  **Voting system:** After all models finish drafting, each model scores all drafts using the same weighted rubric. (AIC)
    *   a. **Winner selection:** The draft with the highest final score wins. (SYS). In each phase, the winning model can be different.
    *   b. **Refinement:** The winning model improves its draft by incorporating only helpful ideas from losing drafts. (AIC winner)
        *   c. **Tie-break:** If 2+ drafts tie for first place, the main implementer draft is considered the winning draft (SYS) and then refinement is applied (MAI).

#### Council Parallel Execution
All council operations run in parallel: draft generation (each member drafts simultaneously via separate OpenCode sessions) and voting (each member scores all drafts simultaneously). Only the refinement step is sequential.

#### OpenCode Session Lifecycle
- **Council phases:** Create a fresh OpenCode session per council member per phase attempt (draft, vote, refine, coverage). Do not reuse prior council-step history.
- **Execution phase:** Create a fresh OpenCode session per bead execution attempt (`bead_id` + `iteration`). Do not reuse sessions across beads.
- **Context wipe behavior:** On retry/context wipe, always start a new session for the new attempt. Failed-attempt session history is not reused.
- **Knowledge transfer path:** Carry prior learnings through structured artifacts (`interview.yaml`, `prd.yaml`, `issues.jsonl`, bead `notes`) rather than chat/session history.
- **Reconnect policy:** On restart, reattach only if the persisted session ownership matches the active run/phase/attempt. If mismatch or missing session, create a replacement fresh session and continue from artifacts.

#### Timeout & Failure Tracking
- **Timer start:** The timeout clock starts when the system sends the council request to each model (not first-token or connection open).
- **Per-member, per-phase outcomes:** Each council run tracks the outcome of every member for that phase:
  - `completed` — valid draft/vote received within the timeout window.
  - `timed_out` — no response received before `council_response_timeout`.
  - `invalid_output` — response received but malformed or fails schema validation.
- These outcomes are recorded in the execution log (`.ticket/runtime/execution-log.jsonl`) for auditability and shown in the ticket detail UI.
- **Quorum gate:** Continue with all valid (`completed`) responses if ≥ `min_council_quorum` (default 2). If fewer valid responses remain, set ticket to `BLOCKED_ERROR`. The user can then retry or select different models.

#### Council Size Limits
- **MVP:** UI and backend must validate and reject configurations with more than the configured maximum number of members.

#### Context Assembly Contract (MVP)
- Every OpenCode prompt call (council draft/vote/refine/coverage, interview Q&A, bead iteration, and final-test generation) must call a single function: `buildMinimalContext(phase, ticketState, activeItem?)`.
- `buildMinimalContext(...)` enforces hard phase allowlists (only required sources are included; extras are rejected).
- `buildMinimalContext(...)` enforces deterministic token budgeting per call and trims in fixed priority order when needed.
- Within one ticket lifetime, cache reusable context slices (`codebase-map.yaml` summary, interview summary, PRD outline) and reuse them instead of reloading full artifacts.
- Direct ad-hoc prompt assembly outside `buildMinimalContext(...)` is forbidden in MVP.

## 4. Product UX

### 4.1 Setup / Onboarding (USR + SYS)

**Profile**
*   username (display name)
*   icon (optional)
*   user background / expertise (Senior SWE, Carpenter, Kubernetes expert, PM, etc.) (optional)
    *   used to adapt interview style (simple vs advanced; analogies for non-technical users). In the MVP, this is only used during the interview phase, when hard technical questions can be adapted by the AI model based on the user's background.

**Configuration** (USR + SYS)
*   main implementer model — the primary AI model responsible for building the project — selected from the models available in OpenCode. MAI is also a council member.
    *   per-iteration timeout (default 20 minutes) — if a bead activity takes more than this time, it will be considered failed and retried with a new iteration until max iterations is reached. (0 = no timeout, wait until it finishes, not recommended, tooltip to set it to at least 1 hour, better 20-30 minutes)
    *   max iterations per bead (default 5) — if a bead is stuck/blocked/tests not passed, how many more times LoopTroop will try to finish the bead. (0 = infinite retries)
*   council members (up to 4 in MVP) — select the other models that will debate and review the work.
*   interview duration: max_initial_questions (default 50) — the maximum number of questions a user can receive, including follow-ups. (0 = infinite questions, until model decides to stop)

### 4.2 Projects (USR + SYS)

*   When creating a new project
    *   name (project title)
    *   shortname (between 3 and 5 letters, e.g., Project > PROJ)
    *   icon (optional — a default one will be picked if none is uploaded by the user)
    *   color (ticket border) (optional — red and yellow are not options, but there are 32 colors to pick)
    *   folder (must be git-initialized)
        *   model will have full access inside that folder and can read/write anything. That's why a proper sandbox environment is needed, and Git should be linked to a GitHub repo for extra guardrails.
*   When viewing an existing project, the user can edit only the name, icon, and color.

### 4.3 Tickets (USR + SYS)

*   When creating a new ticket
    *   Title — title of the ticket
    *   project (ticket can belong to one project only)
    *   ID — auto-generated (e.g., PROJ-12), non-modifiable, incremental per project
        *   lazy creation contract: at ticket creation, persist metadata only (SQLite + `.looptroop/worktrees/<ticket-id>/.ticket/meta/ticket.meta.json`)
        *   at ticket creation, create only minimal folders for metadata (`.looptroop/worktrees/<ticket-id>/.ticket/meta/`); do not create source/artifact files
        *   On first `Start` (To Do → In Progress), SYS must atomically run one idempotent initialization transaction:
            *   materialize/attach git worktree and branch named from ticket ID at the reserved ticket path (`.looptroop/worktrees/<ticket-id>/`) while preserving existing `.ticket/meta/`
            *   initialize only required folder structure (`.ticket/`, `.ticket/beads/main/.beads/`, `.ticket/runtime/`)
            *   create `.ticket/.gitignore` runtime denylist entries (`runtime/**`, `locks/**`, `streams/**`, `sessions/**`, `tmp/**`)
            *   generate `.ticket/codebase-map.yaml`
        *   If initialization fails at any substep, do not advance phase; ticket enters `BLOCKED_ERROR` with diagnostics and remediation
    *   description (detailed requirements)
    *   priority (Very High, High, Normal, Low, Very Low)
    *   status is system-controlled and shown after creation (not user-editable)
    *   create date (when ticket was created), start date (when ticket was started from To Do), planned date (estimated time until it should be finished), and last update date (last time some action was done on the ticket).
*   When viewing an existing ticket, the user can edit only the title and priority.

## 5. Kanban Board & Ticket Dashboard

### 5.1 Main Board (SYS + USR)

*   The board has 4 columns: To Do, In Progress, Needs Input, and Done. The To Do and Done phases should be smaller on each side (in desktop view), and the other two should be larger in the middle of the screen.
*   Only the 4 phases are shown, with their tickets. At the top, users can click buttons (with text) for configuration, project creation, and ticket creation.
*   Tickets placed in their current phase show only these details: ID and title, icon (if selected) and project, priority, status, last update date (relative — 2 days ago, yesterday, 12 hours ago, and on hover show full date). The ticket border uses the project color or flashes red if there are errors (flashing yellow is reserved for future enhancements). Tickets in the "In Progress" phase will have a small throbber to the left of the status.
*   The whole app should be mobile-friendly so it can auto-resize depending on screen dimensions (mobile, tablet, desktop).
*   Only one ticket is allowed to be open at a time. When creating/viewing a project, viewing a ticket, or changing configuration, a new view is opened and only that view is active; all other actions are blocked (the view can be closed by clicking a big X in the top-right corner or pressing Escape).
*   The Kanban board is a **read-only** view. All state changes happen inside ticket detail views via explicit user actions.
*   **Error Handling:** If an error occurs, execution stops, and the ticket is highlighted with a flashing red border.

**State change flow:**
```
User clicks action button → React calls Hono API
→ Hono sends event to XState → XState validates transition
→ If valid: persist authoritative state (SQLite and issues.jsonl when bead tracker changes) → SSE broadcast
→ React receives SSE → Updates ticket detail + Kanban column
```

### 5.2 Ticket Dashboard — Split-View Interface

Opening a ticket (in **any** phase, not only during execution) shows a **Ticket Dashboard** — a persistent **Split-View Interface** with detailed progress. Every ticket interaction is done in this dashboard, including file edits, question answers, artifact review, and live execution monitoring.

The dashboard is always a two-panel layout: a **larger primary panel (Active Workspace)** on the right/center and a **smaller secondary panel (Navigator)** on the left/side. Both panels adapt their content to the ticket's current phase while keeping a consistent chrome (header with ticket ID, title, status badge, priority, action buttons, and close/Escape control).

#### A. Navigator Panel (smaller, left side)

The Navigator provides orientation and navigation across the ticket's full lifecycle. It is always visible and contains two vertically stacked sections:

*   **1. Phase Timeline (Status Accordion)**
    *   All workflow statuses are listed **in order** as **mutually exclusive accordion items** (only one can be expanded at a time).
    *   Each status item shows a **tooltip on hover** with a short description of that phase (e.g., "AI models generate competing PRD versions").
    *   **Status indicators:** Green Check (completed), Blue Throbber (active/current), Gray (pending/future).
    *   **Interactivity rules:**
        *   Past statuses (completed): clickable — clicking loads that phase's content into the Active Workspace (read-only review of what happened during that phase).
        *   Current status: opened/expanded by default when the ticket is opened. Uses **smart auto-scroll** to keep the latest activity visible.
        *   Future statuses: **greyed out** and **cannot be opened**. They are visible for orientation but non-interactive.
    *   **Progress indicators** displayed inline where applicable:
        *   Interview phase: question progress (e.g., "Q 12/50")
        *   PRD phase: drafting/voting/refining sub-step indicator
        *   Beads phase: drafting/voting/refining sub-step indicator
        *   Execution phase: bead progress (e.g., "Bead 7/34") and overall % done
    *   When a past status is selected, a subtle "← Back to live" button appears at the top of the Navigator to return to the current status.

*   **2. Context Tree (phase-adaptive hierarchical view)**
    *   The tree adapts its content based on which phase is active or selected in the Phase Timeline:

    | Phase | Context Tree Content |
    | :--- | :--- |
    | **DRAFT** | Ticket metadata only (title, description, priority). |
    | **Interview (Council)** | Council activity summary: each model's draft status (drafting / voting / refining). |
    | **Interview (Q&A)** | List of questions grouped by interview phase (Foundation / Structure / Assembly). Each question shows answered/skipped/pending status. Clickable to jump to that Q&A in the Active Workspace. |
    | **Interview Approval** | Interview Results outline: collapsible sections by topic/phase. |
    | **PRD (Council)** | Council activity summary: each model's draft status. |
    | **PRD Approval** | PRD outline grouped by **Epic → User Stories**. Clickable sections load that part in the Active Workspace. |
    | **Beads (Council)** | Council activity summary: each model's draft status. |
    | **Beads Approval** | Bead list grouped by **Epic → User Story → Beads** (tree view). Clickable to load individual bead details. |
    | **Pre-flight / Coding / Final Test / Integration / Cleanup** | **Bead Navigator Tree:** scrollable list grouped hierarchically by **Epic → User Story → Beads**, with status indicators per item. Designed to handle hundreds of beads without layout clutter. |
    | **Manual Verification** | Same Bead Navigator Tree + summary of final test results. |
    | **Done / Canceled** | Full lifecycle tree: all phases listed with their final status; bead tree if execution was reached. |
    | **BLOCKED_ERROR** | Error context at the top (failed bead/phase, error reason), followed by the tree appropriate to the phase where the error occurred. |

    *   **Bead Navigator Tree specifics** (during execution and post-execution phases):
        *   **Auto-Focus:** Completed and future Epics are collapsed by default to minimize noise; only the active Epic/Story group is expanded.
        *   **Interaction:** Clicking any past bead loads its logs/details into the Active Workspace (replacing the live view). Clicking a future (pending) bead loads its specification/plan (read-only). Clicking the currently running bead returns to the live view.
        *   **Visuals:** Green Check (done), Blue Throbber (active), Gray (pending), Red X (error) next to every item.
        *   **Counters:** Each Epic and User Story node shows a completion fraction (e.g., "3/5 beads done").

#### B. Active Workspace Panel (larger, right/center side)

The primary panel displays the main content for the ticket's current phase. When browsing a past phase/status via the Navigator, it shows that phase's content in read-only mode instead.

*   **Phase-specific content:**

    | Phase | Active Workspace Content |
    | :--- | :--- |
    | **DRAFT** | Ticket details view (title, description, priority, project). "Start" action button. |
    | **Interview — Council Deliberating/Voting/Compiling** | Live council activity view: which models are drafting/voting, progress indicator, and streaming thinking/reasoning from the active model(s). Read-only — user waits. |
    | **Interview — Q&A (WAITING_INTERVIEW_ANSWERS)** | Interactive interview interface: current question displayed prominently with answer input area, Skip button, and Submit button. Question progress shown (e.g., "Q 12/50"). Previous Q&A pairs are visible above (scrollable history). Smart auto-scroll keeps the current question in view. |
    | **Interview — Coverage Verification** | Live coverage check progress: AI analyzing answers for gaps. Read-only view of the verification process. |
    | **Interview Approval (WAITING_INTERVIEW_APPROVAL)** | Interview Results displayed in a **structured, readable/editable format** (not raw YAML) with collapsible sections by topic, color-coded for readability, and cross-links to related questions/answers. CodeMirror editor (YAML mode) for raw edits via "Edit Raw" toggle. Approve / Edit / Re-run buttons. |
    | **PRD — Drafting/Voting/Refining** | Live council activity view: streaming AI thinking, draft comparison progress, voting scores (when available). Read-only — user waits. |
    | **PRD — Coverage Verification** | Live coverage check: AI verifying PRD against Interview Results. Read-only. |
    | **PRD Approval (WAITING_PRD_APPROVAL)** | PRD displayed in a **structured, readable/editable format** with collapsible Epics/User Stories/acceptance criteria, color-coded sections, and cross-links to Interview Results. CodeMirror editor (YAML mode) for raw edits via "Edit Raw" toggle. Approve / Edit / Re-run buttons. |
    | **Beads — Drafting/Voting/Refining** | Live council activity view: streaming AI thinking, bead architecture progress. Read-only — user waits. |
    | **Beads — Coverage Verification** | Live coverage check: AI verifying bead coverage against PRD. Read-only. |
    | **Beads Approval (WAITING_BEADS_APPROVAL)** | Beads displayed in a **structured, readable/editable format** with each bead expandable to show all fields (description, acceptance criteria, dependencies, target files, tests, etc.), color-coded by status, and cross-links to PRD sections and interview answers. CodeMirror editor (YAML mode) for raw edits via "Edit Raw" toggle. Approve / Edit / Re-run buttons. |
    | **Pre-flight Check** | Doctor diagnostics output: checklist of validation items with pass/fail/warning status, model ping results, and any blocking issues. Read-only. |
    | **Coding (active bead)** | **Live execution view** for the currently running bead: real-time streaming logs, AI thinking/reasoning, code being written, test output, iteration counter (e.g., "Iteration 2/5"), and progress within the bead. Smart auto-scroll. |
    | **Coding (browsing past bead)** | Completed bead review: final logs, test results, code changes summary, iteration history/notes. Read-only. |
    | **Coding (browsing future bead)** | Bead specification preview: description, acceptance criteria, dependencies, target files, tests. Read-only. |
    | **Final Test** | Final test output on unsquashed bead-commit branch state: streaming test results, pass/fail summary. Read-only. |
    | **Integration** | Post-test candidate preparation progress on ticket branch (squash/finalize commit history only after final test pass, pre-merge checks), commit summary. Read-only. |
    | **Manual Verification (WAITING_MANUAL_VERIFICATION)** | Summary of what was built on the ticket branch candidate: completed beads, final test results, candidate commit. User confirms with "Complete" (which triggers final merge to `main`) or can report issues. |
    | **Cleanup** | Cleanup report: removed/skipped/failed resources. Read-only. |
    | **Done** | Completion summary: all phases with timestamps, total duration, bead statistics, final commit hash. Read-only. |
    | **Canceled** | Cancellation details: which phase was active at cancellation, any partial artifacts preserved. Read-only. |
    | **BLOCKED_ERROR** | Error details: failed phase/bead, error message, iteration notes, diagnostic summary with probable-cause codes. Retry / Cancel buttons. |

#### C. Dashboard Behavior Rules

*   **Default view on open:** The current status is expanded in the Navigator and its content is loaded in the Active Workspace.
*   **Single-selection model:** Selecting any item in the Navigator (a phase status or a specific bead/question/section) replaces the Active Workspace content. Only one thing is shown at a time — no split-within-split or tabs in MVP.
*   **Smart auto-scroll:** When viewing a live/active phase, new content (logs, AI output, new questions) auto-scrolls into view. If the user manually scrolls up to review earlier content, auto-scroll pauses until the user scrolls back to the bottom or clicks "Resume auto-scroll."
*   **Cross-links between artifacts:** PRD sections link to their source interview answers. Beads link to their PRD user stories and (transitively) to interview answers. Clicking a cross-link navigates to that artifact in the Active Workspace and selects the corresponding item in the Navigator.
*   **Mobile behavior:** On small screens, the Navigator collapses into a slide-out drawer (hamburger menu toggle). The Active Workspace takes full width. The Phase Timeline remains accessible via the drawer.
*   **Responsive resize:** The split ratio is adjustable via drag handle on desktop. Default split is approximately 25% Navigator / 75% Active Workspace.
*   **Edit mode gating:** Interview Results, PRD, and Beads artifacts are editable by the user **at any time before execution starts** (i.e., before PRE_FLIGHT_CHECK). The Active Workspace enables inline editing (via Structured Viewer + CodeMirror "Edit Raw" toggle) during approval phases (WAITING_INTERVIEW_APPROVAL, WAITING_PRD_APPROVAL, WAITING_BEADS_APPROVAL) for the current artifact, and also when the user navigates back to a previously approved artifact before execution. Once execution begins, all planning artifacts become read-only. Editing Beads affects only `.ticket/beads/<flow-id>/.beads/...` for the active ticket/flow.
*   **Cascading edit warnings:** Editing Interview Results shows a warning that PRD and Beads phases will restart. Editing PRD shows a warning that Beads phase will restart. These warnings require explicit confirmation before saving.
*   **Re-run option:** At any time before execution starts, the user can re-run an entire planning phase (interview, PRD, or beads) or a specific section within a phase (e.g., only the council voting step, only the coverage verification pass) from scratch. A "Re-run" button is available during approval phases; navigating back to a completed planning phase also exposes re-run controls. Re-running a phase triggers the same cascading restart rules as editing (re-running Interview restarts PRD and Beads; re-running PRD restarts Beads).

## 6. Workflow Phases

### A. To Do
*   Inactive tickets. Every new ticket created lands here.

### B. Planning Phase

#### I. Interview Phase

*   Starts when USR clicks "Start" on a ticket. This moves the ticket to "In Progress" and starts the interview phase. (SYS)
*   On start, SYS performs lazy ticket initialization first (worktree + branch + `.ticket/` + main Beads workspace + `.ticket/.gitignore` runtime denylist), then creates `.ticket/codebase-map.yaml` before running PROM1. If any initialization or map generation step fails, ticket goes to `BLOCKED_ERROR` with diagnostics. (SYS)
*   **Disclaimer:** Warn the user that the interview phase may take up to 1 hour or more (necessary for models to fully understand final user expectations). Warn that depending on complexity, the execution phase can take even 10 hours or more. This is intended for a near-perfect result. (SYS and USR acknowledgement) — shown only once, when creating the first ticket after installation. (SYS)
*   **Council Debate:**
    *   First: each model generates a draft interview file with questions in logical order using a strict machine-readable format. Prompt is PROM1, and the context fed to the agent is the project codebase map and ticket details. (AIC)
        *   Second: SYS anonymizes and randomizes draft order per voter before voting. Context is refreshed; now each member gets the codebase map, ticket details, and interview drafts (AIC). The council votes to determine the winning question set using PROM2. (AIC). SYS selects the winning draft, the draft with the highest score.
    *   Third: Context is refreshed again; now the winner of AIC gets the codebase map, ticket details, and all drafts. The winning AIC model incorporates best options from losing drafts and outputs one final normalized question set (same format) using PROM3.
    *   Fourth: interview starts. Context is refreshed again; now the winner of AIC gets the codebase map, ticket details, and the final normalized question set. Questions are presented to the user using PROM4. (winning AIC and USR)
*   **Coverage Verification Pass (winning AIC):**
    *   Compare ticket description + all collected answers against the final Interview Results file using PROM5.
    *   Ask targeted follow-up questions only for unresolved gaps (no more than 20% of max_initial_questions).
*   **Output:** An "Interview Results" file is created based on the user answers (winning AIC). SYS gives USR the possibility to review and edit the interview results before approving and moving to the next phase.
    *   CRITICAL OUTPUT RULE: The AI response must consist of NOTHING except the exact requested artifact (YAML). No explanations, no markdown fences, no "Here is the result", no extra newlines before/after.

#### II. PRD Phase (Product Requirements Document)

*   **Generation:** Context is refreshed, now each model gets codebase map, ticket details, and the final Interview Results. For each skipped question, AIC members will decide the best approach. A complete PRD is created by each council member using PROM10. (AIC)
*   **Comparison:** SYS anonymizes and randomizes draft order per voter before voting. Context is refreshed; now each model gets the codebase map, ticket details, the final Interview Results, and each PRD draft. Models/critics compare PRD versions and vote/decide which version is best using PROM11. (AIC). Winning model is decided by SYS based on the highest score.
*   **Refinement:** Context is refreshed, now winning AIC gets codebase map, ticket details, the final Interview Results and all PRD drafts. The winning model incorporates relevant missing elements from other proposals into its winning draft using PROM12. (winning AIC)
*   **Coverage Verification Pass (winning AIC):**
    *   Compare Interview Results against final PRD using PROM13.
    *   Do not continue to Beads until coverage gaps are resolved.
*   **Output:** A single final "PRD" file by winning AIC. SYS gives USR the possibility to review and edit the PRD file before approving and moving to the next phase.
    *   CRITICAL OUTPUT RULE: The AI response must consist of NOTHING except the exact requested artifact (YAML). No explanations, no markdown fences, no "Here is the result", no extra newlines before/after.

#### III. Beads Breakdown Phase

*   **Observation:** LoopTroop implements only the Beads methodology — it does not provide the Beads project's CLI or daemon; the MVP does not require installing the Beads CLI (`bd`) or running a Beads daemon, and the artifacts in the `.ticket/` folder (inside the ticket worktree) are the source of truth.
*   **Generation:** Context is refreshed; now each model gets codebase map, ticket details, and the final PRD. Each model creates its own version of the Beads draft (subset fields only) using PROM20. (AIC)
*   **Comparison:** SYS anonymizes and randomizes draft order per voter before voting. Context is refreshed; now each model gets codebase map, ticket details, the final PRD, and all proposed beads drafts. Models review all proposed bead drafts and vote on the best architecture using PROM21. (AIC). Winning model is decided by SYS based on the highest score.
*   **Refinement:** Context is refreshed; the winning model refines its draft by incorporating improvements from losing drafts using PROM22. Context is refreshed again; the winning model expands the beads draft with all 22 required fields per bead using PROM23. (Winning AIC)
*   **Coverage Verification Pass (winning AIC):**
    *   Compare final PRD against Beads graph + tests using PROM24.
    *   Do not continue to Execution until each in-scope PRD requirement is mapped to at least one bead with explicit verification.
*   **Output:** A per-ticket Beads workspace is created/updated (containing the task list, dependencies, and verification tests) by the winning AIC. SYS gives USR the possibility to review and edit the bead file before approving and moving to the next phase.
    *   CRITICAL OUTPUT RULE: The AI response must consist of NOTHING except the exact requested artifact (JSONL). No explanations, no markdown fences, no "Here is the result", no extra newlines before/after.

### C. Execution Phase

*   **Pre-check (hard gate):** Before entering execution, LoopTroop runs a `Doctor` diagnostics pass that validates OpenCode connectivity, git safety, tool availability, artifact paths, configuration consistency, beads graph integrity (no dangling/circular dependencies), and runtime safety budgets. Critical failures block execution (`BLOCKED_ERROR`); warnings require explicit user confirmation. (MAI)
*   Only one active ticket in execution is allowed per project.

*   **Work loop ("Ralph Wiggum loop"):** A bead is runnable only when `status = pending` and all `blocked_by` dependencies are `done`. Among runnable beads, select by priority (lowest number first). Execute one bead at a time until completion, then pick the next runnable bead. (MAI)
    *   Every bead execution attempt, starting from the first one (including retries/context wipes) starts a fresh session with clean context, and only the current bead data is sent to the AI agent. (MAI)
        *   During execution, the PRD and interview files are completely immutable by all agents and systems. SYS dynamically computes the progress of an epic or user story by checking the completion status of its mapped beads in `issues.jsonl`.
    *   MAI — After the agent writes code in a bead and considers the code correct, it runs linter checks and then the verification steps/tests defined in the bead.
        *   A bead is completed only when:
            *   deterministic quality gates pass (lint/tests/typecheck as applicable),
            *   if the bead includes subjective acceptance criteria (UX wording, documentation clarity, visual consistency), a `qualitative_verdict` check returns `pass` with evidence,
            *   implementer outputs a machine-readable completion marker for that bead. Suggested marker format: `<BEAD_STATUS>{"bead_id":"<id>","status":"completed","checks":{"tests":"pass","lint":"pass","typecheck":"pass","qualitative":"pass"}}</BEAD_STATUS>`
                *   If required gates pass but marker is missing/invalid, treat as incomplete and retry.
                *   If marker says complete but any required gate fails, treat as failure and retry.
        *   If the agent is blocked/errored during linting or testing, the agent automatically tries to fix the errors and reruns linting/testing until checks pass. Circuit breaker for stagnation is when per-iteration timeout is reached (timer starts when a bead starts), then a context wipe is initiated.
        *   A context wipe (a new iteration) consists of the following steps:
            1. Action: reset only the active ticket worktree to the bead start snapshot (`bead_start_commit`) using `git reset --hard <bead_start_commit>` and `git clean -fd`. Closing any test commands or processes that might be still running from the previous iteration.
            2. A short summary of what has been done and the errors encountered will be appended to the current bead Notes section using PROM51.
            3. Retry: Agent tries from scratch with the lesson. Current bead data is fed to the AI agent as only context (which includes the refreshed Notes section).
            *   Maximum retries (maximum number of times a new context wipe can start) are configured in settings as max iterations per bead. A per-iteration timeout is configured too; if this timeout is exceeded, an iteration is considered failed and retried. If max retries are reached, the ticket goes to `BLOCKED_ERROR`.
    *   MAI — After each completed bead, run `git add` and `git commit` (with an auto-generated message by the main implementer), and then `git push` (for extra safety in case something happens locally). Use explicit `git add` allowlist paths only; do not stage the full `.ticket/` tree. Commit stable planning/intent artifacts and code changes only. Runtime churn (`.ticket/runtime/**`, `.ticket/locks/**`, `.ticket/streams/**`, `.ticket/sessions/**`, `.ticket/tmp/**`) is always gitignored and must be blocked by a pre-commit staged-file check. If git commands fail, retry up to 3 times, then continue with warning while preserving local commits for debugging.
        *   MAI — Progress is kept using the beads system in the active ticket flow workspace (`.ticket/beads/<flow-id>/.beads/`) and other artifacts in the ticket worktree.
        *   Progress/work is created/updated only on the active bead; it does not update/change previous or future bead details.
        *   This progress system can be used in case something has happened and the process needs to be resumed.

*   **Final testing:** After all beads complete, run the ticket-level final test on the unsquashed bead-commit branch state. The test is created using PROM52. If tests fail, preserve bead commit granularity for targeted fix/retry. (MAI)

*   **Integration:** Only after final test passes, squash/integrate commits into a clean release candidate history on the ticket branch and prepare final packaging. If this post-test integration fails, ticket goes to `BLOCKED_ERROR`. (MAI)

*   **Final steps**
    *   **Manual Test:** The user will have to manually verify the functionality at the end of the ticket. The system will wait for the user to confirm the ticket is done. On `Complete`, SYS performs the final merge of the ticket branch into `main`; if merge conflicts occur and cannot be resolved, the ticket goes to `BLOCKED_ERROR`. (USR + SYS)
    *   **Finalize:** Moving out of this status marks the ticket *Completed* and performs a cleanup. This removes only temporary files/worktrees/processes explicitly created and tagged by the active ticket run (optional — default yes). Never delete untracked or pre-existing user resources. Cleanup produces a report: removed resources, skipped protected resources, and any failures. (SYS)

### D. Done
*   Completed tickets in this phase.
*   Canceled tickets will arrive here too, with Canceled status.

#### Execution Durability Contract
- **Authoritative ownership:** SQLite is authoritative for workflow/ticket runtime transitions; `issues.jsonl` is authoritative for bead tracker data (graph/status/dependencies/notes/checkpoints).
- **Write ordering (strict):** Transition side effects run in this order: `1) authoritative persist first (SQLite and/or issues.jsonl depending on mutation) → 2) SSE broadcast`.
- **Authoritative persistence circuit-breaker:** If 3 consecutive authoritative persists fail (SQLite or `issues.jsonl`), stop execution and move ticket to `BLOCKED_ERROR` with explicit remediation.
- **Recovery on restart:** Hydrate workflow runtime from SQLite first, load/reconcile bead tracker state from `issues.jsonl`, then replay `.ticket/runtime/execution-log.jsonl` for audit context.

#### Atomic Artifact I/O Contract (MVP)
- All writes to ticket artifacts must go through one of two helpers:
  - `safeAtomicWrite(path, content)` → write to `${path}.tmp`, `fsync`, then atomic rename to `path`.
  - `safeAtomicAppend(path, line)` → append via atomic temp-write path with `fsync` (required for runtime log/journal writes).
- Covered files include `.ticket/*.yaml`, `.ticket/beads/**/issues.jsonl`, `.ticket/runtime/state.yaml`, `.ticket/runtime/execution-log.jsonl`, and runtime receipts.
- Startup recovery must scan ticket artifact roots for orphan `*.tmp`; when found, deterministically recover by promoting the temp file back to its target path before actors resume.
- Legacy partial-line truncate logic is allowed only as a fallback for `.ticket/runtime/execution-log.jsonl` trailing-line corruption.

#### Execution Log Durability (`.ticket/runtime/execution-log.jsonl`)
- **Append-only writes:** All writes are append-only and must use `safeAtomicAppend(...)+fsync` semantics.
- **Corruption handling:** On startup, if the last line is partial/malformed JSON (e.g., mid-write crash), truncate only that incomplete trailing line and log a warning (fallback path only; primary safety comes from atomic append).
- **Backup:** `.ticket/runtime/execution-log.jsonl` is not included in per-bead git commits/pushes. Keep it local for runtime/audit use and back it up via periodic ticket snapshots/archives.
- **Authority boundary:** `.ticket/runtime/execution-log.jsonl` is non-authoritative audit/debug evidence. Resume correctness depends on SQLite + `issues.jsonl` authoritative stores.

## 7. Workflow Logic & State Machine

| Phase (UI Column) | Order | Internal Status | Status (User View) | Owner | Description | Trigger to Next State |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1. TO DO** | 01 | DRAFT | Draft | User | Ticket created but inactive. | User clicks Start. |
| **2. IN PROGRESS** | 02 | COUNCIL_DELIBERATING | AI Council Thinking | AI | Models generate initial questions and debate approach. | Questions generated. |
| | 03 | COUNCIL_VOTING_INTERVIEW | Selecting Best Questions | AI | Models vote on best interview questions. | Winner selected. |
| | 04 | COMPILING_INTERVIEW | Preparing Interview | AI | Winner consolidates questions into interview set/results. | Interview starts → Move to 05. |
| | 06 | VERIFYING_INTERVIEW_COVERAGE | Coverage Check (Interview) | AI | Verifies ticket description + answers are fully covered in Interview Results. | If gaps: 05. If clean: 07. |
| | 08 | DRAFTING_PRD | Drafting Specs | AI | Models generate competing PRD versions. | Drafts ready. |
| | 09 | COUNCIL_VOTING_PRD | Voting on Specs | AI | Models vote on best PRD version. | Winner selected. |
| | 10 | REFINING_PRD | Refining Specs | AI | Winner incorporates missing details from others. | Candidate PRD ready → Move to 11. |
| | 11 | VERIFYING_PRD_COVERAGE | Coverage Check (PRD) | AI | Verifies PRD against Interview Results and constraints. | If gaps: 10. If clean: 12. |
| | 13 | DRAFTING_BEADS | Architecting Beads | AI | Models break PRD epics into individual beads (tasks & tests). | Drafts ready. |
| | 14 | COUNCIL_VOTING_BEADS | Voting on Architecture | AI | Models vote on the best implementation flow/bead breakdown. | Winner selected. |
| | 15 | REFINING_BEADS | Finalizing Plan | AI | Winner incorporates smart tasks/tests from losing drafts. | Candidate Beads ready → Move to 16. |
| | 16 | VERIFYING_BEADS_COVERAGE | Coverage Check (Beads) | AI | Verifies all in-scope PRD requirements map to beads + verification steps. | If gaps: 15. If clean: 17. |
| | 18 | PRE_FLIGHT_CHECK | Initializing Agent | AI | Verifying git status, context, and permissions. | Checks pass → Move to 19. |
| | 19 | CODING | Implementing (Bead X/Y) | AI | Executing beads in ticket worktree. | All beads marked "Done". |
| | 20 | RUNNING_FINAL_TEST | Self-Testing | AI | Running larger test created by main implementer based on ticket scope and complexity on the unsquashed ticket branch state. | Tests pass → Move to 21. |
| | 21 | INTEGRATING_CHANGES | Finalizing Code | AI | Post-test squash/finalization and release candidate preparation on the ticket branch (only after final test pass). | Candidate ready → Move to 22. |
| | 23 | CLEANING_ENV | Cleaning Up | AI | (Conditional) Removing ticket worktree and temporary resources. | Cleanup complete → Move to 24. |
| **3. NEEDS INPUT** | 05 | WAITING_INTERVIEW_ANSWERS | Interviewing (Q X/Y) | User | Waiting for user to answer questions in the adaptive interview loop. | User submits/skip batch → 06. |
| | 07 | WAITING_INTERVIEW_APPROVAL | Approving Interview | User | Waiting for user to review/edit and approve Interview Results. | User approves → 08. |
| | 12 | WAITING_PRD_APPROVAL | Approving Specs | User | Waiting for user to approve/edit PRD. | User approves → 13. |
| | 17 | WAITING_BEADS_APPROVAL | Approving Blueprint | User | Waiting for user to confirm beads breakdown. | User approves → 18. |
| | 22 | WAITING_MANUAL_VERIFICATION | Ready for Review | User | Waiting for user to manually verify. | User clicks "Complete" → final merge to `main`, then 23 or 24. |
| | Ex | BLOCKED_ERROR | Error (reason) | User | (Flashing Red) Different types of errors. | User patches and retries. |
| **4. DONE** | 24 | COMPLETED | Done | System | Ticket closed. Code in main. | N/A |
| | 25 | CANCELED | Canceled | System | If at any time during previous phases the ticket is canceled, it will arrive here. | N/A |

## 8. Technical Stack

| Layer | Technology | Why | Connects To |
| :--- | :--- | :--- | :--- |
| **Runtime** | Node.js 20+ | OpenCode SDK is Node-native; battle-tested for 24h+ processes; no compatibility risks | All backend code |
| **Backend** | Hono | Lightweight HTTP framework; works on Node/Bun/Edge; native SSE streaming | OpenCode SDK, SQLite, filesystem, React frontend |
| **Frontend** | React 19 + Vite | Component-based UI; largest library ecosystem for complex Kanban/editors. Uses DOM virtualization (e.g. `@tanstack/react-virtual`) for 10-hour log panels to prevent browser out-of-memory errors | Hono API via HTTP/SSE |
| **Styling** | Tailwind CSS + shadcn/ui | Utility-first responsive design; shadcn components are copy-paste (you own the code, not a dependency) | React components |
| **Kanban View** | CSS Grid/Flexbox | Static column layout; tickets displayed by status; no manual reordering; state changes only via ticket actions | React (reads XState status) |
| **State Machine** | XState v5 | Purpose-built for complex workflows; backend-hosted authority with persistence via SQLite snapshots (`actor.getPersistedSnapshot()`) | Hono (persist to SQLite), React (UI reads state) |
| **Server State** | TanStack Query | Data fetching and cache invalidation layer between React and Hono API/SSE | Hono API, React components |
| **UI State** | React Context | Simple store for non-workflow state (sidebar open, filters); persists to localStorage. (MVP simplicity) | React components |
| **Editor** | Structured Viewer + CodeMirror (YAML mode) | Read-only structured HTML rendering of YAML artifacts; "Edit Raw" mode uses CodeMirror with YAML syntax highlighting and validation for inline edits | React, Hono (save to YAML files) |
| **Database** | SQLite | Single-file embedded database; zero config; authoritative workflow/ticket runtime persistence plus indexed queries and recovery surfaces | Hono (via Drizzle ORM) |
| **ORM** | Drizzle | Type-safe SQL; schema-first | SQLite, Hono API routes |
| **File Format** | YAML + Beads JSONL | YAML for interview/PRD artifacts; Beads-native JSONL (`issues.jsonl`) is authoritative for bead tracker graph/status/dependencies/notes | Hono (read/write), Structured Viewer / CodeMirror (render/edit), Beads adapter |

### Architecture Diagram

```plaintext
┌─────────────────────────────────────────────────────────────────────────┐
│                               BROWSER                                   │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  React + Vite                                                     │  │
│  │  ├─ Tailwind + shadcn/ui ─── Styling for all components           │  │
│  │  ├─ Kanban View ─────────── Displays tickets by status (read-only) │  │
│  │  ├─ State Observer ──────── Reads backend status/events only      │  │
│  │  ├─ React Context ───────── UI preferences (localStorage)         │  │
│  │  └─ Structured Viewer ──── Renders/edits PRD/interview content    │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                              ↓ HTTP + SSE ↓                             │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    LOOPTROOP BACKEND (Hono on Node.js)                  │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  API Routes                                                       │  │
│  │  ├─ /api/tickets/* ─────── CRUD, XState transitions → SQLite      │  │
│  │  ├─ /api/projects/* ────── Project CRUD → SQLite + init folders   │  │
│  │  ├─ /api/files/* ───────── Ticket artifact read/write → <worktree>/.ticket/ │  │
│  │  └─ /api/stream ────────── SSE pipe: OpenCode → React             │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                              ↓                                          │
│  ┌─────────────────────────────┐  ┌──────────────────────────────────┐  │
│  │  Drizzle ORM                │  │  File System                     │  │
│  │  └─ SQLite database         │  │  └─ .looptroop/worktrees/*/.ticket/ │  │
│  │     (tickets, projects,     │  │     + per-flow .beads workspaces   │  │
│  │      state snapshots)       │  │      (authoritative bead tracker + portable artifacts)  │  │
│  └─────────────────────────────┘  └──────────────────────────────────┘  │
│                              ↓ SDK ↓                                    │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    OPENCODE SERVER (separate process)                   │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  opencode serve (port 4096)                                       │  │
│  │  ├─ @opencode-ai/sdk ────── LoopTroop calls this to send prompts  │  │
│  │  ├─ SSE events ──────────── Streams thinking/logs back            │  │
│  │  └─ LLM providers ───────── Models configured in OpenCode         │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

### Operational Constraints

- **Status field is API-protected:** The API must reject any attempt to manually set a ticket's status field — status is managed exclusively by XState transitions.
- **Workflow authority:** Ticket workflow transitions are owned by backend XState actors only. React sends command intents (`start`, `approve`, `retry`, etc.) and renders snapshots/events; it never mutates workflow state directly.
- **Bead tracker authority:** `issues.jsonl` is authoritative for bead graph, bead status, dependency links, and bead execution notes/checkpoints.
- **Workflow/ticket authority:** SQLite is authoritative for workflow phase/state transitions, XState snapshots, and query/index/recovery surfaces.
- **Derived stores only:** `.ticket/runtime/execution-log.jsonl` is audit/debug evidence; it is not authoritative for resume correctness.
- **SQLite WAL hardening (MVP):** On every SQLite connection, apply and verify: `PRAGMA journal_mode=WAL; PRAGMA locking_mode=NORMAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000; PRAGMA wal_autocheckpoint=1000;` to prevent read/write blocking and reduce lock thrashing across multiple connections. Route state-changing writes through a serialized write queue and run periodic idle `PRAGMA wal_checkpoint(PASSIVE)` (default every 30s).
- **Node.js Memory & Event Loop:** Boot Hono server with `--max-old-space-size=4096` to double the baseline memory limit for unattended runs. When updating large artifacts (e.g., `.ticket/runtime/execution-log.jsonl`, `issues.jsonl`), strictly use Streams or asynchronous iterators rather than loading entire files into memory to avoid blocking the event loop and stuttering SSE.
- **High-Frequency Stream Bypassing:** Token-by-token streaming (e.g., `assistant.message.delta`) and fast terminal outputs must bypass XState and SQLite entirely. They are piped directly from SDK to React SSE endpoint and appended to `.ticket/runtime/execution-log.jsonl` via `safeAtomicAppend`. XState/SQLite are invoked only for substantive phase checkpoints (e.g., `START_BEAD`, `BEAD_DONE`).

### Process Separation & Lifecycle

```plaintext
┌─────────────────────────────────────────────────────────────────────────┐
│                         PROCESS ARCHITECTURE                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  PROCESS 1: OpenCode Server (long-lived, independent)                   │
│  ─────────────────────────────────────────────────────────────────────  │
│  │ Started: manually by user or via LoopTroop startup script            │
│  │ Port: 4096 (configurable)                                            │
│  │ Lifecycle: Survives LoopTroop restarts                               │
│  │ State: Keeps session history, can resume conversations               │
│  │ Crash behavior: LoopTroop detects via health check, prompts restart  │
│  └──────────────────────────────────────────────────────────────────────│
│                              ↑                                          │
│                          SDK calls                                      │
│                              ↓                                          │
│  PROCESS 2: LoopTroop Backend (orchestrator)                            │
│  ─────────────────────────────────────────────────────────────────────  │
│  │ Started: node server.js                                              │
│  │ Port: 3000 (configurable)                                            │
│  │ Lifecycle: Can restart without losing progress                       │
│  │ State: Persisted to SQLite; hydrates on startup                      │
│  │ Crash behavior: XState resumes from SQLite; SDK reconnects           │
│  └──────────────────────────────────────────────────────────────────────│
│                              ↑                                          │
│                          HTTP + SSE                                     │
│                              ↓                                          │
│  PROCESS 3: Browser (UI, ephemeral)                                     │
│  ─────────────────────────────────────────────────────────────────────  │
│  │ Started: user opens localhost:3000                                   │
│  │ Lifecycle: Can close and reopen anytime                              │
│  │ State: React Context persists UI prefs to localStorage               │
│  │ Close behavior: Backend continues; UI catches up on reopen           │
│  └──────────────────────────────────────────────────────────────────────│
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Data Flow Summary

The key runtime data flow pattern is:

```
User action → React → Hono API → XState event → XState validates transition
→ Authoritative persist (SQLite + issues.jsonl when applicable) → SSE broadcast → React updates
```

For AI-driven states: `XState invoke → OpenCodeAdapter → SDK → OpenCode server → SSE stream → React log panel`. Browser can close/reopen at any time; backend continues and UI catches up on reconnect.

## 9. Component Integration Details

### 1. React ↔ Hono (Frontend ↔ Backend)
**Connection type:** HTTP REST + SSE

```javascript
React component calls:     fetch('/api/tickets/PROJ-1')
Hono responds:             { id, title, status: "CODING", currentBead: 5, totalBeads: 12 }

React opens SSE:           EventSource('/api/stream?ticketId=PROJ-1')
Hono pipes:                OpenCode logs → SSE → React updates log panel in real-time
```

### 2. XState ↔ SQLite (State Machine ↔ Persistence)
**Connection type:** Backend-hosted XState actors persist snapshots to SQLite `tickets.xstate_snapshot` column

```javascript
User clicks "Start" →
  React: POST /api/tickets/PROJ-1/start →
  Hono: ticketMachine.send({ type: 'START' }) →
  Backend XState: transition(DRAFT → COUNCIL_DELIBERATING) →
  Backend XState: onTransition callback →
  Drizzle: UPDATE tickets SET xstate_snapshot = ? WHERE id = ?
```

### 3. TanStack Query ↔ Hono (Server State Management)
**Connection type:** TanStack Query as data fetching layer between React and Hono API/SSE

```javascript
React component:
  const { data: ticket } = useQuery({ queryKey: ['ticket', id], queryFn: () => fetch(`/api/tickets/${id}`) })

SSE event arrives (state_change) →
  queryClient.invalidateQueries({ queryKey: ['ticket', id] })
  → TanStack refetches → component re-renders with new state
```

### 4. XState ↔ OpenCode SDK (State Machine ↔ AI Execution)
**Connection type:** XState invokes OpenCode SDK via OpenCodeAdapter when entering AI-driven states

```javascript
XState enters COUNCIL_DELIBERATING →
  XState invokes: openCodeActor.send({ type: 'GENERATE_QUESTIONS', context: buildMinimalContext('interview_draft', ticketState) }) →
  openCodeActor internally: create fresh session for this phase attempt + sdk.session.prompt(...) →
  OpenCode streams chunks via SSE →
  openCodeActor emits: { type: 'QUESTIONS_READY', questions: [...] } →
  XState transitions: COUNCIL_DELIBERATING → COUNCIL_VOTING_INTERVIEW
```

### 5. Structured Viewer + CodeMirror ↔ YAML Files (Editor ↔ File Storage)
**Connection type:** Read-only structured HTML rendering of YAML; "Edit Raw" mode uses CodeMirror with YAML syntax highlighting and validation

```javascript
User opens ticket in WAITING_PRD_APPROVAL state →
  React: fetch('/api/files/PROJ-1/prd') →
  Hono: fs.readFile('<worktree>/.ticket/prd.yaml') →
  React: parse YAML → render as structured HTML (collapsible sections, color-coded)

User clicks "Edit Raw" →
  React: load YAML string into CodeMirror editor (YAML mode + validation)

User edits and saves →
  CodeMirror: validate YAML syntax → if valid, extract string →
  React: PUT /api/files/PROJ-1/prd { content: yamlString } →
  Hono: safeAtomicWrite('<worktree>/PROJ-1/.ticket/prd.yaml', yamlString) + update SQLite index
```

### 6. Kanban View ↔ XState (Display ↔ State)
Kanban reads XState status; state changes only via ticket actions (see Kanban Interaction Model in §5.1).

### 7. SQLite ↔ YAML/JSONL Files (Database ↔ File System)
**Connection type:** SQLite stores authoritative workflow/ticket runtime state; `issues.jsonl` stores authoritative bead tracker data; YAML artifacts are portable planning/output files

```javascript
On ticket creation:
  Hono: ensure .looptroop/worktrees/<ticket-id>/.ticket/meta/ exists
  Hono: INSERT INTO tickets (...) + write .looptroop/worktrees/<ticket-id>/.ticket/meta/ticket.meta.json
  Hono: (no source/artifact files created yet)

On ticket start (first transition out of DRAFT):
  Hono: materialize/attach git worktree at .looptroop/worktrees/<ticket-id>/ -b <ticket-id> (preserve .ticket/meta)
  Hono: create .ticket/ + .ticket/beads/main/.beads/ + .ticket/runtime/ + .ticket/.gitignore runtime denylist
  Hono: generate .ticket/codebase-map.yaml
  Hono: UPDATE tickets SET status = ?, started_at = ?

On file update (interview answer):
  Hono: read <worktree-path>/.ticket/interview.yaml
  Hono: add answer → safeAtomicWrite(<worktree-path>/.ticket/interview.yaml, updatedYaml)
  Hono: UPDATE tickets SET last_question = ?, answers_count = ?

On app startup (recovery):
  Hono: query non-terminal tickets + snapshots from SQLite (authoritative workflow/ticket runtime)
    → hydrate backend XState actors from SQLite snapshots
    → load active .beads/issues.jsonl per flow (authoritative bead tracker runtime)
    → do not write workflow transition state back into SQLite from YAML artifact files
    → do not overwrite issues.jsonl bead tracker state from SQLite/index projections
```

### 8. Hono ↔ OpenCode SDK (Backend ↔ AI Server)
**Connection type:** HTTP + SSE via @opencode-ai/sdk. OpenCode runs as a separate process (`opencode serve` on port 4096).

```javascript
LoopTroop starts →
  Hono: create SDK client (connects to localhost:4096)
  Hono: sdk.session.list() → get existing sessions (for crash recovery)

Start council deliberation →
  Hono: sdk.session.create({ path: projectFolder }) // one fresh session per member for this phase attempt
  Hono: sdk.session.prompt({ path: { id: sessionId }, body: { parts: [...] } })
  SDK: streams SSE events (assistant.thinking, assistant.message.delta, etc.)
  Hono: forwards events to React via /api/stream SSE

Start bead execution attempt →
  Hono: sdk.session.create({ path: projectFolder }) // one fresh session per (bead_id, iteration)
  Hono: sdk.session.prompt({ path: { id: sessionId }, body: { parts: [currentBeadContext, notes] } })

On restart →
  Validate session ownership for active attempt
  If valid: reattach with session.messages() + event.subscribe()
  If invalid/missing: create replacement fresh session and continue from artifacts
```

### 9. React Context ↔ React Components (UI State ↔ Views)
**Connection type:** React hooks subscribe to Context/local state. XState handles workflow state; React Context handles UI state (sidebar, filters, selected ticket).

```javascript
Context store:
  {
    selectedTicketId: 'PROJ-1',
    sidebarCollapsed: false,
    logPanelHeight: 300,
    todoColumnVisible: false,
    doneColumnVisible: false,
  }

React sidebar component:
  const { sidebarCollapsed, toggleSidebar } = useUIContext()
  <button onClick={toggleSidebar}>Toggle</button>

Context effect:
  persist to localStorage → UI preferences survive browser refresh
```

### 10. OpenCodeAdapter (SDK Abstraction Layer)
**Connection type:** TypeScript interface wrapping all `@opencode-ai/sdk` calls. Also assembles context data in-code from authoritative stores when constructing prompts.

```typescript
interface OpenCodeAdapter {
  createSession(projectPath: string): Promise<Session>
  promptSession(sessionId: string, parts: PromptPart[]): AsyncIterable<StreamEvent>
  listSessions(): Promise<Session[]>
  getSessionMessages(sessionId: string): Promise<Message[]>
  subscribeToEvents(sessionId: string): AsyncIterable<StreamEvent>
  assembleBeadContext(ticketId: string, beadId: string): Promise<PromptPart[]>
  assembleCouncilContext(ticketId: string, phase: string): Promise<PromptPart[]>
  checkHealth(): Promise<HealthStatus>
}
```
**Rules:** All XState actors call the adapter, never the raw SDK. Session ownership is tracked in the SQLite `opencode_sessions` table.

## 10. XState Machine Structure

```plaintext
┌─────────────────────────────────────────────────────────────────────────┐
│                         XSTATE MACHINE STRUCTURE                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ticketMachine                                                          │
│  ├─ context: { ticketId, projectPath, currentBead, totalBeads, ... }    │
│  │                                                                      │
│  ├─ states:                                                             │
│  │                                                                      │
│  │   ── TO DO column ─────────────────────────────────────────────────  │
│  │   ├─ 01 DRAFT                                                        │
│  │   │   └─ on: { START: 'COUNCIL_DELIBERATING' }                       │
│  │   │   └─ on: { CANCEL: 'CANCELED' }                                  │
│  │   │                                                                   │
│  │   ── IN PROGRESS column (Interview) ──────────────────────────────── │
│  │   ├─ 02 COUNCIL_DELIBERATING                                         │
│  │   │   └─ invoke: generateQuestionsActor                              │
│  │   │   └─ on: { QUESTIONS_READY: 'COUNCIL_VOTING_INTERVIEW' }         │
│  │   │   └─ on: { CANCEL: 'CANCELED' }                                  │
│  │   ├─ 03 COUNCIL_VOTING_INTERVIEW                                     │
│  │   │   └─ invoke: votingActor                                         │
│  │   │   └─ on: { WINNER_SELECTED: 'COMPILING_INTERVIEW' }              │
│  │   │   └─ on: { CANCEL: 'CANCELED' }                                  │
│  │   ├─ 04 COMPILING_INTERVIEW                                          │
│  │   │   └─ invoke: compileQuestionsActor                               │
│  │   │   └─ on: { READY: 'WAITING_INTERVIEW_ANSWERS' }                  │
│  │   │   └─ on: { CANCEL: 'CANCELED' }                                  │
│  │   ├─ 06 VERIFYING_INTERVIEW_COVERAGE                                 │
│  │   │   └─ invoke: verifyCoverageActor                                 │
│  │   │   └─ on: { GAPS_FOUND: 'WAITING_INTERVIEW_ANSWERS' }             │
│  │   │   └─ on: { COVERAGE_CLEAN: 'WAITING_INTERVIEW_APPROVAL' }        │
│  │   │   └─ on: { CANCEL: 'CANCELED' }                                  │
│  │   │                                                                   │
│  │   ── IN PROGRESS column (PRD) ────────────────────────────────────── │
│  │   ├─ 08 DRAFTING_PRD                                                 │
│  │   │   └─ invoke: draftPrdActor                                       │
│  │   │   └─ on: { DRAFTS_READY: 'COUNCIL_VOTING_PRD' }                  │
│  │   │   └─ on: { CANCEL: 'CANCELED' }                                  │
│  │   ├─ 09 COUNCIL_VOTING_PRD                                           │
│  │   │   └─ invoke: votingActor                                         │
│  │   │   └─ on: { WINNER_SELECTED: 'REFINING_PRD' }                     │
│  │   │   └─ on: { CANCEL: 'CANCELED' }                                  │
│  │   ├─ 10 REFINING_PRD                                                 │
│  │   │   └─ invoke: refinePrdActor                                      │
│  │   │   └─ on: { REFINED: 'VERIFYING_PRD_COVERAGE' }                   │
│  │   │   └─ on: { CANCEL: 'CANCELED' }                                  │
│  │   ├─ 11 VERIFYING_PRD_COVERAGE                                       │
│  │   │   └─ invoke: verifyCoverageActor                                 │
│  │   │   └─ on: { GAPS_FOUND: 'REFINING_PRD' }                          │
│  │   │   └─ on: { COVERAGE_CLEAN: 'WAITING_PRD_APPROVAL' }              │
│  │   │   └─ on: { CANCEL: 'CANCELED' }                                  │
│  │   │                                                                   │
│  │   ── IN PROGRESS column (Beads) ──────────────────────────────────── │
│  │   ├─ 13 DRAFTING_BEADS                                               │
│  │   │   └─ invoke: draftBeadsActor                                     │
│  │   │   └─ on: { DRAFTS_READY: 'COUNCIL_VOTING_BEADS' }                │
│  │   │   └─ on: { CANCEL: 'CANCELED' }                                  │
│  │   ├─ 14 COUNCIL_VOTING_BEADS                                         │
│  │   │   └─ invoke: votingActor                                         │
│  │   │   └─ on: { WINNER_SELECTED: 'REFINING_BEADS' }                   │
│  │   │   └─ on: { CANCEL: 'CANCELED' }                                  │
│  │   ├─ 15 REFINING_BEADS                                               │
│  │   │   └─ invoke: refineBeadsActor                                    │
│  │   │   └─ on: { REFINED: 'VERIFYING_BEADS_COVERAGE' }                 │
│  │   │   └─ on: { CANCEL: 'CANCELED' }                                  │
│  │   ├─ 16 VERIFYING_BEADS_COVERAGE                                     │
│  │   │   └─ invoke: verifyCoverageActor                                 │
│  │   │   └─ on: { GAPS_FOUND: 'REFINING_BEADS' }                        │
│  │   │   └─ on: { COVERAGE_CLEAN: 'WAITING_BEADS_APPROVAL' }            │
│  │   │   └─ on: { CANCEL: 'CANCELED' }                                  │
│  │   │                                                                   │
│  │   ── IN PROGRESS column (Execution) ──────────────────────────────── │
│  │   ├─ 18 PRE_FLIGHT_CHECK                                             │
│  │   │   └─ invoke: preFlightActor                                      │
│  │   │       guard: gitClean && openCodeResponding                      │
│  │   │   └─ on: { CHECKS_PASSED: 'CODING' }                             │
│  │   │   └─ on: { CHECKS_FAILED: 'BLOCKED_ERROR' }                      │
│  │   │   └─ on: { CANCEL: 'CANCELED' }                                  │
│  │   ├─ 19 CODING                                                       │
│  │   │   └─ invoke: beadExecutor (ralph loop per bead)                  │
│  │   │   └─ on: { ALL_BEADS_DONE: 'RUNNING_FINAL_TEST' }                │
│  │   │   └─ on: { BEAD_ERROR: 'BLOCKED_ERROR' }                         │
│  │   │   └─ on: { CANCEL: 'CANCELED' }                                  │
│  │   ├─ 20 RUNNING_FINAL_TEST                                           │
│  │   │   └─ invoke: finalTestActor (run on unsquashed bead-commit branch state) │
│  │   │   └─ on: { TESTS_PASSED: 'INTEGRATING_CHANGES' }                 │
│  │   │   └─ on: { TESTS_FAILED: 'BLOCKED_ERROR' }                       │
│  │   │   └─ on: { CANCEL: 'CANCELED' }                                  │
│  │   ├─ 21 INTEGRATING_CHANGES                                          │
│  │   │   └─ invoke: integrationActor (post-test squash + candidate preparation on ticket branch) │
│  │   │   └─ on: { INTEGRATION_DONE: 'WAITING_MANUAL_VERIFICATION' }     │
│  │   │   └─ on: { CANCEL: 'CANCELED' }                                  │
│  │   ├─ 23 CLEANING_ENV                                                  │
│  │   │   └─ invoke: cleanupActor                                        │
│  │   │   └─ on: { CLEANUP_DONE: 'COMPLETED' }                           │
│  │   │                                                                   │
│  │   ── NEEDS INPUT column ──────────────────────────────────────────── │
│  │   ├─ 05 WAITING_INTERVIEW_ANSWERS                                    │
│  │   │   └─ on: { ANSWER_SUBMITTED: 'VERIFYING_INTERVIEW_COVERAGE' }    │
│  │   │   └─ on: { SKIP: 'VERIFYING_INTERVIEW_COVERAGE' }                │
│  │   │   └─ on: { CANCEL: 'CANCELED' }                                  │
│  │   ├─ 07 WAITING_INTERVIEW_APPROVAL                                   │
│  │   │   └─ on: { APPROVE: 'DRAFTING_PRD' }                             │
│  │   │   └─ on: { CANCEL: 'CANCELED' }                                  │
│  │   ├─ 12 WAITING_PRD_APPROVAL                                         │
│  │   │   └─ on: { APPROVE: 'DRAFTING_BEADS' }                           │
│  │   │   └─ on: { CANCEL: 'CANCELED' }                                  │
│  │   ├─ 17 WAITING_BEADS_APPROVAL                                       │
│  │   │   └─ on: { APPROVE: 'PRE_FLIGHT_CHECK' }                         │
│  │   │   └─ on: { CANCEL: 'CANCELED' }                                  │
│  │   ├─ 22 WAITING_MANUAL_VERIFICATION                                  │
│  │   │   └─ on: { VERIFY_COMPLETE: 'CLEANING_ENV' } + action: finalMergeToMain  ← cleanup optional; if skipped → COMPLETED │
│  │   │   └─ on: { CANCEL: 'CANCELED' }                                  │
│  │   ├─ Ex BLOCKED_ERROR                                                 │
│  │   │   └─ on: { RETRY: <previous state> }                             │
│  │   │   └─ on: { CANCEL: 'CANCELED' }                                  │
│  │   │                                                                   │
│  │   ── DONE column ─────────────────────────────────────────────────── │
│  │   ├─ 24 COMPLETED (terminal)                                         │
│  │   └─ 25 CANCELED (terminal)                                          │
│  │                                                                      │
│  ├─ actions:                                                            │
│  │   ├─ persistState: save workflow/ticket transition state to SQLite (authoritative, first) │
│  │   ├─ persistBeadsTracker: write bead graph/status/notes updates to `.beads/issues.jsonl` (authoritative when tracker mutates) │
│  │   ├─ notifyFrontend: emit event for SSE broadcast (after authoritative persists) │
│  │   ├─ gitCommitAndPush: after bead completion (allowlist git add + commit + push) │
│  │   └─ finalMergeToMain: after VERIFY_COMPLETE (merge ticket branch into main) │
│  │                                                                      │
│  └─ actors:                                                             │
│      ├─ openCodeActor: uses OpenCodeAdapter interface to wrap SDK calls  │
│      ├─ votingActor: council deliberation + scoring logic               │
│      ├─ verifyCoverageActor: coverage verification pass                 │
│      ├─ beadExecutor: ralph loop for single bead                        │
│      ├─ preFlightActor: git clean + OpenCode health check               │
│      └─ cleanupActor: remove temporary branches/worktrees (optional, default yes) │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**XState event-to-action mapping:**

| XState Event | Triggers | Target |
| :--- | :--- | :--- |
| entry action on any state | persistState | SQLite via Drizzle (authoritative workflow/ticket runtime) |
| Bead graph/status/dependency/notes mutation | persistBeadsTracker | `.ticket/beads/<flow-id>/.beads/issues.jsonl` (authoritative bead tracker runtime) |
| entry action on AI states | invokeOpenCode | OpenCode SDK via OpenCodeAdapter |
| exit action on bead states | gitCommitAndPush | Git CLI (allowlist add + commit + push) |
| Any transition after authoritative persists | notifyFrontend | SSE → React |
| User clicks Start | START event | DRAFT → COUNCIL_DELIBERATING (SYS runs idempotent lazy initialization: worktree/branch/.ticket/.gitignore + codebase-map generation before first council call) |
| User submits answer | ANSWER_SUBMITTED event | WAITING_INTERVIEW_ANSWERS → VERIFYING_INTERVIEW_COVERAGE |
| User approves PRD | APPROVE event | WAITING_PRD_APPROVAL → DRAFTING_BEADS |
| User approves beads | APPROVE event | WAITING_BEADS_APPROVAL → PRE_FLIGHT_CHECK |
| User completes verification | VERIFY_COMPLETE event | WAITING_MANUAL_VERIFICATION → final merge to `main` → CLEANING_ENV |
| User cancels | CANCEL event | Any → CANCELED |
| User retries | RETRY event | BLOCKED_ERROR → retry previous state |
| Error in actor | ERROR event | Current → BLOCKED_ERROR |
| Coverage gaps found | GAPS_FOUND event | VERIFYING_*_COVERAGE → loop back to refinement |

## 11. File Structures & Data Stores

### Artifact Files

**1) interview.yaml** — Schema defined in the Prompt Catalog under PROM5 `output_file`.

**2) prd.yaml** — Schema defined in the Prompt Catalog under PROM13 `output_file`.

**3) codebase-map.yaml**
```yaml
schema_version: 1
ticket_id: "PROJ-1"
artifact: "codebase_map"
generated_by: "SYS"
generated_at: "2026-02-06T14:58:00Z"
source:
  root: "."
  ignore:
    - ".git/"
    - "node_modules/"
    - ".venv/"
    - ".pytest_cache/"
summary:
  total_files: 128
  by_language:
    TypeScript: 44
    Markdown: 9
    YAML: 6
manifests:
  - "package.json"
  - "pyproject.toml"
files:
  - "src/auth/LoginForm.tsx"
  - "src/auth/useAuth.ts"
```

MVP generation rules:
- Trigger: SYS creates this file when ticket state transitions `DRAFT -> COUNCIL_DELIBERATING` (user clicks Start).
- Scope: read-only scan of the active ticket worktree.
- Paths-only map: include file paths only (no directory entries).
- Stack-agnostic discovery: include known manifests/config files when present (for example `package.json`, `pyproject.toml`, `requirements.txt`, `go.mod`, `Cargo.toml`), but map generation does not depend on any single ecosystem.

**4) Beads (per-ticket, per-flow)**

- Canonical location: `<worktree>/.ticket/beads/<flow-id>/.beads/issues.jsonl`
- Beads dependency/task graph is Beads-native JSONL (not `beads.yaml`).
- `issues.jsonl` is the authoritative bead tracker store for graph/status/dependency/notes/checkpoint fields.

**Bead fields** (each line in `issues.jsonl` is a JSON object with these fields):

| # | Field | Type | Description |
| :--- | :--- | :--- | :--- |
| 1 | `id` | string | Unique bead ID composed of hierarchical path plus short 4 character suffix hash (e.g. `PROJ-1-EPIC-1-US-1-task4-sub1-h3fa`) |
| 2 | `title` | string | Short name of the task (e.g. "Implement login error state") |
| 3 | `priority` | integer | Numeric execution priority (determines sequential order) |
| 4 | `status` | string | `pending` → `in_progress` → `done` / `error` |
| 5 | `issue_type` | string | `"task"`, `"bug"`, `"chore"`, etc. (included for future use) |
| 6 | `external_ref` | string | Parent ticket ID (e.g. `PROJ-1`) |
| 7 | `prd_references` | string | Summary of Epic and User Story this bead maps to. If there are multiple beads in a user story, a summary is provided of what the other beads in the user story will do |
| 8 | `labels` | string[] | Must map to at least one user story and epic (e.g. `["ticket:PROJ-1", "epic:EPIC-1", "story:US-1"]`) |
| 9 | `description` | string | Detailed technical implementation steps — a very small unit of action with technical details |
| 10 | `context_guidance` | object | Context & Architectural Guidance (Context Engineering) — explicit constraints copied from the Architecture/PRD. Must include `patterns` (specific patterns to follow, e.g. "Use the `AppError` class for exceptions," "Follow the Container/Presenter pattern defined in `src/components`") and `anti_patterns` (anti-patterns to avoid for this specific task) |
| 11 | `acceptance_criteria` | string | Human-readable definition of done (e.g. "Show non-blocking inline message on invalid credentials") |
| 12 | `dependencies` | object | Two arrays defining dependency relationships: `blocked_by` (bead IDs that must complete before this bead can start) and `blocks` (bead IDs that cannot start until this bead completes) |
| 13 | `target_files` | string[] | Name and path of files explicitly targeted by the bead (only necessary ones, to reduce context size) |
| 14 | `tests` | string[] | Bead-scoped tests — unit tests, integration tests, etc. Only these tests determine if the bead passes (not the full project test suite) |
| 15 | `test_commands` | string[] | Exact commands to run the bead-scoped tests (e.g. `["npm test -- --grep \"login error\"", "npx eslint src/auth/"]`) |
| 16 | `notes` | string | Append-only. Errors and learnings from previous attempts. Empty on first attempt. Each failed attempt appends its own details until max iterations reached |
| 17 | `iteration` | integer | Starts at 1, incremented on each retry (context wipe). Used to track how many attempts have been made on this bead |
| 18 | `created_at` | ISO 8601 | Timestamp of bead creation |
| 19 | `updated_at` | ISO 8601 | Timestamp of last update |
| 20 | `completed_at` | ISO 8601 | Timestamp when status is set to `done` (empty during planning) |
| 21 | `started_at` | ISO 8601 | Timestamp when status is set to `in_progress` (filled by SYS at runtime; empty during planning) |
| 22 | `bead_start_commit` | string | Git commit SHA recorded by SYS when the bead begins execution; used to reset the worktree on context wipe (`git reset --hard`). Empty during planning |

Example issue line — see PROM24 `output_file.example` in the Prompt Catalog for a complete JSONL example with all 22 fields.

**5) .ticket/runtime/execution-log.jsonl**
- Append-only operational log for reproducibility and recovery.
- One JSON object per event (`state_change`, `model_output`, `test_result`, `error`, `bead_complete`).
- Audit/debug evidence only (non-authoritative for workflow/bead-tracker state recovery).

### File Ownership

| File | Written By | Read By |
| :--- | :--- | :--- |
| **`<worktree>/.ticket/interview.yaml`** | Council phase → OpenCode; User answers → Hono | Structured Viewer / CodeMirror, PRD phase, XState context |
| **`<worktree>/.ticket/prd.yaml`** | PRD phase → OpenCode; User edits → Hono | Structured Viewer / CodeMirror, Beads phase |
| **`<worktree>/.ticket/codebase-map.yaml`** | SYS at ticket START (deterministic mapper) | Interview/PRD/Beads council phases |
| **`<worktree>/.ticket/beads/<flow-id>/.beads/issues.jsonl`** | Beads phase + execution loop | Authoritative bead tracker source for XState progress, UI progress, retry/resume logic |
| **`<worktree>/.ticket/runtime/state.yaml`** | SYS projection writer | UI/SSE projection fan-out (derived, non-authoritative) |
| **`<worktree>/.ticket/runtime/execution-log.jsonl`** | Execution loop + test runner wrapper | Debugging, audit, and replay assistance (non-authoritative) |

**Authority summary**
- `issues.jsonl`: authoritative bead tracker data.
- SQLite: authoritative workflow/ticket runtime state + query/index/recovery surfaces.
- `.ticket/runtime/state.yaml`: rebuildable projection cache (non-authoritative).
- `.ticket/runtime/execution-log.jsonl`: audit log (non-authoritative).

## 12. Database Schema (Drizzle)

```plaintext
┌─────────────────────────────────────────────────────────────────────────┐
│                          SQLITE SCHEMA                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  profiles                             ← User configuration (global defaults) │
│  ├─ id: INTEGER PRIMARY KEY                                             │
│  ├─ username: TEXT                                                      │
│  ├─ icon: TEXT                        ← Optional                        │
│  ├─ background: TEXT                  ← "Senior SWE", "PM", etc.        │
│  ├─ main_implementer: TEXT            ← Default model for coding        │
│  ├─ council_members: TEXT (JSON)      ← Default: array of model IDs (up to 4 in MVP; 10 later) │
│  ├─ max_iterations: INTEGER           ← Default: 5 (per bead retry limit)  │
│  ├─ per_iteration_timeout: INTEGER    ← Default: 20 (minutes; iteration timeout) │
│  ├─ council_response_timeout: INTEGER ← Default: 15 (minutes; council member timeout) │
│  ├─ min_council_quorum: INTEGER       ← Default: 2 (minimum valid council responses) │
│  ├─ interview_questions: INTEGER      ← Default: 50 (max initial questions) │
│  └─ disable_analogies: INTEGER        ← Default: 0 (boolean; disable analogies for non-technical users) │
│                                                                         │
│  projects                             ← Project records                 │
│  ├─ id: INTEGER PRIMARY KEY                                             │
│  ├─ name: TEXT                                                          │
│  ├─ shortname: TEXT                   ← 3-5 letters, e.g. "PROJ"      │
│  ├─ icon: TEXT                        ← Optional                        │
│  ├─ folder_path: TEXT                 ← Absolute path to project        │
│  ├─ color: TEXT                       ← Ticket border color (32 options; red and yellow excluded) │
│  ├─ ticket_counter: INTEGER           ← Next ticket number (auto-increment) │
│  ├─ council_members: TEXT (JSON)      ← NULL = use profile default      │
│  ├─ max_iterations: INTEGER           ← NULL = use profile default      │
│  ├─ per_iteration_timeout: INTEGER    ← NULL = use profile default      │
│  ├─ council_response_timeout: INTEGER ← NULL = use profile default      │
│  ├─ min_council_quorum: INTEGER       ← NULL = use profile default      │
│  ├─ interview_questions: INTEGER      ← NULL = use profile default      │
│  ├─ created_at: TIMESTAMP                                               │
│  └─ profile_id: INTEGER FK                                              │
│                                                                         │
│  tickets                              ← Ticket records                  │
│  ├─ id: INTEGER PRIMARY KEY                                             │
│  ├─ external_id: TEXT                 ← "PROJ-1", auto-generated        │
│  ├─ project_id: INTEGER FK                                              │
│  ├─ title: TEXT                                                         │
│  ├─ description: TEXT                                                   │
│  ├─ priority: INTEGER                 ← 1=Very High, 2=High, 3=Normal, 4=Low, 5=Very Low │
│  ├─ status: TEXT                      ← Current XState state            │
│  ├─ branch_name: TEXT                 ← Git branch (created lazily on first Start from ticket ID) │
│  ├─ xstate_snapshot: TEXT             ← Serialized XState snapshot (actor.getPersistedSnapshot()) │
│  ├─ current_bead: INTEGER                                               │
│  ├─ total_beads: INTEGER                                                │
│  ├─ percent_complete: REAL                                              │
│  ├─ error_message: TEXT               ← If in BLOCKED_ERROR             │
│  ├─ created_at: TIMESTAMP                                               │
│  ├─ started_at: TIMESTAMP            ← When ticket moved from To Do     │
│  ├─ planned_date: TIMESTAMP          ← Estimated completion date        │
│  └─ updated_at: TIMESTAMP                                               │
│                                                                         │
│  opencode_sessions                    ← OpenCode session ownership tracking │
│  ├─ id: INTEGER PRIMARY KEY                                             │
│  ├─ ticket_id: INTEGER FK                                               │
│  ├─ phase: TEXT                       ← interview_draft | interview_vote | ... | execution │
│  ├─ phase_attempt: INTEGER                                              │
│  ├─ member_id: TEXT                   ← AIC member ID (nullable, council only) │
│  ├─ bead_id: TEXT                     ← Bead ID (nullable, execution only) │
│  ├─ iteration: INTEGER                ← Bead iteration (nullable, execution only) │
│  ├─ session_id: TEXT                  ← OpenCode session ID             │
│  ├─ state: TEXT                       ← active | closed | replaced      │
│  ├─ last_event_id: TEXT               ← For SSE resume                  │
│  ├─ last_event_at: TIMESTAMP                                            │
│  └─ created_at: TIMESTAMP                                               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Storage responsibility:**

| Need | Solution |
| :--- | :--- |
| **Fast queries ("list all tickets")** | SQLite with indexed columns |
| **Human-readable files** | YAML artifacts in `.ticket/` inside each ticket worktree + Beads JSONL in ticket flow workspaces |
| **Portable data** | Ticket artifacts and Beads workspaces travel with the project folder |
| **Authoritative bead tracker state** | `issues.jsonl` (JSONL-first mutations, git-trackable) |
| **Workflow/ticket crash recovery** | SQLite XState snapshot (on `tickets.xstate_snapshot`) + `issues.jsonl` tracker reload |
| **Session ownership tracking** | SQLite `opencode_sessions` table (authoritative, WAL-durable) |
| **Git-friendly** | YAML + `issues.jsonl` can be committed |

## 13. SSE Event Protocol

```plaintext
┌─────────────────────────────────────────────────────────────────────────┐
│                          SSE EVENT PROTOCOL                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Client connects:                                                       │
│  GET /api/stream?ticketId=PROJ-1                                        │
│  Accept: text/event-stream                                              │
│                                                                         │
│  Server sends events:                                                   │
│                                                                         │
│  event: state_change                                                    │
│  data: {"ticketId":"PROJ-1","from":"CODING","to":"RUNNING_FINAL_TEST"}  │
│                                                                         │
│  event: log                                                             │
│  data: {"ticketId":"PROJ-1","type":"thinking","content":"Analyzing..."} │
│                                                                         │
│  event: progress                                                        │
│  data: {"ticketId":"PROJ-1","bead":5,"total":12,"percent":41.6}         │
│                                                                         │
│  event: error                                                           │
│  data: {"ticketId":"PROJ-1","message":"Model timeout","recoverable":true}│
│                                                                         │
│  event: bead_complete                                                   │
│  data: {"ticketId":"PROJ-1","beadId":5,"attempts":2}                    │
│                                                                         │
│  event: needs_input                                                     │
│  data: {"ticketId":"PROJ-1","type":"interview","questionIndex":3}       │
│                                                                         │
│  Reconnection:                                                          │
│  Client sends: Last-Event-ID: 12345                                     │
│  Server replays missed events from that ID                              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## 14. API Routes

```plaintext
┌─────────────────────────────────────────────────────────────────────────┐
│                          HONO API ROUTES                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  PROFILES                                                               │
│  ├─ GET    /api/profile             ← Get current profile               │
│  ├─ POST   /api/profile             ← Create profile (first run)        │
│  └─ PATCH  /api/profile             ← Update settings                   │
│                                                                         │
│  PROJECTS                                                               │
│  ├─ GET    /api/projects            ← List all projects                 │
│  ├─ POST   /api/projects            ← Create project (init .looptroop)  │
│  ├─ GET    /api/projects/:id        ← Get project details               │
│  ├─ PATCH  /api/projects/:id        ← Update name/icon/color            │
│  └─ DELETE /api/projects/:id        ← Remove project                    │
│                                                                         │
│  TICKETS                                                                │
│  ├─ GET    /api/tickets             ← List all (for Kanban)             │
│  ├─ GET    /api/tickets?project=X   ← List by project                   │
│  ├─ POST   /api/tickets             ← Create ticket                     │
│  ├─ GET    /api/tickets/:id         ← Get ticket details                │
│  ├─ PATCH  /api/tickets/:id         ← Update title/priority             │
│  ├─ POST   /api/tickets/:id/start   ← Start execution (XState)          │
│  ├─ POST   /api/tickets/:id/cancel  ← Cancel ticket (XState)            │
│  └─ POST   /api/tickets/:id/retry   ← Retry from error (XState)         │
│                                                                         │
│  FILES                                                                  │
│  ├─ GET    /api/files/:ticketId/:file     ← Read ticket artifact file   │
│  └─ PUT    /api/files/:ticketId/:file     ← Write ticket artifact file  │
│      (file = interview | prd)                                          │
│                                                                         │
│  BEADS (FLOW-AWARE)                                                     │
│  ├─ GET    /api/tickets/:id/beads?flow=main   ← Read Beads projection   │
│  └─ PUT    /api/tickets/:id/beads?flow=main   ← Update Beads workspace  │
│                                                                         │
│  WORKFLOW (XState transitions via HTTP)                                 │
│  ├─ POST   /api/tickets/:id/answer              ← Submit interview answer     │
│  ├─ POST   /api/tickets/:id/skip                ← Skip question               │
│  ├─ POST   /api/tickets/:id/approve-interview   ← Approve interview results   │
│  ├─ POST   /api/tickets/:id/approve-prd         ← Approve PRD                 │
│  ├─ POST   /api/tickets/:id/approve-beads       ← Approve beads               │
│  └─ POST   /api/tickets/:id/verify              ← Complete manual verification│
│                                                                         │
│  STREAMING                                                              │
│  └─ GET    /api/stream?ticketId=X    ← SSE connection for real-time     │
│                                                                         │
│  HEALTH                                                                 │
│  ├─ GET    /api/health               ← LoopTroop status                 │
│  └─ GET    /api/health/opencode      ← OpenCode server status           │
│                                                                         │
│  MODELS (via OpenCode SDK)                                              │
│  └─ GET    /api/models               ← List available models            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## 15. Error Handling Strategy

| Error Type | Detection | Response | Recovery Path |
| :--- | :--- | :--- | :--- |
| **Doctor: critical failure** | Any critical check fails in pre-flight | BLOCKED_ERROR with failure codes + remediation text | User fixes and retries |
| **Doctor: warnings only** | Non-critical issues in pre-flight | Allow start only after explicit user confirmation | User acknowledges or fixes |
| **OpenCode unreachable** | Connectivity check fails | Block START; show failure code + remediation | User starts OpenCode and retries |
| **Model timeout** | No response within `council_response_timeout` | Mark member `timed_out`; proceed if quorum met; else BLOCKED_ERROR | Retry with same or fallback model |
| **Model invalid output** | Malformed or fails schema validation | Mark member `invalid_output`; proceed if quorum met | Retry or replace model |
| **Model rate limit** | 429 response | Pause, retry after delay | Automatic backoff |
| **YAML parse error** | Invalid YAML syntax | Reject save; show error | User fixes in CodeMirror editor |
| **Git conflict** | Merge fails | XState → BLOCKED_ERROR | AI attempts resolution; else manual |
| **SQLite locked** | Concurrent write | Retry with backoff after `busy_timeout` | Automatic (`busy_timeout=5000` + WAL mode prevents most) |
| **Browser disconnects** | SSE close event | None (backend continues) | Client reconnects; catches up |
| **Authoritative persistence failure** | SQLite transition write or `issues.jsonl` tracker write fails | Retry ×3; circuit-breaker → BLOCKED_ERROR | User fixes disk/permission/locking issue (or tracker corruption), then retry |
| **Backend crashes** | Process exit | None | Hydrate workflow from SQLite, reload bead tracker from `issues.jsonl`, replay `.ticket/runtime/execution-log.jsonl` for audit context |
| **OpenCode crashes** | SDK connection error | Pause execution | User restarts OpenCode; resume |

### Critical Warnings Summary

| Risk | Mitigation |
| :--- | :--- |
| **24h+ process crashes** | Authoritative stores persisted first on every mutation (SQLite workflow/ticket + `issues.jsonl` bead tracker), then SSE broadcast; on restart hydrate/reload authoritative stores |
| **SSE connection drops** | EventSource auto-reconnects; last-event-id resume |
| **Browser closed during execution** | Backend is orchestrator; UI catches up on reopen |
| **YAML file corruption** | Atomic write (`.tmp` + rename); rebuild from authoritative stores (SQLite + `issues.jsonl`) |
| **Git merge conflicts (final merge to `main`)** | AI resolves; if it can't → BLOCKED_ERROR |
| **Model timeout/failure** | Quorum model; proceed if ≥2 valid; fallback model option |
| **OpenCode SDK reconnection** | Per-attempt owned session IDs; reattach only when ownership matches active attempt, else create replacement fresh session |

## 16. Startup Sequence

```plaintext
1. User runs: node server.js
   │
   ├─ 2. Initialize SQLite database
   │     ├─ Run Drizzle migrations if needed
   │     ├─ Apply SQLite pragmas (journal_mode=WAL, locking_mode=NORMAL, synchronous=NORMAL, busy_timeout=5000, wal_autocheckpoint=1000) and verify effective values
   │     └─ Start idle checkpoint timer (PRAGMA wal_checkpoint(PASSIVE) every 30s)
   │
   ├─ 3. Check OpenCode availability
   │     ├─ Try connect to localhost:4096
   │     ├─ If fails: log warning (startup proceeds, but creating/starting tickets is blocked until OpenCode is available)
   │     └─ Store connection status (re-checked before any ticket START action)
   │
   ├─ 4. Hydrate XState machines
   │     ├─ Query tickets with non-terminal states
   │     ├─ For each: load xstate_snapshot from tickets table
   │     ├─ Restore XState actors with saved context
   │     ├─ Load active .beads/issues.jsonl per flow as authoritative bead tracker state
   │     ├─ Never write runtime workflow transition state into SQLite from YAML artifact files
   │     ├─ Never overwrite issues.jsonl bead tracker state from SQLite/index projections
   │     └─ Resume any interrupted actors
   │
   ├─ 5. Reconnect to OpenCode sessions
   │     ├─ For each non-terminal ticket: query active session metadata from opencode_sessions table
   │     ├─ Validate that stored session exists and ownership matches active run/phase/attempt
   │     ├─ If valid: call SDK session.messages() + event.subscribe() and apply to XState context
   │     └─ If invalid/missing: create replacement fresh session and continue from artifacts
   │
   ├─ 6. Start Hono HTTP server
   │     ├─ Register all API routes
   │     ├─ Start SSE broadcast channel
   │     └─ Listen on port 3000
   │
   └─ 7. Ready
         └─ Log: "LoopTroop running at http://localhost:3000"
```

## 17. Prompt Catalog

### Global Rules

```yaml
_GLOBAL_RULES:
  critical_output_rule: "Your entire response must consist of NOTHING except the exact requested artifact. No explanations, no markdown fences, no 'Here is the result', no extra newlines before/after."
  context_refresh: "Context is refreshed between each council step (draft, vote, refine, coverage). Each step receives only the data listed in its context_input — no prior chat/session history."
```

### Interview Prompts

```yaml
PROM1:
  description: "Interview Draft Specification Prompt"
  context_input: "Project codebase map + ticket details"
  system_role: "You are an expert product manager and technical interviewer."
  task: "Generate a comprehensive set of interview questions to gather all requirements and clarify the user's intent for the project."
  instructions:
    - "Phase 1 - Foundation (What/Who/Why): First establish project intent, target user, core value, constraints (and out of scope), and non-goals. Exit criteria: no core ambiguity remains for problem, user, and objective."
    - "Phase 2 - Structure (Complete Feature Inventory): Then capture the full list of required features and major user flows before deep implementation details. Exit criteria: feature inventory is complete, deduplicated, and prioritized."
    - "Phase 3 - Assembly (Deep Dive Per Feature): Then go feature-by-feature and define implementation-level expectations (behavior, edge cases, acceptance criteria, test intent, dependencies). Exit criteria: each in-scope feature has enough detail to support PRD generation without guessing."
    - "Question Limit: Maximum number of questions that can be asked is set in configuration as `max_initial_questions`."
    - "Output Format: Output a strict machine-readable format with questions in logical order."
  output_format: "YAML — question list matching the questions section schema defined in PROM5.output_file"

PROM2:
  description: "Interview Council Voting Prompt"
  context_input: "Codebase map + ticket details + all interview drafts (anonymized, randomized order per voter)"
  system_role: "You are an impartial judge on an AI Council. Your role is to evaluate multiple sets of proposed interview questions objectively."
  task: "Read all provided interview question drafts. Evaluate how well each draft will extract the necessary requirements from the user without being overwhelming. Rate each draft from 0 to 100."
  instructions:
    - "Impartiality: Rate impartially as if all drafts are anonymous. Do not favor any draft based on its origin or style."
    - "Anti-anchoring: Drafts are presented in randomized order per evaluator. Do not assume the first draft is the baseline or best."
    - |
      Scoring Rubric (minimum 0, maximum 20 points per category, total maximum 100):
        1) Coverage of requirements — questions address all areas needed to write a PRD (features, constraints, non-goals, acceptance criteria).
        2) Correctness / feasibility — questions are unambiguous, well-formed, and answerable by the target user.
        3) Testability — answers to these questions would yield verifiable, measurable PRD requirements.
        4) Minimal complexity / good decomposition — logical flow (Foundation → Structure → Assembly), no redundant or low-value questions, efficient use of the `max_initial_questions` budget.
        5) Risks / edge cases addressed — questions surface constraints, failure modes, non-goals, and potential blockers.
    - "Output Format: Provide a clear breakdown of the score for each draft per category, followed by the final total score (0-100)."
  output_format: "YAML — structured scoring breakdown per candidate with final totals"

PROM3:
  description: "Interview Winner Refinement Prompt"
  context_input: "Codebase map + ticket details + all interview drafts"
  system_role: "You are the Lead Product Manager and the winner of the AI Council's interview drafting phase."
  task: "Create the final, definitive version of your interview questions by reviewing the alternative (losing) drafts. Extract any superior questions, missing edge cases, or better flow they contain, and integrate them seamlessly into your winning foundation."
  instructions:
    - "Analyze Alternatives: Carefully review the alternative drafts. Look specifically for unhandled edge cases, better phrasing, or missing constraints."
    - "Selective Integration: Incorporate these improvements into your winning draft. DO NOT rewrite your entire draft — remember, you had the best draft; keep it mostly unchanged, only add what you consider necessary. DO surgically add the missing pieces to make your draft bulletproof. Replace weaker questions rather than appending — the final output must not exceed the `max_initial_questions` limit."
    - "Formatting: Output the final refined draft using the exact same structural format required for this phase. Output only the final artifact."
  output_format: "YAML — same question list format as PROM1 output, matching PROM5.output_file questions schema"

PROM4:
  description: "Interview Batch Question Prompt"
  context_input: "Codebase map + ticket details + final question set + user answers so far"
  system_role: "You are an expert product manager conducting an interview with a user."
  task: "Review the user's answers to questions and adjust the upcoming ones to improve coherence and extract missing details."
  instructions:
    - "Batching and Progress: Present the first batch of 1-3 questions (you choose batch size based on complexity/relatedness), show progress (e.g., question 12/50), and wait for the user to answer all questions in that batch."
    - "Adaptive Iteration: After each batch, analyze answers and adjust only upcoming questions when needed. Add follow-up questions only to resolve ambiguities (max follow-ups in total: 20% of `max_initial_questions`), update/delete now-redundant questions, and accept skipped answers without re-asking unless the missing answer is critical to resolve a later ambiguity. Repeat until all questions are answered or skipped."
    - "User Adaptation: Adapt question phrasing to the user's background and expertise level. Use plain language and real-world analogies for non-technical users; use precise technical terminology for experts. Never simplify in a way that loses precision for technical users. Optional, only if the user background option is enabled."
    - "Final Free-Form Question: After all questions from the set are answered or skipped and no major ambiguity remains, present one final free-form question: 'Anything else to add before PRD generation?' Allow the user to provide any additional context, requirements, or corrections before closing the interview."
    - "Final Output: After the final free-form question is answered or skipped, output the final interview results file in a strict machine-readable format, with all questions, user answers, the final free-form response, and any follow-up questions added during the process."
  output_format: "YAML — complete interview results file matching PROM5.output_file schema"

PROM5:
  description: "Interview Coverage Verification Prompt"
  context_input: "Ticket description + collected answers + current Interview Results"
  system_role: "You are a meticulous Quality Assurance Lead."
  task: "Re-read the original ticket description and all collected user answers, then compare them against the final Interview Results file to ensure complete coverage."
  instructions:
    - "Coverage Check: Detect unresolved ambiguity, missing constraints, missing edge cases, missing non-goals, and inconsistent answers."
    - "Identify Gaps: List any specific gaps or discrepancies found between the source material and the Interview Results."
    - "Follow-up: If gaps exist, generate targeted follow-up questions to resolve them (no more than 20% of `max_initial_questions`). If no gaps exist, confirm that the Interview Results are complete and ready for PRD generation."
  output_format: "YAML"
  output_file:
    path: "<worktree>/.ticket/interview.yaml"
    schema: |
      schema_version: 1
      ticket_id: "<ticket-id>"
      artifact: "interview"
      status: "approved"              # draft | approved
      generated_by:
        winner_model: "<provider/model>"
        generated_at: "<ISO-8601 timestamp>"
      questions:
        - id: "<Q1, Q2, ...>"
          prompt: "<question text>"
          answer_type: "<free_text | single_choice | multi_choice | boolean>"
          options: []                  # populated for single_choice and multi_choice types
          answer:
            skipped: false             # true if user skipped this question
            selected_option_ids: []    # populated for choice-type answers
            free_text: "<user answer or empty string>"
            answered_by: "<user | ai_skip>"
            answered_at: "<ISO-8601 timestamp>"
      follow_up_rounds: []             # additional question rounds added during coverage gaps
      summary:
        goals: []
        constraints: []
        non_goals: []
      approval:
        approved_by: "user"
        approved_at: "<ISO-8601 timestamp>"
```

### PRD Prompts

```yaml
PROM10:
  description: "PRD Draft Specification Prompt"
  context_input: "Codebase map + ticket details + final Interview Results"
  system_role: "You are an expert Technical Product Manager and Software Architect."
  task: "Generate a complete Product Requirements Document (PRD) based on the provided Interview Results. The PRD must be detailed enough that an AI coding agent can implement the feature without ambiguity."
  instructions:
    - "Skipped Questions: For each question the user skipped during the interview, decide the best approach based on available context, codebase analysis, and best practices. Document your decision and reasoning in the PRD."
    - "Product Scope: Include epics, user stories, and acceptance criteria. Every in-scope feature from the Interview Results must map to at least one user story."
    - "Implementation Steps: For each user story, include detailed technical implementation steps decomposed as far as possible — data flows, state changes, component interactions, and integration points."
    - "Technical Requirements: Define architecture constraints, data model, API/contracts, security/performance/reliability constraints, error-handling rules, tooling/environment assumptions, explicit non-goals and anything relevant based on the Interview Results and project context."
    - "Output Format: Output a single, comprehensive PRD document covering all of the above in one artifact."
  output_format: "YAML — complete PRD matching the schema defined in PROM13.output_file"

PROM11:
  description: "PRD Council Voting Prompt"
  context_input: "Codebase map + ticket details + final Interview Results + all PRD drafts (anonymized, randomized order per voter)"
  system_role: "You are an impartial judge on an AI Council. Your role is to evaluate multiple Product Requirements Document (PRD) drafts objectively."
  task: "Read all provided PRD drafts, compare each draft against the Interview Results, and evaluate them against each other. Rate each draft from 0 to 100."
  instructions:
    - "Impartiality: Rate impartially as if all drafts are anonymous. Do not favor any draft based on its origin or style."
    - "Anti-anchoring: Drafts are presented in randomized order per evaluator. Do not assume the first draft is the baseline or best."
    - |
      Scoring Rubric (minimum 0, maximum 20 points per category, total maximum 100):
        1) Coverage of requirements — PRD fully addresses all Interview Results including features, constraints, non-goals, and acceptance criteria.
        2) Correctness / feasibility — requirements are technically sound, internally consistent, and achievable.
        3) Testability — each requirement and acceptance criterion is specific, measurable, and verifiable.
        4) Minimal complexity / good decomposition — epics and user stories are well-structured, deduplicated, and appropriately scoped with detailed implementation steps.
        5) Risks / edge cases addressed — error states, performance constraints, security concerns, and failure modes are explicitly documented.
    - "Output Format: Provide a clear breakdown of the score for each draft per category, followed by the final total score (0-100)."
  output_format: "YAML — structured scoring breakdown per candidate with final totals"

PROM12:
  description: "PRD Winner Refinement Prompt"
  context_input: "Codebase map + ticket details + final Interview Results + all PRD drafts"
  system_role: "You are the Lead Architect and the winner of the AI Council's PRD drafting phase."
  task: "Create the final, definitive version of your PRD by reviewing the alternative (losing) drafts. Extract any superior ideas, missing edge cases, or better technical constraints they contain, and integrate them seamlessly into your winning foundation."
  instructions:
    - "Analyze Alternatives: Carefully review the alternative drafts. Look specifically for unhandled edge cases, error states, risks you missed, better testing strategies, cleaner architectural decomposition, or missing constraints."
    - "Selective Integration: Incorporate these improvements into your winning draft. DO NOT rewrite your entire draft — remember, you had the best draft; keep it mostly unchanged, only add what you consider necessary. DO surgically add the missing pieces to make your draft bulletproof."
    - "Formatting: Output the final refined PRD. Output only the final artifact."
  output_format: "YAML — same PRD format as PROM10 output, matching PROM13.output_file schema"

PROM13:
  description: "PRD Coverage Verification Prompt"
  context_input: "Final Interview Results + final PRD"
  system_role: "You are a meticulous Quality Assurance Lead."
  task: "Re-read the Interview Results as the source of truth and compare them against the final PRD to ensure complete coverage."
  instructions:
    - "Coverage Check: Detect and patch missing requirements, edge cases, constraints, and acceptance criteria."
    - "Identify Gaps: List any specific gaps or discrepancies found between the Interview Results and the PRD."
    - "Resolution: Provide the necessary additions or modifications to the PRD to resolve any identified gaps. If no gaps exist, confirm that the PRD is complete and ready for the Beads phase."
  output_format: "YAML"
  output_file:
    path: "<worktree>/.ticket/prd.yaml"
    schema: |
      schema_version: 1
      ticket_id: "<ticket-id>"
      artifact: "prd"
      status: "approved"                # draft | approved
      source_interview:
        content_sha256: "<sha256 of interview.yaml>"
      product:
        problem_statement: "<...>"
        target_users: []
      scope:
        in_scope: []
        out_of_scope: []
      technical_requirements:
        architecture_constraints: []    # target framework, patterns, infrastructure
        data_model: []                  # entities, relationships, schemas
        api_contracts: []               # endpoints, message formats, external integrations
        security_constraints: []        # authentication, authorization, data handling
        performance_constraints: []     # latency, throughput, resource limits
        reliability_constraints: []     # uptime, failover, data durability
        error_handling_rules: []        # retry policies, fallback behavior, error surfacing
        tooling_assumptions: []         # required tools, environment, OS, runtime
      epics:
        - id: "EPIC-1"
          title: "<epic title>"
          objective: "<...>"
          implementation_steps: []      # detailed step-by-step implementation instructions
          user_stories:
            - id: "US-1"
              title: "<story title>"
              acceptance_criteria: []
              implementation_steps: []  # detailed per-story implementation steps
              verification:
                required_commands: []
      risks: []
      approval:
        approved_by: "user"
        approved_at: "<ISO-8601 timestamp>"
```

### Beads Prompts

```yaml
PROM20:
  description: "Beads Draft Specification Prompt"
  context_input: "Codebase map + ticket details + final PRD"
  system_role: "You are an expert Software Architect."
  task: "Create a Beads breakdown (architecture/task graph) based on the final PRD."
  instructions:
    - "Decomposition: Split each user story into one or more beads using phased modular decomposition appropriate to the feature domain (e.g., input capture → normalization/validation → core domain logic → integration/adapters → output/presentation) to keep flow logical and dependencies minimal."
    - "Granularity: Each bead must be the smallest independently-completable unit of work — small enough that a single AI agent call can implement it with its defined tests, but complete enough to be meaningful. If a bead requires touching too many files or concepts, split it further."
    - |
      Draft Bead Structure.
      Each bead in this draft phase must include only the following subset of fields, the remaining fields will be added in a later step.
        2.  Title — short task name.
        7.  PRD references — summary of the Epic and User Story this bead maps to (if there are multiple beads in a user story, include a summary of what the other beads will do).
        9.  Description — detailed technical implementation steps for this specific bead only.
        10. Context & Architectural Guidance — explicit patterns to follow copied from the PRD/Architecture, plus an "Anti-patterns" list of approaches to avoid for this task.
        11. Acceptance criteria — human-readable definition of done.
        14. Bead-scoped tests — targeted unit/integration tests for this bead only, not the full suite.
        15. Test commands — exact commands to run the tests.
    - "Output Format: Output a structured Beads workspace definition containing all beads in dependency order."
  output_format: "YAML — structured bead list with subset fields (title, PRD references, description, context guidance, acceptance criteria, tests, test commands)"

PROM21:
  description: "Beads Council Voting Prompt"
  context_input: "Codebase map + ticket details + final PRD + all bead drafts (anonymized, randomized order per voter)"
  system_role: "You are an impartial judge on an AI Council. Your role is to evaluate multiple Beads breakdown (architecture/task) drafts objectively."
  task: "Read all provided Beads drafts, compare each draft against the final PRD, and evaluate them against each other. Rate each draft from 0 to 100."
  instructions:
    - "Impartiality: Rate impartially as if all drafts are anonymous. Do not favor any draft based on its origin or style."
    - "Anti-anchoring: Drafts are presented in randomized order per evaluator. Do not assume the first draft is the baseline or best."
    - |
      Scoring Rubric (minimum 0, maximum 20 points per category, total maximum 100).
        1) Coverage of PRD requirements — every in-scope user story and acceptance criterion maps to at least one bead with explicit verification steps (fields 14, 15).
        2) Correctness / feasibility of the technical approach — bead descriptions (field 9) are technically sound, implementation steps are achievable, and test commands (field 15) are valid and runnable.
        3) Quality and isolation of bead-scoped tests (field 14) — each bead defines its own targeted tests (not the full suite), with clear test commands (field 15) and unambiguous pass/fail criteria.
        4) Minimal complexity / good dependency management — beads are the smallest independently-completable units, no circular or missing dependency edges, no oversized beads touching too many files or concepts.
        5) Risks / edge cases addressed — failure modes, retry scenarios, edge cases from the PRD, and anti-patterns are explicitly captured in each bead's Context & Architectural Guidance (field 10).
    - "Output Format: Provide a clear breakdown of the score for each draft per category, followed by the final total score (0-100)."
  output_format: "YAML — structured scoring breakdown per candidate with final totals"

PROM22:
  description: "Beads Winner Refinement Prompt"
  context_input: "Codebase map + ticket details + final PRD + all bead drafts"
  system_role: "You are the Lead Architect and the winner of the AI Council's Beads drafting phase."
  task: "Create the final, definitive version of your Beads breakdown by reviewing the alternative (losing) drafts. Extract any unique edge cases, better test coverage, or other superior details they contain, and integrate them seamlessly into your winning foundation."
  instructions:
    - "Analyze Alternatives: Carefully review the alternative drafts. Look specifically for unhandled edge cases, better testing strategies, cleaner architectural decomposition, or missing constraints."
    - "Selective Integration: Incorporate these improvements into your winning draft. DO NOT rewrite your entire draft — remember, you had the best draft; keep it mostly unchanged, only add what you consider necessary. DO surgically add the missing pieces to make your draft bulletproof."
    - "Formatting: Output the final refined Beads breakdown. Output only the final artifact."
  output_format: "YAML — same bead list format as PROM20 output"

PROM23:
  description: "Beads Full Fields Expansion Prompt"
  context_input: "Codebase map + ticket details + final PRD + refined beads draft (from PROM22)"
  system_role: "You are the Lead Architect and the winner of the AI Council's Beads phase."
  task: "Take the refined Beads draft (which contains only the subset fields: title, PRD references, description, context guidance, acceptance criteria, bead-scoped tests, test commands) and create the final Beads breakdown by adding all remaining required fields per bead."
  instructions:
    - |
      Expansion Fields.
      Each bead has 22 fields total. The refined draft already contains some fields.
      For each bead, read the existing fields and add the following remaining fields while preserving all existing content:
        1.  ID — unique hierarchical bead ID including ticket name and structure for epics/tasks/subtasks, plus a short 4-character suffix hash for uniqueness (e.g., "PROJ-1-EPIC-1-US-1-task4-sub1-h3fa").
        3.  Priority — numeric execution priority (sequential order: 1 for the first bead to execute, 2 for the second, etc.).
        4.  Status — set to "pending" (lifecycle: pending → in_progress → done / error).
        5.  Issue type — "task", "bug", "chore", etc. (included for future use).
        6.  External reference — parent ticket ID (e.g., PROJ-1).
        8.  Labels — every bead must map to at least one user story and one epic (if epics exist); additional labels allowed (e.g., "backend", "frontend", "database") for future filtering and stats.
        12. Dependencies — two arrays: "blocked_by" (bead IDs that must complete before this bead can start) and "blocks" (bead IDs that cannot start until this bead completes).
        13. Target files — name and path (in project folder) of files explicitly targeted by the bead, only necessary ones to reduce context size.
        16. Notes — errors and learnings from previous attempts to help the agent learn from mistakes; empty on first attempt; each failed attempt appends its details until max iterations is reached.
        17. Iteration number — starts at 1, increases on each retry.
        18. Created at — timestamp (when the bead record was created during planning).
        19. Updated at — timestamp (updated by SYS when the bead record is modified).
        20. Completed at — timestamp (filled when status is set to "done").
        21. Started at — timestamp (filled by SYS when status is set to "in_progress"; empty during planning).
        22. Bead start commit — git commit SHA recorded by SYS when the bead begins execution; used to reset the worktree on context wipe (git reset --hard). Empty during planning.
    - "Dependency Graph: Ensure all dependency edges (field 12) are valid — no dangling references, no self-dependencies, no circular dependencies. Priority order (field 3) should respect dependency ordering."
    - "Output Format: Output the complete final Beads breakdown with all 22 fields per bead, in dependency order. Output only the final artifact."
  output_format: "JSONL — one JSON object per line per bead, matching the schema defined in PROM24.output_file"

PROM24:
  description: "Beads Coverage Verification Prompt"
  context_input: "Final PRD + Beads graph + tests"
  system_role: "You are a meticulous Quality Assurance Lead."
  task: "Re-read the final PRD as the source of truth and compare it against the Beads graph and tests to ensure complete coverage."
  instructions:
    - "Coverage Check: Detect uncovered PRD requirements, missing dependency edges, oversized beads, and missing verification steps."
    - "Identify Gaps: List any specific gaps or discrepancies found between the PRD and the Beads breakdown."
    - "Resolution: Provide the necessary additions or modifications to the Beads breakdown to resolve any identified gaps. Ensure each in-scope PRD requirement is mapped to at least one bead with explicit verification. If no gaps exist, confirm that the Beads breakdown is complete and ready for Execution."
  output_format: "JSONL"
  output_file:
    path: "<worktree>/.ticket/beads/<flow-id>/.beads/issues.jsonl"
    format: "JSONL — one JSON object per line, each line is a single bead. Append new beads; update existing beads in-place by rewriting their line."
    example: {"id":"PROJ-1-EPIC-1-US-1-task1-sub1-h7qd","priority":1,"title":"Implement login error state","status":"pending","issue_type":"task","external_ref":"PROJ-1","prd_references":"EPIC-1 / US-1: Login error feedback. Other beads in this story handle form reset (sub2) and analytics event (sub3).","labels":["ticket:PROJ-1","epic:EPIC-1","story:US-1","frontend"],"description":"Add inline error handling for login form: catch 401 responses, display non-blocking error banner, preserve form values.","context_guidance":{"patterns":["Use the AppError class for exceptions","Follow the Container/Presenter pattern defined in src/components"],"anti_patterns":["Do not use alert() for error display","Do not clear form values on error"]},"acceptance_criteria":"Show non-blocking inline message on invalid credentials.","dependencies":{"blocked_by":["PROJ-1-EPIC-1-US-1-task1-sub0-m4k9"],"blocks":["PROJ-1-EPIC-1-US-1-task2-sub1-z8p1"]},"target_files":["src/auth/LoginForm.tsx","src/auth/useAuth.ts"],"tests":["Login error banner appears on invalid credentials","Form values are preserved after failed login"],"test_commands":["npm test -- --grep \"login error\"","npx eslint src/auth/"],"notes":"","iteration":1,"created_at":"2026-02-06T16:10:00Z","updated_at":"2026-02-06T16:10:00Z","completed_at":"","started_at":"","bead_start_commit":""}
```

### Execution Prompts

```yaml
PROM51:
  description: "Context Wipe Note Summary Prompt"
  context_input: "Current bead data + error context from failed iteration"
  system_role: "You are a concise technical analyst summarizing a failed implementation attempt."
  task: "Generate a short, actionable summary of what was attempted and what errors were encountered during this bead iteration, to be appended to the bead's Notes section for the next attempt."
  instructions:
    - "Summarize Attempt: Describe what implementation approach was taken and what code changes were made during this iteration."
    - "Document Errors: List the specific errors encountered during linting, testing, or execution, including error messages and root causes if identifiable."
    - "Extract Lessons: Identify what should be avoided or done differently in the next attempt (e.g., 'Iteration 1 - Tried X approach, but it constantly caused Y error during linting/testing')."
    - "Keep it Concise: The summary should be brief and focused — only include information that will help the next iteration succeed. Do not repeat the full bead description or acceptance criteria."
  output_format: "Plain text — append-only note for the bead Notes field"

PROM52:
  description: "Final Test Generation Prompt"
  context_input: "Ticket details + Interview Results + PRD + Beads list"
  system_role: "You are an expert QA Engineer and the main implementer who has just finished implementing a ticket from end to end."
  task: "Design and implement a comprehensive final test (or test suite) that validates the entire ticket was implemented correctly, based on the ticket's scope and complexity. This is a higher-level integration/end-to-end test — not a unit test — and it must reflect what the user actually asked for."
  instructions:
    - "Review Scope: Re-read the ticket details, Interview Results, PRD (epics and user stories), and Beads list to understand the full scope of what was built. The final test must cover the ticket as a whole — not a single bead."
    - "Test Design: Design the minimal but sufficient set of tests that collectively prove the ticket requirements are met. The scope and depth of the test should match the ticket's complexity — a simple ticket may only need one integration test; a complex feature may need several end-to-end scenarios."
    - "Coverage Priorities: Focus on the following in order: (1) all acceptance criteria from the PRD user stories; (2) the most critical user flows identified in the Interview Results; (3) key edge cases and error states explicitly documented in the PRD or beads."
    - "Test Type: Prefer integration or end-to-end tests that exercise real code paths and real dependencies (no unnecessary mocking). Use the testing framework and conventions already established in the project. If no testing framework exists, pick the most idiomatic choice for the project's stack and scaffold it minimally."
    - "Determinism: Tests must be deterministic and repeatable. Avoid relying on external services, network calls, or random state unless the ticket explicitly involves them — in that case, use appropriate fixtures or stubs."
    - "Test Commands: Provide the exact commands to run the final test(s). Confirm that the commands work and the tests pass before outputting the completion marker."
    - "Completion Marker: After all final tests pass, output the machine-readable completion marker: `<FINAL_TEST_STATUS>{\"status\":\"passed\",\"tests_run\":<count>,\"test_file\":\"<path>\"}</FINAL_TEST_STATUS>`"
    - "Failure Handling: If any test fails, attempt to diagnose and fix the underlying implementation issue (not just the test). Only mark as passed when the implementation genuinely satisfies all tested requirements."
```

## Appendix: Actor Tags

During this specification, every actor is marked by the following tags:
- **USR** — User
- **MAI** — Main Implementer (primary AI coding model)
- **SYS** — LoopTroop System (orchestration logic)
- **AIC** — AI Council (multi-model drafting + voting panel)

Prompts (PROM1, PROM2, etc.) are sent by SYS (via OpenCode) to MAI or each AIC model (or only the AIC winner), depending on the phase and step, as described in the workflow phases (§6) and state machine (§7).

All prompt payloads are assembled exclusively by `buildMinimalContext(phase, ticketState, activeItem?)` under the phase allowlist and token-budget contract.

`Codebase` in prompt context descriptions means the ticket-local map file `<worktree>/.ticket/codebase-map.yaml`, generated by SYS on `START` before the first planning prompt.
