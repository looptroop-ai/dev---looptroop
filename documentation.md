# LoopTroop Documentation

Complete documentation for the LoopTroop AI orchestration platform. This file serves as the comprehensive documentation hub — see the `docs/` directory for deep dives into specific topics.

---

## 1. What LoopTroop Is

LoopTroop is a local-first AI orchestration system for autonomous software development. It manages the full lifecycle of a development task — from requirements gathering through coding, testing, and integration — using an AI council of multiple models.

### Core Goals
- **Context Rot Prevention**: Fresh AI sessions per task step; no accumulated hallucination drift
- **Correctness over Speed**: Multi-model council deliberation ensures quality
- **User Control**: Approval gates at every major phase transition
- **Crash Safety**: SQLite + WAL persistence survives unexpected shutdowns

### What It's For
- Autonomous implementation of well-scoped features using AI agents
- Interview-driven requirements → PRD → implementation beads → execution
- Complex features where a perfect result is more valuable than a quick one
- Tasks that can run unattended for hours (designed for 10+ hour execution)

### What It's Not For
- Real-time pair programming (this is an autonomous orchestrator)
- Simple one-off code generation tasks (use IDE+AI instead)
- Cost-sensitive use cases (multi-model councils are expensive)
- Urgent delivery (optimized for correctness, not speed)

---

## 2. Local Setup & One-Command Dev Start

### Prerequisites
- **Node.js 24.x LTS** ("Krypton")
- **OpenCode** installed and configured with at least one AI model
- **Git** initialized project repository

### Quick Start
```bash
# Install dependencies
npm install

# Start OpenCode server (separate terminal)
opencode serve

# Start LoopTroop dev server
npm run dev
```

The app opens at `http://localhost:5173`. The backend API runs on the same port via Vite proxy.

### For Long Unattended Runs
```bash
NODE_OPTIONS="--max-old-space-size=4096" npm run dev
```

📖 **Detailed guide:** [docs/setup-guide.md](docs/setup-guide.md)

---

## 3. How to Run Tests, Lint, Typecheck

```bash
# Run all tests (Vitest) — 238 tests across 22 files
npm run test

# Type checking (TypeScript strict mode)
npm run typecheck

# Linting (ESLint 9 flat config)
npm run lint

# Build for production
npm run build

# Run specific test file
npx vitest run server/machines/__tests__/ticketMachine.test.ts

# Watch mode for development
npm run test:watch
```

All three checks (test, typecheck, lint) must pass.

---

## 4. How to Demo the Kanban Board & Ticket Dashboard

1. Start the dev server: `npm run dev`
2. Open `http://localhost:5173`
3. The Kanban board displays 4 columns: **To Do**, **In Progress**, **Needs Input**, **Done**
4. Create a profile via the configuration button (set username, select models)
5. Create a project via "New Project" (give it a name, shortname, and folder path)
6. Create a ticket — it appears in the "To Do" column
7. Click any ticket card to open the **split-view dashboard**:
   - **Navigator panel** (left, 25%) shows the phase timeline with status indicators
   - **Active Workspace** (right, 75%) shows phase-specific content
8. In the **Phase Timeline**, completed phases show ✅, active shows 🔵, pending shows ⬜
9. Click completed phases to review historical content (read-only)
10. Press `Escape` or click X to close the dashboard
11. Test responsive design:
    - Mobile (< 768px): Navigator becomes slide-out drawer
    - Tablet (768-1280px): Compressed layout
    - Desktop (> 1280px): Full split-view with drag-to-resize

📖 **Detailed guide:** [docs/usage-guide.md](docs/usage-guide.md)

---

## 5. How to Demo the Full AI Council Pipeline

### With Real OpenCode
1. Start OpenCode: `opencode serve`
2. Configure 3+ models in your OpenCode config for full council diversity
3. Create a profile in LoopTroop with council members selected
4. Create a project pointing to your repo folder
5. Create a ticket with a detailed description
6. Click "Start" on the ticket
7. Watch the council pipeline:
   - **Interview**: Models generate questions → vote → refine → you answer
   - **PRD**: Models draft PRD → vote → refine → you approve
   - **Beads**: Models break down tasks → vote → refine → you approve
   - **Execution**: Main implementer codes each bead → tests → completion

### With Mock Server (for testing)
```bash
# Run integration tests with mock adapter
npm run test

# The mock adapter simulates all OpenCode interactions:
# - Session creation and management
# - Streaming responses
# - Health checks
# - Multi-model drafting and voting
```

### What to Look For
- **Draft phase**: Watch streaming output from each model in parallel
- **Vote phase**: See anonymized scoring with phase-specific rubrics (5×20=100)
- **Refine phase**: Winner draft enhanced with ideas from losing drafts
- **Coverage phase**: QA verification loops back if gaps found
- **Approval gates**: Review and edit artifacts before proceeding

📖 **Detailed guide:** [docs/council-pipeline.md](docs/council-pipeline.md)

---

## 6. How to Demo Crash Recovery

