# LoopTroop

**Local-first AI orchestration for autonomous software development.**

LoopTroop manages the full lifecycle of a development task — from requirements gathering through coding, testing, and integration — using an AI council of multiple models. It prevents context rot by using fresh sessions per step, ensures correctness through multi-model deliberation, and gives users approval gates at every major phase transition.

---

## Table of Contents

- [What Is LoopTroop?](#what-is-looptroop)
- [Why LoopTroop Exists](#why-looptroop-exists)
- [What LoopTroop Is NOT](#what-looptroop-is-not)
- [System Requirements](#system-requirements)
- [Prerequisites](#prerequisites)
- [Installation & Setup](#installation--setup)
- [Running the Application](#running-the-application)
- [Available Commands](#available-commands)
- [How to Use LoopTroop](#how-to-use-looptroop)
  - [First-Time Setup](#first-time-setup)
  - [Creating a Project](#creating-a-project)
  - [Creating a Ticket](#creating-a-ticket)
  - [The Ticket Lifecycle](#the-ticket-lifecycle)
  - [The Kanban Board](#the-kanban-board)
  - [The Ticket Dashboard](#the-ticket-dashboard)
- [How the AI Council Pipeline Works](#how-the-ai-council-pipeline-works)
- [How Bead Execution Works](#how-bead-execution-works)
- [How Crash Recovery Works](#how-crash-recovery-works)
- [Project Structure](#project-structure)
- [Configuration Reference](#configuration-reference)
- [Tech Stack](#tech-stack)
- [Detailed Documentation](#detailed-documentation)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## What Is LoopTroop?

LoopTroop is a **local GUI orchestrator** for long-running, high-correctness AI software delivery — from idea to merged code. It runs a council-of-models planning pipeline (draft, vote, refine, coverage verify), then executes bead-scoped implementation loops with strict context isolation.

**The core pipeline works like this:**

```
┌──────────┐    ┌───────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌───────────┐    ┌──────┐
│ Interview│ → │    PRD    │ → │  Beads   │ → │ Execution│ → │Final Test│ → │Integration│ → │ Done │
│ (Q&A)    │    │ (Spec)    │    │ (Tasks)  │    │ (Code)   │    │ (Verify) │    │ (Merge)   │    │      │
└──────────┘    └───────────┘    └──────────┘    └──────────┘    └──────────┘    └───────────┘    └──────┘
     ↑               ↑                ↑
     └───── AI Council: Draft → Vote → Refine → Coverage ──────┘
```

1. **Interview Phase** — An AI council generates tailored questions, user provides answers to align requirements.
2. **PRD Phase** — The council drafts a Product Requirements Document with epics and user stories.
3. **Beads Phase** — The council breaks the PRD into small, independently implementable tasks ("beads") with tests.
4. **Execution Phase** — Each bead is implemented by the main AI agent via OpenCode with a retry loop.
5. **Final Test** — Integration tests validate the entire ticket on the unsquashed branch state.
6. **Integration** — Post-test squash and candidate preparation on the ticket branch, then final merge to main.

Each planning phase uses the **council pipeline**: parallel drafting → anonymized voting → winner refinement → coverage verification.

---

## Why LoopTroop Exists

**Context rot is the main enemy.** Context rot happens when too much data is fed to an AI model, overflowing the maximum context window, causing compaction and loss of important data. Quality degrades severely even at ~60% of maximum context.

LoopTroop solves this by ensuring that **at each step in the lifecycle, the AI agent receives the absolute minimum context it needs — no more.** Fresh sessions are created per step, and a strict context builder enforces phase-specific allowlists.

**Core design principles:**
- **Context Rot Prevention** — Fresh AI sessions per task step; no accumulated hallucination drift
- **Correctness over Speed** — Multi-model council deliberation ensures quality; designed for hours-long execution
- **User Control** — Approval gates at every major phase transition; user can edit artifacts before execution
- **Crash Safety** — SQLite (WAL mode) + atomic file I/O survives unexpected shutdowns

---

## What LoopTroop Is NOT

- **Not for cost-sensitive use cases** — API calls can be expensive with multi-model councils
- **Not for urgent delivery** — Designed for "slow and perfect," not speed
- **Not for simple tasks** — For small/simple tasks, prefer IDE+AI or tools like Replit/Bolt/Lovable
- **Not for pair programming** — This is an autonomous orchestrator, not a real-time coding assistant

---

## System Requirements

| Requirement | Minimum |
|------------|---------|
| **RAM** | 4 GB |
| **Disk Space** | 15 GB free |
| **Node.js** | v24.x LTS ("Krypton") |
| **OS** | Linux, macOS, Windows (WSL) |
| **Git** | Installed and configured |
| **Sleep Prevention** | Host must prevent sleep/hibernation during execution |

> **⚠️ Recommendation:** Use a VM, disposable cloud desktop, VPS, or container. LoopTroop runs AI agents that can read/write files in your project folder, and execution can run unattended for hours.

---

## Prerequisites

### 1. Install Node.js 24.x LTS

```bash
# Using nvm (recommended)
nvm install 24
nvm use 24

# Verify
node --version  # Should show v24.x.x
```

### 2. Install and Configure OpenCode

OpenCode is the AI model gateway that LoopTroop uses. It runs as a separate long-lived process.

```bash
# Install OpenCode (see https://opencode.ai for details)
# Configure at least one AI model (e.g., Claude, GPT-4, etc.)

# Start the OpenCode server
opencode serve
```

OpenCode runs on port 4096 by default. LoopTroop connects to it as a client.

### 3. Prepare Your Project Repository

Your project must be a Git-initialized repository:

```bash
cd /path/to/your/project
git init  # if not already initialized
git add .
git commit -m "Initial commit"
```

---

## Installation & Setup

```bash
# Clone the LoopTroop repository
git clone https://github.com/liviux/test-sonnet.git
cd test-sonnet

# Install dependencies
npm install
```

That's it! No database migration or build steps needed — SQLite is initialized automatically on first run.

---

## Running the Application

### Development Mode (recommended)

```bash
# Terminal 1: Start OpenCode server
opencode serve

# Terminal 2: Start LoopTroop (frontend + backend concurrently)
npm run dev
```

This starts:
- **Vite dev server** (frontend) at `http://localhost:5173`
- **Hono HTTP server** (backend) with hot reload via tsx watch
- The frontend proxies API calls to the backend automatically

Open **[http://localhost:5173](http://localhost:5173)** in your browser.

### Production Build

```bash
npm run build
npm run preview
```

### With Memory Optimization (for long unattended runs)

```bash
NODE_OPTIONS="--max-old-space-size=4096" npm run dev
```

---

## Available Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start frontend (Vite) + backend (Hono) concurrently |
| `npm run dev:frontend` | Start only the Vite frontend dev server |
| `npm run dev:backend` | Start only the Hono backend with tsx watch |
| `npm run test` | Run all tests (Vitest, 238 tests across 22 files) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run typecheck` | TypeScript strict-mode type checking (tsc --noEmit) |
| `npm run lint` | ESLint 9 flat config linting |
| `npm run build` | Production build (tsc -b + vite build) |
| `npm run preview` | Preview production build |
| `npm run db:generate` | Generate Drizzle ORM migrations |
| `npm run db:push` | Push Drizzle migrations to database |

---

## How to Use LoopTroop

### First-Time Setup

1. **Start the app:** `npm run dev`
2. **Open the browser:** Navigate to `http://localhost:5173`
3. **Create your profile:**
   - Click the configuration button in the top bar
   - Enter your username (display name)
   - Optionally set your background/expertise (e.g., "Senior SWE", "PM", "Carpenter")
     - This adapts the interview style: non-technical users get simplified questions with analogies
   - Select your **main implementer model** — the primary AI model for coding
   - Select up to **4 council members** — the models that will debate and review work
   - Configure iteration limits and timeouts (defaults work well for most cases)

### Creating a Project

1. Click **"New Project"** in the top bar
2. Fill in the details:
   - **Name** — Your project title (e.g., "My Web App")
   - **Shortname** — 3-5 uppercase letters used for ticket IDs
   - **Icon** — Optional emoji or icon
   - **Color** — Border color for tickets (32 options; red and yellow excluded)
   - **Folder Path** — Absolute path to your git-initialized project folder
3. Click **Create**

> **Important:** The folder path must point to a git-initialized repository. LoopTroop creates isolated worktrees per ticket inside `.looptroop/worktrees/`.

### Creating a Ticket

1. Click **"New Ticket"** in the top bar
2. Fill in:
   - **Title** — What you want built (e.g., "Add user authentication")
   - **Project** — Select the project this ticket belongs to
   - **Description** — Detailed requirements (the more detail, the better)
   - **Priority** — Very High, High, Normal (default), Low, or Very Low
3. Click **Create** — The ticket appears in the **To Do** column
4. The ticket gets an auto-generated ID

### The Ticket Lifecycle

After creating a ticket, here's what happens:

1. **To Do** — Click the ticket to open the dashboard, then click **"Start"**
2. **Interview Phase** — AI generates questions; you answer them to clarify requirements
3. **PRD Approval** — Review the generated Product Requirements Document; approve or edit
4. **Beads Approval** — Review the task breakdown; approve or edit
5. **Pre-flight Check** — System verifies git status and OpenCode connectivity
6. **Coding** — AI implements each bead with tests (can take hours)
7. **Final Test** — Integration tests run on the complete implementation
8. **Integration** — Code is squashed and prepared for merge
9. **Manual Verification** — You review the result and approve the merge to main
10. **Cleanup** — Temporary branches and worktrees are cleaned up
11. **Done!** — The ticket is complete

At every approval gate, you can:
- **Approve** — Move to the next phase
- **Edit** — Modify the artifact (interview results, PRD, or beads) before proceeding
- **Re-run** — Start the planning phase from scratch

> **Cascading edits:** Editing interview results will restart PRD and Beads phases. Editing the PRD will restart the Beads phase. Warnings are shown before saving.

### The Kanban Board

The main view is a **4-column Kanban board**:

| Column | Description | States |
|--------|-------------|--------|
| **To Do** | Inactive tickets waiting to start | DRAFT |
| **In Progress** | Tickets being processed by AI | Council phases, drafting, voting, refining, coding, testing |
| **Needs Input** | Tickets waiting for user action | Interview answers, approvals, manual verification, errors |
| **Done** | Completed or canceled tickets | COMPLETED, CANCELED |

Each ticket card shows:
- Ticket ID and title
- Project icon and color (border)
- Priority indicator
- Current status
- Last update time (relative: "2 hours ago", "yesterday", etc.)
- Blue throbber for in-progress tickets
- Flashing red border for error states

The board is **read-only** — all actions happen inside the ticket dashboard.

### The Ticket Dashboard

Click any ticket to open the **split-view dashboard**:

**Left Panel — Navigator (25% width):**
- **Phase Timeline** — Accordion of all workflow states with status indicators:
  - ✅ Green check = completed
  - 🔵 Blue throbber = active/current
  - ⬜ Gray = pending/future
  - Click completed phases to review what happened (read-only)
- **Context Tree** — Hierarchical view that adapts to the current phase:
  - Interview: questions grouped by phase
  - PRD: epics → user stories
  - Beads: epic → story → bead tree with status indicators
  - Execution: bead navigator with progress (e.g., "3/5 beads done")

**Right Panel — Active Workspace (75% width):**
- Shows phase-specific content (interview Q&A, PRD editor, live execution logs, etc.)
- Smart auto-scroll for live content (pauses when you scroll up)
- Structured viewer with collapsible sections for YAML artifacts
- CodeMirror editor toggle for raw YAML editing
- Cross-links between artifacts (PRD links to interview answers, beads link to PRD stories)

**Dashboard controls:**
- Close with **Escape** key or the **X** button
- Resize panels via drag handle
- Mobile: Navigator collapses to a slide-out drawer

---

## How the AI Council Pipeline Works

Each planning phase (Interview, PRD, Beads) uses a multi-model council:

### 1. Draft Phase
- Each council member (AI model) generates a draft **in parallel**
- Fresh OpenCode session per member (no shared context between members)
- Each member receives only the phase-specific context per the prompt catalog

### 2. Voting Phase
- Each member scores **all** drafts using a **phase-specific rubric**
- Drafts are presented in **randomized order per voter** (anti-anchoring bias)
- Each rubric has **5 categories × 20 points = 100 total points**:

**Interview Rubric:** Completeness (20) + Depth (20) + Clarity (20) + Priority ordering (20) + Feasibility focus (20)

**PRD Rubric:** Completeness (20) + Technical depth (20) + Actionability (20) + Consistency (20) + Risk coverage (20)

**Beads Rubric:** Granularity (20) + Dependency correctness (20) + Test coverage (20) + Estimation accuracy (20) + Context guidance quality (20)

### 3. Refinement Phase
- The **winning draft** is refined by incorporating strong ideas from losing drafts
- Refine steps receive **only drafts** (not vote results) — per spec
- Fresh session for the refinement step

### 4. Coverage Verification
- A QA verification checks for gaps against source material
- If gaps are found → loops back to refinement
- If coverage is clean → proceeds to user approval

### Quorum Requirements
- Minimum **2 valid responses** required (configurable via `minCouncilQuorum`)
- If fewer valid responses → ticket enters `BLOCKED_ERROR`
- Responses can be `completed`, `timed_out`, or `invalid_output`

---

## How Bead Execution Works

Once beads are approved:

### Pre-flight Check ("Doctor")
Before coding starts, the system runs diagnostics:
- Git working tree is clean
- OpenCode server is responsive
- Required tools are available

### The Ralph Loop (Bead Execution)
Each bead is executed by the main AI implementer model through OpenCode:

```
┌─────────────────────────────────────┐
│         For each bead:              │
│                                     │
│  1. Create fresh OpenCode session   │
│  2. Send minimal context:           │
│     - Codebase map                  │
│     - PRD (relevant section)        │
│     - Bead specification            │
│     - Notes from prior attempts     │
│  3. AI implements code + tests      │
│  4. Run bead-scoped tests           │
│  5. Check completion marker:        │
│     - tests: pass?                  │
│     - lint: pass?                   │
│     - typecheck: pass?              │
│     - qualitative: pass?            │
│  6. If all pass → bead done ✅      │
│  7. If any fail → append notes,     │
│     increment iteration, retry      │
│  8. If max iterations → error ❌    │
└─────────────────────────────────────┘
```

### Completion Marker Format
When a bead finishes, the AI outputs a structured completion marker.

All 4 quality gates must be `"pass"`. The completion checker validates JSON structure, bead_id, status, and all 4 gates.

### Context Wipe on Retry
When a bead fails and retries:
1. Git working tree is reset to `bead_start_commit`
2. Error details and learnings are appended to the bead's `notes` field
3. A **completely fresh** OpenCode session is created
4. The new attempt receives prior notes but no session history

---

## How Crash Recovery Works

LoopTroop is designed for unattended operation that can last hours. Crash recovery is built-in:

### Dual-Authority Persistence
| Store | Authority Over | Recovery Source |
|-------|---------------|-----------------|
| **SQLite** (WAL mode) | Workflow/ticket runtime state | XState snapshots |
| **issues.jsonl** | Bead tracker data | Bead graph, status, dependencies, notes |

### What Happens on Crash

1. **Server crashes or is killed** → SQLite WAL journal survives
2. **On restart:**
   - SQLite is initialized with WAL mode pragmas
   - Non-terminal tickets are loaded from SQLite
   - XState actors are hydrated from stored snapshots
   - Active `issues.jsonl` files are reloaded as authoritative bead state
   - OpenCode sessions are validated (valid sessions are reattached, invalid ones get fresh sessions)
   - Processing resumes from the last persisted state

### How to Demo Crash Recovery

```bash
# 1. Start a ticket and let it progress past the interview phase
npm run dev

# 2. Kill the server process (Ctrl+C, or kill the PID)

# 3. Restart
npm run dev

# 4. Open the browser — the ticket resumes from its last state
# 5. SSE clients reconnect via Last-Event-ID header
```

### Atomic I/O Pipeline
- File writes use **atomic operations**: write to `.tmp` → fsync → rename
- JSONL reads **skip malformed lines** gracefully
- On startup, orphan `.tmp` files are promoted and corrupt trailing lines are truncated

---

## Project Structure

```
looptroop/
├── server/                  # Backend (Hono + SQLite + XState)
│   ├── db/                  # Database schema, init, indexes
│   ├── machines/            # XState v5 ticket state machine (26 states)
│   ├── routes/              # Hono API routes (REST + SSE)
│   ├── sse/                 # SSE broadcaster, event types
│   ├── io/                  # Atomic file I/O, JSONL, YAML
│   ├── opencode/            # OpenCode adapter, context builder, session manager
│   ├── council/             # AI council pipeline (draft/vote/refine)
│   ├── phases/              # Phase implementations (interview → cleanup)
│   ├── prompts/             # Prompt templates (PROM1-52)
│   ├── errors/              # Circuit breaker, crash recovery
│   ├── ticket/              # Ticket create/init/codebase-map
│   └── security/            # Runner scope restriction
├── src/                     # Frontend (React 19 + TanStack Query)
│   ├── components/          # Kanban, dashboard, editors, config
│   ├── hooks/               # SSE, tickets, projects, profile
│   └── context/             # UI state (localStorage persistence)
├── tests/                   # Integration tests
├── docs/                    # Detailed documentation
└── cl-prompt.md             # Product specification (source of truth)
```

---

## Configuration Reference

### Profile Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `username` | (required) | Your display name |
| `icon` | (auto) | Optional profile icon |
| `background` | (none) | Your expertise (adapts interview style) |
| `mainImplementer` | (required) | Primary AI model for coding |
| `councilMembers` | (required) | Up to 4 AI models for council deliberation |
| `maxIterations` | 5 | Max retry attempts per bead (0 = infinite) |
| `perIterationTimeout` | 20 min | Timeout per bead iteration (0 = no timeout) |
| `councilResponseTimeout` | 15 min | Timeout for council member responses |
| `minCouncilQuorum` | 2 | Minimum valid council responses (1-4) |
| `interviewQuestions` | 50 | Max interview questions (0 = infinite) |
| `disableAnalogies` | false | Disable analogies in interview questions |

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Frontend** | React | 19.x |
| **Server State** | TanStack Query | 5.90.x |
| **Styling** | Tailwind CSS | 4.2.x |
| **UI Components** | shadcn/ui | 2.5.0 |
| **Backend** | Hono | 4.12.x |
| **Database** | SQLite (better-sqlite3) | 12.x |
| **ORM** | Drizzle ORM | 0.45.x |
| **State Machine** | XState | 5.x |
| **AI Integration** | OpenCode SDK | @opencode-ai/sdk |
| **Testing** | Vitest | 4.x |
| **Build** | Vite | 7.3.x |
| **Language** | TypeScript | 5.9.x |

---

## Detailed Documentation

| Document | Description |
|----------|-------------|
| [Setup Guide](docs/setup-guide.md) | Complete step-by-step installation and setup |
| [Usage Guide](docs/usage-guide.md) | How to use every feature in detail |
| [Architecture](docs/arch.md) | System architecture, data flow, and design decisions |
| [State Machine](docs/state-machine.md) | All 26 states, transitions, events, and context |
| [API Reference](docs/api-reference.md) | Every HTTP endpoint with request/response examples |
| [Artifact Formats](docs/artifact-formats.md) | File format specs for all artifacts |
| [Council Pipeline](docs/council-pipeline.md) | How the multi-model AI council works |
| [Crash Recovery](docs/crash-recovery.md) | Persistence model and recovery mechanisms |
| [Configuration](docs/configuration.md) | All configuration options explained |
| [Troubleshooting](docs/troubleshooting.md) | Common issues and solutions |

---

## Troubleshooting

### OpenCode Not Reachable
- Ensure OpenCode is running: `opencode serve` (default port 4096)
- Check that at least one AI model is configured
- LoopTroop starts without OpenCode, but ticket operations are blocked

### SQLite Locked
- LoopTroop uses WAL mode with 5000ms busy timeout
- Stop all processes, restart: `npm run dev`
- Circuit breaker trips after 3 consecutive DB failures

### Git Conflicts
- LoopTroop uses isolated worktrees per ticket
- Conflicts during integration → `BLOCKED_ERROR`
- Resolve in the worktree, then click Retry

### Model Timeouts
- Increase `perIterationTimeout` or `councilResponseTimeout` in Profile settings
- Council quorum requires ≥2 valid responses

### Tests Failing
```bash
npm run test           # Run all 238 tests
npm run test:watch     # Watch mode
npm run typecheck      # Type checking
npm run lint           # Linting
```

---

## License

Private — see repository for details.
