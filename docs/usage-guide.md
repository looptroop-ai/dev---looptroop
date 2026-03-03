# Usage Guide

A detailed guide to every feature and interaction in LoopTroop.

---

## Table of Contents

- [The Kanban Board](#the-kanban-board)
- [Profile Management](#profile-management)
- [Project Management](#project-management)
- [Ticket Management](#ticket-management)
- [The Ticket Dashboard](#the-ticket-dashboard)
- [Phase-by-Phase Walkthrough](#phase-by-phase-walkthrough)
  - [Draft (To Do)](#1-draft-to-do)
  - [Interview Phase](#2-interview-phase)
  - [PRD Phase](#3-prd-phase)
  - [Beads Phase](#4-beads-phase)
  - [Pre-flight Check](#5-pre-flight-check)
  - [Execution (Coding)](#6-execution-coding)
  - [Final Test](#7-final-test)
  - [Integration](#8-integration)
  - [Manual Verification](#9-manual-verification)
  - [Cleanup & Completion](#10-cleanup--completion)
- [Error Handling](#error-handling)
- [Editing Artifacts](#editing-artifacts)
- [Re-running Phases](#re-running-phases)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Responsive Design](#responsive-design)

---

## The Kanban Board

The main application view is a **4-column Kanban board**:

```
┌──────────┬────────────────┬────────────────┬──────────┐
│  To Do   │  In Progress   │  Needs Input   │   Done   │
│ (small)  │   (large)      │   (large)      │ (small)  │
├──────────┼────────────────┼────────────────┼──────────┤
│ DRAFT    │ COUNCIL_*      │ WAITING_*      │COMPLETED │
│          │ DRAFTING_*     │ BLOCKED_ERROR  │CANCELED  │
│          │ REFINING_*     │                │          │
│          │ VERIFYING_*    │                │          │
│          │ PRE_FLIGHT     │                │          │
│          │ CODING         │                │          │
│          │ RUNNING_*      │                │          │
│          │ INTEGRATING    │                │          │
│          │ CLEANING_ENV   │                │          │
└──────────┴────────────────┴────────────────┴──────────┘
```

### Ticket Cards

Each ticket card displays:
- **Ticket ID** (e.g., `PROJ-12`) and **title**
- **Project icon** and **border color** (using the project's selected color)
- **Priority** indicator (Very High → Very Low)
- **Current status** text
- **Last update time** — relative format:
  - "just now", "5 min ago", "2 hours ago", "yesterday", "3 days ago"
  - Full timestamp shown on hover
- **In Progress throbber** — Blue spinning indicator for tickets actively being processed
- **Error state** — Flashing red border for tickets in BLOCKED_ERROR

### Board Rules
- The board is **read-only** — you cannot drag tickets between columns
- All state changes happen through the ticket dashboard via explicit user actions
- Only **one ticket view** can be open at a time
- Click a ticket card to open its dashboard

### Top Bar
- **Configuration** button — Open profile settings
- **New Project** button — Create a new project
- **New Ticket** button — Create a new ticket

---

## Profile Management

### Creating a Profile (First Run)

On first launch, you'll be prompted to create a profile:

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| Username | ✅ | — | Your display name |
| Icon | ❌ | Auto-generated | Profile avatar |
| Background | ❌ | None | Your expertise (e.g., "Senior SWE", "PM", "Carpenter") |
| Main Implementer | ✅ | — | Primary AI model for coding (must be from available OpenCode models) |
| Council Members | ✅ | — | Up to 4 models for council deliberation |
| Max Iterations | ❌ | 5 | Max retry attempts per bead (0 = infinite retries) |
| Per-Iteration Timeout | ❌ | 20 min | Timeout per bead attempt (0 = no timeout) |
| Council Response Timeout | ❌ | 15 min | How long to wait for a council member's response |
| Min Council Quorum | ❌ | 2 | Minimum valid council responses required (1-4) |
| Interview Questions | ❌ | 50 | Max interview questions (0 = infinite) |
| Disable Analogies | ❌ | No | Turn off simplified analogies for non-technical users |

### Editing Your Profile

Click the configuration button in the top bar to update any setting. Changes take effect for all new operations.

### How Background Affects Behavior

The `background` field adapts the interview experience:
- **Non-technical users** (e.g., "PM", "Carpenter") — Questions use simpler language with analogies
- **Technical users** (e.g., "Senior SWE", "Backend engineer") — Questions are more technically detailed

---

## Project Management

### Creating a Project

1. Click **"New Project"** in the top bar
2. Fill in:
   - **Name** — Full project name (e.g., "My E-Commerce Platform")
   - **Shortname** — 3-5 uppercase letters (e.g., "ECOM"). Used for ticket IDs: `ECOM-1`, `ECOM-2`, etc.
   - **Icon** — Optional emoji or image. A default is assigned if you skip this.
   - **Color** — Ticket border color. 32 color options available (red and yellow are excluded to avoid confusion with error/warning states).
   - **Folder Path** — Absolute path to the git-initialized project folder (e.g., `/home/user/projects/my-ecom`)
3. Click **Create**

### Project Restrictions
- The folder must be git-initialized with at least one commit
- LoopTroop creates a `.looptroop/` directory in the project root
- Each ticket gets an isolated worktree under `.looptroop/worktrees/`
- After creation, you can only edit **name**, **icon**, and **color**

### Per-Project Overrides
Projects can override profile-level settings:
- Council members (use different models for different projects)
- Max iterations (more retries for complex projects)
- Timeouts (longer timeouts for large codebases)

---

## Ticket Management

### Creating a Ticket

1. Click **"New Ticket"** in the top bar
2. Fill in:
   - **Title** — Concise description of what you want built (max 200 characters)
   - **Project** — Select the parent project
   - **Description** — Detailed requirements. The more detail you provide here, the better the AI's output.
   - **Priority** — Choose from: Very High (1), High (2), Normal (3, default), Low (4), Very Low (5)
3. Click **Create**

### What Happens on Creation

When you create a ticket:
1. An auto-incremented ID is generated (e.g., `PROJ-1`, `PROJ-2`)
2. The ticket is saved to SQLite
3. A minimal metadata file is created at `.looptroop/worktrees/<ticket-id>/.ticket/meta/ticket.meta.json`
4. **No source code files are created yet** — that happens on Start
5. The ticket appears in the **To Do** column

### After Creation
- Click the ticket card to open the dashboard
- You can edit the **title** and **priority** (but not the description or status)
- Status is controlled exclusively by the state machine

---

## The Ticket Dashboard

The ticket dashboard is the primary interface for interacting with a ticket. It opens as a full-screen overlay when you click any ticket card.

### Layout

```
┌─────────────────────────────────────────────────────────┐
│  [X]  PROJ-1: Add user authentication  ● In Progress   │  ← Header
├─────────────┬───────────────────────────────────────────┤
│             │                                           │
│  Navigator  │         Active Workspace                  │
│   (25%)     │            (75%)                          │
│             │                                           │
│ ┌─────────┐ │                                           │
│ │ Phase   │ │     Phase-specific content               │
│ │Timeline │ │     (Q&A, editors, live logs, etc.)      │
│ │         │ │                                           │
│ ├─────────┤ │                                           │
│ │ Context │ │                                           │
│ │  Tree   │ │                                           │
│ └─────────┘ │                                           │
│             │                                           │
└─────────────┴───────────────────────────────────────────┘
```

### Header
- **Close button** (X) — Close dashboard (also: press Escape)
- **Ticket ID** and **title**
- **Status badge** — Current state with color indicator
- **Priority** indicator
- **Action buttons** — Phase-specific (Start, Approve, Retry, Cancel, etc.)

### Navigator Panel (Left, 25%)

**Phase Timeline (top section):**
- Lists all 25 workflow states as an accordion
- Only one phase can be expanded at a time
- Status indicators:
  - ✅ **Green check** — Phase completed
  - 🔵 **Blue throbber** — Currently active
  - ⬜ **Gray** — Future/pending (not clickable)
  - ❌ **Red X** — Error in this phase
- **Click completed phases** to review their content (read-only)
- **"← Back to live"** button appears when viewing past phases
- **Progress indicators** inline:
  - Interview: "Q 12/50"
  - Execution: "Bead 7/34 (20.6%)"

**Context Tree (bottom section):**
- Adapts based on the current/selected phase:
  - **Draft:** Ticket metadata
  - **Interview Council:** Model draft statuses
  - **Interview Q&A:** Question list (click to jump)
  - **PRD Approval:** Epics → User Stories hierarchy
  - **Beads Approval:** Epic → Story → Bead tree
  - **Execution:** Bead navigator with completion fractions
  - **Error:** Error context + appropriate tree

### Active Workspace (Right, 75%)

Shows the main content for the current phase. Content changes based on the ticket state:

- **Draft View:** Ticket details + "Start" button
- **Council View:** Live streaming of AI thinking/reasoning, draft comparisons
- **Interview Q&A:** Interactive question/answer interface
- **Approval View:** Structured viewer + CodeMirror editor for artifacts
- **Coding View:** Live execution logs with smart auto-scroll
- **Error View:** Error details + Retry/Cancel buttons
- **Done View:** Completion summary with timestamps and statistics

### Panel Resizing
- Drag the handle between panels to resize (desktop)
- Default split: 25% / 75%
- On mobile: Navigator becomes a slide-out drawer (hamburger menu)

---

## Phase-by-Phase Walkthrough

### 1. Draft (To Do)

**What you see:** Ticket details (title, description, priority, project)

**Actions:**
- Click **"Start"** to begin the pipeline
- This triggers lazy initialization:
  1. Git worktree and branch are created
  2. `.ticket/` directory structure is initialized
  3. `.ticket/codebase-map.yaml` is generated from your project files
  4. If initialization fails → `BLOCKED_ERROR` with diagnostics

### 2. Interview Phase

The interview phase has sub-steps:

**a. Council Deliberating (COUNCIL_DELIBERATING)**
- AI council members generate interview questions in parallel
- You see streaming output from each model
- Read-only — wait for the council to finish

**b. Council Voting (COUNCIL_VOTING_INTERVIEW)**
- Council members vote on question sets using the interview rubric
- Anonymized, randomized order to prevent anchoring bias

**c. Compiling Interview (COMPILING_INTERVIEW)**
- Winning question set is prepared for the Q&A flow

**d. Interview Q&A (WAITING_INTERVIEW_ANSWERS)**
- **Interactive phase** — you answer questions one at a time
- Current question displayed prominently
- Options:
  - **Type your answer** and click Submit
  - **Skip** a question (marks it as skipped)
- Previous Q&A pairs visible above (scrollable history)
- Smart auto-scroll keeps current question in view
- Progress shown: "Q 12/50"

**e. Coverage Verification (VERIFYING_INTERVIEW_COVERAGE)**
- AI checks if all important topics were covered
- If gaps found → loops back to Q&A with follow-up questions
- If coverage is clean → proceeds to approval

**f. Interview Approval (WAITING_INTERVIEW_APPROVAL)**
- Review the compiled interview results
- **Structured Viewer:** Collapsible sections, color-coded, readable format
- **"Edit Raw" toggle:** Opens CodeMirror YAML editor for manual edits
- Actions:
  - **Approve** → Proceed to PRD phase
  - **Edit** → Modify the interview results
  - **Re-run** → Start the entire interview from scratch

### 3. PRD Phase

**a. Drafting (DRAFTING_PRD)**
- Council members generate PRD drafts from interview results
- Streaming AI output visible

**b. Voting (COUNCIL_VOTING_PRD)**
- Council votes using PRD rubric

**c. Refining (REFINING_PRD)**
- Winning PRD is refined with ideas from losing drafts

**d. Coverage (VERIFYING_PRD_COVERAGE)**
- PRD is checked against interview results for completeness
- Gaps → loops back to refining

**e. PRD Approval (WAITING_PRD_APPROVAL)**
- Review the PRD with epics, user stories, acceptance criteria
- Structured viewer with collapsible sections
- Cross-links to interview answers
- Approve / Edit / Re-run options

### 4. Beads Phase

**a. Drafting (DRAFTING_BEADS)**
- Council breaks PRD into small implementation beads

**b. Voting (COUNCIL_VOTING_BEADS)**
- Council votes using beads rubric

**c. Refining (REFINING_BEADS)**
- Winning bead set is refined

**d. Coverage (VERIFYING_BEADS_COVERAGE)**
- Beads are checked against PRD for complete coverage

**e. Beads Approval (WAITING_BEADS_APPROVAL)**
- Review each bead: description, tests, dependencies, target files
- Expandable bead cards with all 22 fields visible
- Cross-links to PRD user stories and interview answers
- Approve / Edit / Re-run options

### 5. Pre-flight Check

**PRE_FLIGHT_CHECK** runs system diagnostics:
- ✅ Git working tree is clean
- ✅ OpenCode server is responding
- ✅ Required tools available
- ✅ Disk space sufficient

If all pass → CODING. If critical failure → BLOCKED_ERROR with remediation instructions.

### 6. Execution (Coding)

**CODING** is the main implementation phase:

- Beads are executed **sequentially** in priority order
- Each bead goes through the "Ralph Loop" (retry until pass or max iterations)
- **Live view:**
  - Streaming AI output (thinking, code being written)
  - Test results as they run
  - Iteration counter (e.g., "Iteration 2/5")
  - Progress (e.g., "Bead 7/34 — 20.6%")
- **Bead Navigator:**
  - Click completed beads to review their logs
  - Click pending beads to view their specifications
  - Click the active bead to return to live view

### 7. Final Test

**RUNNING_FINAL_TEST** runs integration tests on the complete implementation:
- Tests run on the unsquashed bead-commit branch state
- Streaming test output visible
- Pass → Integration. Fail → BLOCKED_ERROR.

### 8. Integration

**INTEGRATING_CHANGES** prepares the code for merge:
- Post-test squash of commit history
- Candidate preparation on the ticket branch
- Commit summary generated

### 9. Manual Verification

**WAITING_MANUAL_VERIFICATION:**
- Summary of completed work
- Final test results
- Candidate commit details
- Click **"Complete"** to trigger final merge to `main` → CLEANING_ENV
- Or report issues → stays in verification

### 10. Cleanup & Completion

**CLEANING_ENV** removes temporary resources:
- Worktree cleanup (optional, default yes)
- Temporary branch removal

**COMPLETED** — Terminal state:
- Full lifecycle summary with timestamps
- Total duration, bead statistics
- Final commit hash

---

## Error Handling

When a ticket enters **BLOCKED_ERROR**:

1. The ticket card shows a **flashing red border** on the Kanban board
2. Open the dashboard to see:
   - **Error message** — What went wrong
   - **Failed phase/bead** — Where it failed
   - **Diagnostic codes** — Probable cause identifiers
   - **Iteration notes** — What was tried before
3. Options:
   - **Retry** — Returns to the previous state and tries again
   - **Cancel** — Moves ticket to CANCELED (terminal)

### Common Error Scenarios

| Scenario | Cause | Resolution |
|----------|-------|------------|
| Pre-flight failure | Git dirty or OpenCode down | Clean git, restart OpenCode, then Retry |
| Bead max iterations | Tests keep failing after N retries | Review bead spec, edit tests/criteria, then Retry |
| Council timeout | AI models too slow | Increase timeout in profile, then Retry |
| Integration conflict | Git merge conflicts | Resolve in worktree manually, then Retry |
| Final test failure | Integration issues | Review logs, fix issues, then Retry |

---

## Editing Artifacts

### When Can You Edit?

- **Before execution starts** (before PRE_FLIGHT_CHECK):
  - Interview results, PRD, and beads are all editable
  - Navigate to the approval view and toggle "Edit Raw" for YAML editing
  - Or use the Structured Viewer for guided editing

- **During approval phases** (WAITING_*_APPROVAL):
  - The current artifact is editable inline
  - Previous artifacts are also editable (navigate via Phase Timeline)

- **After execution begins:**
  - All planning artifacts become **read-only**
  - Editing beads only affects `.ticket/beads/<flow-id>/.beads/...` for the active flow

### Cascading Edit Warnings

| Editing... | Restarts... | Warning |
|-----------|------------|---------|
| Interview Results | PRD phase + Beads phase | "This will restart PRD and Beads generation" |
| PRD | Beads phase | "This will restart Beads generation" |
| Beads | Nothing (local only) | No warning |

Warnings require explicit confirmation before saving.

---

## Re-running Phases

At any time before execution, you can re-run planning phases:

- **Re-run Interview** — Restarts from council deliberation (restarts PRD and Beads too)
- **Re-run PRD** — Restarts from PRD drafting (restarts Beads too)
- **Re-run Beads** — Restarts from beads drafting

Re-run buttons appear during approval phases and when navigating to completed planning phases.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Escape` | Close ticket dashboard / modal |
| `?` | Show keyboard shortcuts modal |

---

## Responsive Design

LoopTroop is designed for three breakpoints:

| Breakpoint | Width | Behavior |
|-----------|-------|----------|
| **Mobile** | < 768px | Navigator becomes slide-out drawer; workspace takes full width |
| **Tablet** | 768px – 1280px | Compressed layout with adjusted panel proportions |
| **Desktop** | > 1280px | Full split-view with drag-to-resize panels |