1. Start the dev server with a ticket in progress:
   ```bash
   npm run dev
   # Create a profile, project, ticket, and click "Start"
   # Let it progress past the interview council phase
   ```

2. Kill the server process:
   ```bash
   # Press Ctrl+C in the terminal running npm run dev
   # Or: kill $(pgrep -f "tsx watch server/index.ts")
   ```

3. Restart:
   ```bash
   npm run dev
   ```

4. Verify recovery:
   - Open the browser (refresh if needed)
   - The ticket should be in **exactly the same state** as before the kill
   - XState machines are hydrated from SQLite snapshots
   - SSE clients reconnect via `Last-Event-ID` header
   - Processing resumes from the last persisted state

### What's Recovered
- **SQLite (WAL mode)** — Ticket states, XState snapshots, session metadata
- **issues.jsonl** — Bead statuses, dependencies, error notes
- **Atomic I/O** — Orphan `.tmp` files promoted, corrupt JSONL lines truncated

### Programmatic Test
```bash
npm run test -- --grep "recovers from crash"
```

📖 **Detailed guide:** [docs/crash-recovery.md](docs/crash-recovery.md)

---

## 7. Repo Structure Overview

```
looptroop/
├── server/                  # Backend (Hono + SQLite + XState)
│   ├── db/                  # Database schema, init, indexes (Drizzle ORM)
│   ├── machines/            # XState v5 ticket state machine (26 states)
│   ├── routes/              # Hono API routes (REST + SSE streaming)
│   ├── sse/                 # SSE broadcaster, event types, stream bypass
│   ├── io/                  # Atomic file I/O (YAML, JSONL, recovery)
│   ├── opencode/            # OpenCode adapter, context builder, sessions
│   ├── council/             # AI council pipeline (draft/vote/refine/quorum)
│   ├── phases/              # Phase implementations
│   │   ├── interview/       # Interview Q&A + coverage
│   │   ├── prd/             # PRD generation + coverage
│   │   ├── beads/           # Beads breakdown + dependency graph
│   │   ├── preflight/       # Doctor diagnostics
│   │   ├── execution/       # Bead scheduler + executor + completion checker
│   │   ├── finalTest/       # Final test generation
│   │   ├── integration/     # Squash + merge preparation
│   │   ├── verification/    # Manual verification
│   │   └── cleanup/         # Resource cleanup
│   ├── errors/              # Error handling, circuit breaker, recovery
│   ├── security/            # Runner scope restriction
│   ├── ticket/              # Ticket create/init/codebase-map
│   ├── log/                 # Execution log (append-only JSONL)
│   ├── prompts/             # Prompt templates (PROM1-52)
│   └── middleware/          # Request validation (Zod)
├── src/                     # Frontend (React 19 + TanStack Query)
│   ├── components/
│   │   ├── kanban/          # 4-column Kanban board
│   │   ├── ticket/          # Dashboard, header, navigator, workspace
│   │   ├── navigator/       # Phase timeline, context tree, status indicators
│   │   ├── workspace/       # Phase-specific views (draft, council, approval, etc.)
│   │   ├── editor/          # Structured viewer, cascade warnings, edit mode
│   │   ├── config/          # Profile setup, model selector
│   │   ├── project/         # Project form, color picker
│   │   ├── shared/          # Toast, empty states, keyboard shortcuts, auto-scroll
│   │   ├── layout/          # App shell, dark mode
│   │   └── ui/              # shadcn/ui components
│   ├── context/             # UI state context (localStorage persistence)
│   ├── hooks/               # React hooks (SSE, tickets, projects, profile)
│   └── lib/                 # Utilities, query client
├── tests/                   # Integration tests
├── docs/                    # Detailed documentation (10 docs)
├── cl-prompt.md             # Product specification (source of truth)
├── plans.md                 # Milestone plan
├── implement.md             # Execution instructions
└── documentation.md         # This file
```

📖 **Detailed architecture:** [docs/arch.md](docs/arch.md)

---

## 8. Artifact File Format Overview

### interview.yaml
Questions and answers from the AI-driven interview process.
```yaml
schema_version: 1
ticket_id: "PROJ-1"
artifact: "interview"
status: "approved"              # draft | approved
generated_by:
  winner_model: "provider/model"
  generated_at: "2026-02-06T14:58:00Z"
questions:
  - id: "Q1"
    prompt: "What features should be included?"
    answer_type: "free_text"    # free_text | single_choice | multi_choice | boolean
    options: []
    answer:
      skipped: false
      selected_option_ids: []
      free_text: "User-provided answer"
      answered_by: "user"
      answered_at: "2026-02-06T15:00:00Z"
follow_up_rounds: []
summary:
  goals: []
  constraints: []
  non_goals: []
approval:
  approved_by: "user"
  approved_at: "2026-02-06T15:30:00Z"
```

### prd.yaml
Product Requirements Document with epics and user stories.
```yaml
schema_version: 1
ticket_id: "PROJ-1"
artifact: "prd"
status: "approved"
source_interview:
  content_sha256: "<sha256 of interview.yaml>"
product:
  problem_statement: "Project overview"
  target_users: []
scope:
  in_scope: []
  out_of_scope: []
technical_requirements:
  architecture_constraints: []
  data_model: []
  api_contracts: []
  security_constraints: []
  performance_constraints: []
  reliability_constraints: []
  error_handling_rules: []
  tooling_assumptions: []
epics:
  - id: "EPIC-1"
    title: "Epic title"
    objective: "..."
    user_stories:
      - id: "US-1"
        title: "Story title"
        acceptance_criteria: ["criterion 1"]
        implementation_steps: []
        verification:
          required_commands: []
risks: []
approval:
  approved_by: "user"
  approved_at: "2026-02-06T15:30:00Z"
```

### codebase-map.yaml
Auto-generated project structure map (created by SYS on ticket start).
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
summary:
  total_files: 128
  by_language:
    TypeScript: 44
    Markdown: 9
manifests:
  - "package.json"
files:
  - "src/auth/LoginForm.tsx"
  - "src/auth/useAuth.ts"
```

### issues.jsonl
Implementation beads — authoritative task graph (one JSON object per line, 22 fields each).
```jsonl
{"id":"PROJ-1-EPIC-1-US-1-task1-h7qd","priority":1,"title":"Implement login error state","status":"pending","issue_type":"task","external_ref":"PROJ-1","prd_references":"EPIC-1 / US-1","labels":["ticket:PROJ-1","epic:EPIC-1","story:US-1"],"description":"Add inline error handling...","context_guidance":{"patterns":["Use AppError class"],"anti_patterns":["Do not use alert()"]},"acceptance_criteria":"Show non-blocking inline message","dependencies":{"blocked_by":[],"blocks":[]},"target_files":["src/auth/LoginForm.tsx"],"tests":["Login error banner appears"],"test_commands":["npm test -- --grep \"login error\""],"notes":"","iteration":1,"created_at":"2026-02-06T16:10:00Z","updated_at":"2026-02-06T16:10:00Z","completed_at":"","started_at":"","bead_start_commit":""}
```

📖 **Complete field definitions:** [docs/artifact-formats.md](docs/artifact-formats.md)

---

## 9. Troubleshooting

### OpenCode Not Reachable
- Ensure OpenCode is running: `opencode serve`
- Check the configured port matches your setup (default: 4096)
- Verify at least one AI model is configured
- LoopTroop starts without OpenCode but blocks ticket operations

### SQLite Locked
- LoopTroop uses WAL mode with 5000ms busy timeout
- If locked: stop all processes, restart the server
- Circuit breaker trips after 3 consecutive DB failures (auto-recovers after 30s)

### Git Conflicts
- LoopTroop uses isolated worktrees per ticket
- Merge conflicts during integration → `BLOCKED_ERROR`
- Resolve manually in `.looptroop/worktrees/<ticket-id>/`, then retry

### Model Timeouts
- Increase timeout in Profile settings:
  - `perIterationTimeout` for bead execution (default: 20 min)
  - `councilResponseTimeout` for council phases (default: 15 min)
- Council quorum requires ≥2 valid responses (configurable)

### Memory Issues
- Boot with `NODE_OPTIONS="--max-old-space-size=4096"` for long runs
- Large artifacts use streaming reads (never full file loads)
- SSE broadcaster manages memory-safe broadcasting

### SSE Reconnection
- Client auto-reconnects after 3s disconnect
- `Last-Event-ID` header replays missed events
- Backend continues processing during client disconnect — no data loss

### YAML Parse Errors
- Use the structured viewer to identify syntax issues
- Toggle to CodeMirror raw editor for manual fixes
- Malformed JSONL lines are automatically skipped on read

📖 **Complete troubleshooting guide:** [docs/troubleshooting.md](docs/troubleshooting.md)

---

## Documentation Map

| Document | Content |
|----------|---------|
| [README.md](README.md) | Quick start, overview, project structure |
| [documentation.md](documentation.md) | This file — comprehensive hub |
| [docs/setup-guide.md](docs/setup-guide.md) | Step-by-step installation |
| [docs/usage-guide.md](docs/usage-guide.md) | How to use every feature |
| [docs/arch.md](docs/arch.md) | System architecture deep dive |
| [docs/state-machine.md](docs/state-machine.md) | All 26 states, transitions, events |
| [docs/api-reference.md](docs/api-reference.md) | Complete REST/SSE API |
| [docs/artifact-formats.md](docs/artifact-formats.md) | File format specifications |
| [docs/council-pipeline.md](docs/council-pipeline.md) | Multi-model council details |
| [docs/crash-recovery.md](docs/crash-recovery.md) | Persistence and recovery |
| [docs/configuration.md](docs/configuration.md) | All configuration options |
| [docs/troubleshooting.md](docs/troubleshooting.md) | Common issues and solutions |
| [cl-prompt.md](cl-prompt.md) | Product specification (source of truth) |
