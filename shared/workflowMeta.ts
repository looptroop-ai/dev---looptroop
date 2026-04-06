export type KanbanPhase = 'todo' | 'in_progress' | 'needs_input' | 'done'
type WorkflowGroupId = 'todo' | 'interview' | 'prd' | 'beads' | 'execution' | 'done'
type WorkflowUIView = 'draft' | 'council' | 'interview_qa' | 'approval' | 'coding' | 'error' | 'done' | 'canceled'
export type EditableArtifactType = 'interview' | 'prd' | 'beads'
export type WorkflowContextKey =
  | 'ticket_details'
  | 'relevant_files'
  | 'drafts'
  | 'interview'
  | 'full_answers'
  | 'user_answers'
  | 'votes'
  | 'prd'
  | 'beads'
  | 'beads_draft'
  | 'tests'
  | 'bead_data'
  | 'bead_notes'
  | 'error_context'

export interface WorkflowPhaseDetails {
  overview: string
  steps: readonly string[]
  outputs: readonly string[]
  transitions: readonly string[]
  notes?: readonly string[]
}

export interface WorkflowPhaseMeta {
  id: string
  label: string
  description: string
  details: WorkflowPhaseDetails
  kanbanPhase: KanbanPhase
  groupId: WorkflowGroupId
  uiView: WorkflowUIView
  editable: boolean
  multiModelLogs: boolean
  reviewArtifactType?: EditableArtifactType
  progressKind?: 'questions' | 'beads'
  contextSummary: WorkflowContextKey[]
  contextSections?: readonly WorkflowContextSection[]
}

export interface WorkflowGroupMeta {
  id: WorkflowGroupId
  label: string
}

export interface WorkflowContextSection {
  label: string
  description?: string
  keys: readonly WorkflowContextKey[]
}

function mergeContextSections(sections: readonly WorkflowContextSection[]): WorkflowContextKey[] {
  const merged: WorkflowContextKey[] = []
  for (const section of sections) {
    for (const key of section.keys) {
      if (!merged.includes(key)) merged.push(key)
    }
  }
  return merged
}

const WORKFLOW_PHASE_DETAILS = {
  DRAFT: {
    overview: 'The ticket exists as a backlog item only. No AI work, planning run, or execution state has started yet. The ticket is fully user-controlled and editable — you can change the title, description, priority, and project assignment before launching the workflow.',
    steps: [
      'LoopTroop stores the ticket title, description, priority, project, and other editable metadata.',
      'The workspace stays user-driven: you can refine the title or description before any workflow artifacts are generated.',
      'No relevant-files scan, interview artifact, PRD, beads plan, or runtime worktree activity is performed in this state.',
      'When Start is triggered, LoopTroop locks the council configuration (main implementer and council members), initializes the ticket workspace directory, and begins the planning pipeline from the first active AI phase.',
    ],
    outputs: [
      'Ticket metadata only (title, description, priority, project association).',
      'No planning artifacts beyond the ticket record itself.',
      'Status is still fully user-controlled through Start or Cancel actions.',
    ],
    transitions: [
      'Start moves the ticket into Scanning Relevant Files.',
      'Cancel moves the ticket directly to Canceled.',
    ],
    notes: [
      'This is the only phase where the ticket is intentionally inactive.',
      'No AI-owned files are expected to exist yet.',
      'Context received: Ticket Details only.',
    ],
  },
  SCANNING_RELEVANT_FILES: {
    overview: 'LoopTroop performs a focused codebase scan before council work starts so later phases can reference the right files instead of guessing. This is a single-model phase using the locked main implementer — not a multi-council step.',
    steps: [
      'LoopTroop builds a minimal prompt from the ticket title and description (Ticket Details context) and sends it to the locked main implementer.',
      'The model identifies likely relevant files, explains why they matter, and returns structured file excerpts for downstream context.',
      'LoopTroop validates the structured output against expected schema. If validation fails, it automatically retries once, either in the same session or in a fresh session.',
      'On success, LoopTroop writes the canonical `relevant-files.yaml` artifact and stores a summarized scan artifact for UI review.',
      'Phase logs capture the session lifecycle, prompt dispatch, retries, and final extracted file count.',
    ],
    outputs: [
      'Canonical `relevant-files.yaml` inside the ticket workspace — this becomes a reusable context artifact for all subsequent phases.',
      'Structured scan artifact with file paths, rationales, relevance levels, and content previews.',
      'Relevant-file context that later interview, PRD, and beads phases can reuse without re-scanning.',
    ],
    transitions: [
      'A valid scan advances the ticket to AI Council Thinking.',
      'Validation failure after retry, timeout, missing implementer config, or runtime errors route the ticket to Blocked Error.',
    ],
    notes: [
      'This phase is single-model, not multi-council.',
      'The scan is context-building only; it does not modify source files.',
      'Context received: Ticket Details only.',
    ],
  },
  COUNCIL_DELIBERATING: {
    overview: 'The interview council creates competing interview/question drafts so the system can compare multiple approaches before asking you anything. This is the first multi-model phase — each configured council member works independently and in parallel.',
    steps: [
      'LoopTroop loads the ticket details and relevant-files artifact as the shared prompt context for the council.',
      'Each configured council model drafts an interview approach independently instead of collaborating on a single first draft.',
      'LoopTroop tracks per-model progress, streams model logs, and checks quorum so the phase can fail fast if council participation collapses.',
      'Each completed draft is persisted as a council artifact for later review and for the voting phase.',
    ],
    outputs: [
      'A set of competing interview drafts — one from each council member.',
      'Per-model draft progress and session logs viewable in the phase log panel.',
      'Persisted council draft artifacts for side-by-side comparison in the voting phase.',
    ],
    transitions: [
      'When enough valid drafts are complete (quorum met), the workflow advances to Selecting Best Questions.',
      'Council failures such as missing quorum, unrecoverable generation errors, or cancellation route to Blocked Error or Canceled as appropriate.',
    ],
    notes: [
      'This is the first multi-model phase in the workflow.',
      'Context received: Relevant Files + Ticket Details.',
    ],
  },
  COUNCIL_VOTING_INTERVIEW: {
    overview: 'The council scores the interview drafts against the voting rubric and selects the strongest candidate to become the canonical interview basis. Each member scores all drafts, not just their own.',
    steps: [
      'LoopTroop anonymizes the available interview drafts so models cannot identify their own output, and builds the interview vote prompt with the scoring rubric.',
      'Council members score every draft independently rather than voting only for their own output.',
      'LoopTroop records presentation order, vote payloads, quorum state, and member outcomes for audit purposes.',
      'The vote resolver totals the scores across all members and identifies the winning draft for refinement/compilation.',
    ],
    outputs: [
      'Voting artifacts with per-model rubric scores and outcomes.',
      'A resolved winning interview draft reference.',
      'Audit data showing how the council arrived at the selection, including score spread and presentation order.',
    ],
    transitions: [
      'A successful winner selection advances the workflow to Preparing Interview.',
      'Voting failures, invalid vote structure, or quorum collapse route the ticket to Blocked Error.',
    ],
    notes: [
      'Context received: Relevant Files + Ticket Details + Competing Drafts.',
    ],
  },
  COMPILING_INTERVIEW: {
    overview: 'LoopTroop turns the winning interview draft into the normalized interview session structure that the user can answer. This is a single-model phase using the winning model.',
    steps: [
      'The winning interview draft is consolidated into a single normalized interview artifact with standardized question format.',
      'LoopTroop builds the interview session snapshot, including question views, ordering, batch state, and completion bookkeeping.',
      'The canonical interview YAML and session artifacts are written into the ticket workspace.',
      'UI-friendly companion artifacts are generated so the interview screen can render structured questions with proper types (free-text, choice, etc.).',
    ],
    outputs: [
      'Canonical interview artifact in the ticket workspace.',
      'Interview session snapshot with batch state and question ordering.',
      'Normalized question set ready for user interaction in the interview UI.',
    ],
    transitions: [
      'Once the interview session is ready, the workflow moves to Interviewing.',
      'Normalization or persistence failures route the ticket to Blocked Error.',
    ],
    notes: [
      'This phase produces the first user-facing artifact in the planning flow.',
      'Context received: Relevant Files + Ticket Details + Competing Drafts.',
    ],
  },
  WAITING_INTERVIEW_ANSWERS: {
    overview: 'LoopTroop pauses for user input and runs an adaptive interview loop until the current question set is answered or explicitly skipped. This is a user-input phase — no AI work happens until you submit or skip the current batch.',
    steps: [
      'The workspace presents the current interview batch, any previously answered questions, and the editable answer controls (free-text or choice-based depending on question type).',
      'As you answer, skip, or unskip items, LoopTroop updates the in-memory batch draft state and later persists the submitted answers into the interview session snapshot.',
      'Submitted batches are normalized into the canonical interview state so downstream phases see a clean record of answered and skipped items.',
      'If coverage later finds missing information, the workflow can return here with a targeted follow-up batch instead of restarting the entire interview — so you may see this phase more than once.',
      'You can also skip all remaining questions, which finalizes the current answers and lets coverage decide whether the interview is sufficient.',
    ],
    outputs: [
      'Recorded user answers and skip decisions persisted into the interview session.',
      'Updated interview session snapshot and canonical interview YAML.',
      'Question history grouped across initial and follow-up rounds.',
    ],
    transitions: [
      'Submitting or skipping the active batch moves the workflow to Coverage Check (Interview).',
      'Coverage can send the ticket back here with additional targeted follow-up questions.',
      'Skip-all finalizes the remaining unanswered questions as skipped, then continues to Coverage Check (Interview).',
    ],
    notes: [
      'This is a user-input phase, so the workflow is intentionally paused until you act.',
      'Context received: Relevant Files + Ticket Details + Interview Results + User Answers.',
      'This phase may appear multiple times if coverage generates follow-up rounds.',
    ],
  },
  VERIFYING_INTERVIEW_COVERAGE: {
    overview: 'The interview winner re-checks the ticket description and all recorded answers against the current interview results to decide whether more questions are still needed. This is a budgeted loop — it tracks how many follow-up rounds have been used.',
    steps: [
      'LoopTroop loads the canonical interview, the ticket description, and a normalized answer summary for the winning interview model.',
      'The model returns a structured coverage result indicating whether the interview is clean (all needed info collected) or still has gaps.',
      'If gaps remain and the follow-up budget allows it, LoopTroop generates targeted follow-up questions, records them in the session snapshot, and prepares a new interview batch.',
      'If the interview is clean, LoopTroop refreshes the canonical interview artifact and stores the clean coverage result for audit and UI review.',
      'Coverage history artifacts capture the response, parsed result, follow-up budget usage, and any structural repair metadata.',
    ],
    outputs: [
      'Interview coverage artifact describing clean status or remaining gaps.',
      'Potentially new follow-up questions and updated batch state (if gaps found).',
      'A refreshed canonical interview artifact when the interview is finalized as clean.',
    ],
    transitions: [
      'If follow-up questions are needed, the workflow returns to Interviewing (WAITING_INTERVIEW_ANSWERS).',
      'If the interview is clean, the workflow advances to Approving Interview.',
      'Coverage execution failures route the ticket to Blocked Error.',
    ],
    notes: [
      'Coverage can loop more than once, but it is budgeted and explicitly tracked.',
      'Context received: Ticket Details + User Answers + Interview Results.',
    ],
  },
  WAITING_INTERVIEW_APPROVAL: {
    overview: 'The interview is ready for human review. You can inspect, edit, and approve the normalized interview before PRD drafting begins. This is a user-input gate — no AI work proceeds until you approve.',
    steps: [
      'LoopTroop exposes the canonical interview in structured and raw-editing forms so the approved version is explicit.',
      'You can adjust answers or the raw YAML, and the UI keeps temporary unsaved draft state between view changes.',
      'Saving writes the updated interview artifact back to the ticket workspace and refreshes ticket caches.',
      'Approval locks in the current interview results as the authoritative source material for PRD drafting.',
      'Editing interview results after approval (if you navigate back) will trigger a cascade warning because PRD and beads data may need to be regenerated.',
    ],
    outputs: [
      'Approved interview artifact or user-edited replacement.',
      'Optional persisted UI draft state while editing.',
      'A final interview version that downstream PRD generation treats as authoritative.',
    ],
    transitions: [
      'Approve advances the workflow to Drafting Specs.',
      'Cancel moves the ticket to Canceled.',
    ],
    notes: [
      'This is the review artifact gate for the interview phase.',
      'No context is passed to AI in this phase — it is entirely user-driven.',
    ],
  },
  DRAFTING_PRD: {
    overview: 'The PRD council produces competing specification drafts from the approved interview, relevant files, and ticket context. This is a 2-part phase: Part 1 fills in any skipped interview answers with AI-generated responses, and Part 2 uses the complete answer set to generate the PRD drafts.',
    steps: [
      'Part 1 — Answering Skipped Questions: LoopTroop loads the relevant files, ticket details, and interview results. Where skipped interview answers exist, the model generates full-answer context so the PRD council has a complete working basis.',
      'Part 2 — Generating PRD Drafts: LoopTroop loads the relevant files, ticket details, and full answers (including AI-filled responses). Each council model independently produces a PRD candidate rather than editing a shared draft.',
      'LoopTroop normalizes draft output, records draft metrics and structured-output diagnostics, and persists the draft artifacts for later voting.',
      'Each completed draft follows a consistent structure with requirements, acceptance criteria, edge cases, and test intent.',
    ],
    outputs: [
      'Competing PRD drafts — one from each council member.',
      'Draft metrics and structured-output diagnostics.',
      'Full-answer context artifact used to fill interview gaps during PRD generation (produced in Part 1).',
    ],
    transitions: [
      'When enough valid PRD drafts are ready (quorum met), the workflow advances to Voting on Specs.',
      'Draft generation failures or quorum problems route the ticket to Blocked Error.',
    ],
    notes: [
      'This phase has 2 internal parts with different context inputs: Part 1 receives Relevant Files + Ticket Details + Interview Results; Part 2 receives Relevant Files + Ticket Details + Full Answers.',
      'The PRD phase is the first stage that converts interview intent into a formal implementation specification.',
    ],
  },
  COUNCIL_VOTING_PRD: {
    overview: 'The council scores the PRD candidates against the PRD rubric to choose the strongest specification baseline. Each member scores all drafts independently.',
    steps: [
      'LoopTroop anonymizes the PRD drafts and prepares the PRD voting prompt with weighted rubric categories.',
      'Council members score every draft independently and submit structured vote payloads.',
      'Vote order, scoring, and member outcomes are persisted for later review and audit.',
      'The vote resolver totals scores across all members and chooses the winning PRD draft.',
    ],
    outputs: [
      'PRD vote artifacts with per-model rubric scores.',
      'A winning PRD draft reference.',
      'Audit data showing the selected draft, score spread, and presentation order.',
    ],
    transitions: [
      'Winner selection advances the workflow to Refining Specs.',
      'Voting failures or malformed vote output route the ticket to Blocked Error.',
    ],
    notes: [
      'Context received: Relevant Files + Ticket Details + Interview Results + Competing Drafts.',
    ],
  },
  REFINING_PRD: {
    overview: 'The winning PRD draft is upgraded into PRD Candidate v1 by pulling useful improvements from the losing drafts without losing the winning structure. The winning model performs this refinement.',
    steps: [
      'LoopTroop gives the winning model the winning draft plus the losing drafts so it can selectively merge stronger requirements, tests, and edge cases.',
      'The refinement output is normalized and validated as a proper PRD document with consistent structure.',
      'LoopTroop persists the refined PRD candidate and any UI diff metadata that explains how the winner changed during refinement.',
      'The resulting PRD Candidate v1 becomes the baseline for coverage verification.',
    ],
    outputs: [
      'Refined PRD candidate artifact (PRD Candidate v1).',
      'Optional refinement diff metadata for UI inspection.',
      'Normalized PRD content ready for coverage passes.',
    ],
    transitions: [
      'A valid refined candidate advances to Coverage Check (PRD).',
      'Refinement validation failures route the ticket to Blocked Error.',
    ],
    notes: [
      'Context received: Relevant Files + Ticket Details + Full Answers + Competing Drafts.',
    ],
  },
  VERIFYING_PRD_COVERAGE: {
    overview: 'LoopTroop runs a versioned PRD coverage loop against the approved interview, revising the PRD until it is clean or the fixed PRD coverage cap is reached. PRD coverage can produce up to PRD Candidate v3. Unlike the interview coverage loop, gap resolution stays inside this same phase rather than bouncing back to a separate phase.',
    steps: [
      'The winning PRD model compares the current PRD candidate against the approved interview and full answers, returning a structured coverage result.',
      'If gaps are found, LoopTroop records the attempt, asks for a revision, validates the revision, and promotes the next candidate version inside the same phase, up to PRD Candidate v3.',
      'Coverage attempts and transitions are persisted so the UI can show what changed between PRD versions and why.',
      'If the PRD becomes clean, the clean result is recorded and the current candidate becomes the approval candidate.',
      'If the fixed PRD coverage cap is reached, LoopTroop still advances using the latest candidate while preserving the unresolved-gap history for approval review.',
    ],
    outputs: [
      'Versioned PRD coverage attempts and transition history.',
      'Latest PRD candidate after zero or more coverage revisions.',
      'Structured diagnostics about repair attempts, retries, and unresolved gaps.',
    ],
    transitions: [
      'A clean candidate advances to Approving Specs.',
      'If the PRD coverage cap is reached, the latest candidate still advances to Approving Specs with warnings preserved.',
      'Coverage execution or revision failures route the ticket to Blocked Error.',
    ],
    notes: [
      'Unlike the interview loop, PRD gap resolution stays inside the same phase rather than bouncing back to refinement.',
      'Context received: Interview Results + Full Answers + PRD.',
    ],
  },
  WAITING_PRD_APPROVAL: {
    overview: 'The latest PRD candidate is ready for human review and approval before architecture planning starts. This is a user-input gate — no AI work proceeds until you approve.',
    steps: [
      'LoopTroop renders the PRD in structured and raw YAML modes so you can review it at either level.',
      'Edits are saved back into the canonical PRD file, with temporary UI draft state preserved while you work.',
      'Coverage warnings remain visible if the latest PRD candidate advanced after exhausting the fixed PRD coverage loop rather than becoming fully clean.',
      'Approval confirms the current PRD as the authoritative input for beads drafting.',
      'Editing the PRD after approval (if you navigate back) will trigger a cascade warning because beads data may need to be regenerated.',
    ],
    outputs: [
      'Approved PRD artifact or user-edited replacement.',
      'Optional UI draft state for structured and raw edits.',
      'A locked PRD baseline for the beads council.',
    ],
    transitions: [
      'Approve advances the workflow to Architecting Beads.',
      'Cancel moves the ticket to Canceled.',
    ],
    notes: [
      'This is the review artifact gate for the PRD phase.',
      'No context is passed to AI in this phase — it is entirely user-driven.',
    ],
  },
  DRAFTING_BEADS: {
    overview: 'The beads council decomposes the approved PRD into implementable tasks, tests, and execution guidance. Each council member independently proposes a semantic beads blueprint — a task-level breakdown of the implementation plan.',
    steps: [
      'LoopTroop loads the approved PRD, ticket details, and relevant-files context into the beads drafting prompt.',
      'Each council member independently proposes a semantic beads blueprint with task descriptions, acceptance criteria, dependencies, and test intent.',
      'Draft output is normalized, validated against expected schema, and stored as council draft artifacts with draft metrics (task counts, structure depth).',
      'The resulting drafts become the candidate architecture plans for council voting.',
    ],
    outputs: [
      'Competing beads blueprint drafts — one from each council member.',
      'Draft metrics for task counts, structure, and dependency analysis.',
      'Council artifacts for later voting and refinement.',
    ],
    transitions: [
      'Valid drafts (quorum met) advance the workflow to Voting on Architecture.',
      'Drafting failures or quorum issues route the ticket to Blocked Error.',
    ],
    notes: [
      'Context received: Relevant Files + Ticket Details + PRD.',
    ],
  },
  COUNCIL_VOTING_BEADS: {
    overview: 'The council ranks the competing beads blueprints to pick the most credible implementation plan. Each member scores all blueprints for decomposition quality, feasibility, and testability.',
    steps: [
      'LoopTroop anonymizes the beads drafts and prepares the beads voting prompt with the architecture rubric.',
      'Council members score every blueprint independently for decomposition quality, feasibility, and testability.',
      'Votes, presentation order, and model outcomes are stored as artifacts for audit.',
      'The vote resolver selects the winning beads draft for final refinement.',
    ],
    outputs: [
      'Beads voting artifacts with per-model scorecards.',
      'A winning semantic blueprint reference.',
      'Audit history showing why the blueprint won, including score spread.',
    ],
    transitions: [
      'Winner selection advances the workflow to Finalizing Plan.',
      'Voting failures route the ticket to Blocked Error.',
    ],
    notes: [
      'Context received: Relevant Files + Ticket Details + PRD + Competing Drafts.',
    ],
  },
  REFINING_BEADS: {
    overview: 'The winning beads draft stays the backbone while LoopTroop pulls in stronger tasks, tests, constraints, and edge cases from the losing drafts. The refined output remains a semantic plan — execution-specific fields are added later during expansion.',
    steps: [
      'The winning model receives the winning and losing beads drafts and produces a single refined semantic blueprint.',
      'LoopTroop normalizes the refinement output, preserves attribution metadata where possible, and stores UI diff artifacts for review.',
      'The refined semantic blueprint stays intentionally pre-execution at this point; execution-only fields (commands, runtime paths) are not final yet.',
      'The refined candidate is then handed to the beads coverage loop for final validation.',
    ],
    outputs: [
      'Refined semantic beads blueprint.',
      'Refinement attribution and diff metadata for the UI.',
      'A clean candidate structure for coverage review.',
    ],
    transitions: [
      'A valid refined blueprint advances to Coverage Check (Beads).',
      'Refinement failures route the ticket to Blocked Error.',
    ],
    notes: [
      'This phase still works on the semantic plan, not the final execution-expanded bead records.',
      'Context received: Relevant Files + Ticket Details + PRD + Competing Drafts.',
    ],
  },
  VERIFYING_BEADS_COVERAGE: {
    overview: 'LoopTroop verifies the semantic beads blueprint against the approved PRD, revises it until acceptable, and then expands the final blueprint into execution-ready bead records. This is a 2-part phase: Part 1 is the coverage review loop, and Part 2 is the final expansion that transforms the semantic blueprint into execution-ready bead data.',
    steps: [
      'Part 1 — Coverage Review: The winning beads model compares the current semantic blueprint against the PRD and returns a structured clean-or-gaps result.',
      'Part 1 continued: If gaps remain, LoopTroop records the attempt, requests a targeted revision, validates the revision, and promotes the next blueprint version inside the same phase. This can repeat until clean or until the fixed beads coverage cap is reached.',
      'Coverage attempt history is persisted so unresolved gaps and candidate transitions stay inspectable.',
      'Part 2 — Final Expansion: After the blueprint is clean (or the beads coverage cap is reached), LoopTroop runs the expansion step that adds execution-oriented fields (commands, runtime paths, dependency graph) and writes the runtime bead data.',
      'The expanded output becomes the approval candidate shown in the beads approval UI.',
    ],
    outputs: [
      'Versioned beads coverage history.',
      'Latest refined semantic blueprint.',
      'Expanded execution-ready beads data and associated artifacts (produced in Part 2).',
    ],
    transitions: [
      'After expansion, the workflow advances to Approving Blueprint.',
      'Coverage or expansion failures route the ticket to Blocked Error.',
    ],
    notes: [
      'This is the only planning phase that ends with an explicit semantic-to-execution expansion step.',
      'This phase has 2 internal parts with different context inputs: Part 1 receives PRD + Beads (semantic blueprint); Part 2 receives Relevant Files + Ticket Details + PRD + Semantic Blueprint (beads_draft).',
    ],
  },
  WAITING_BEADS_APPROVAL: {
    overview: 'The final expanded beads plan is ready for human review before any coding begins. This is the last user-input gate before execution starts.',
    steps: [
      'LoopTroop shows the execution-ready beads breakdown, including descriptions, dependencies, acceptance criteria, and test commands.',
      'You can review the plan in structured form or edit the raw representation before approving it.',
      'Coverage warnings remain visible if the latest implementation plan advanced after exhausting the fixed beads coverage loop.',
      'Approval confirms the execution plan that the coding loop will consume bead-by-bead.',
    ],
    outputs: [
      'Approved execution-ready beads plan or user-edited replacement.',
      'Saved approval editor state while reviewing.',
      'The authoritative bead set for pre-flight checks and coding.',
    ],
    transitions: [
      'Approve advances the workflow to Initializing Agent.',
      'Cancel moves the ticket to Canceled.',
    ],
    notes: [
      'This is the review artifact gate for the beads phase and the last approval step before execution.',
      'No context is passed to AI in this phase — it is entirely user-driven.',
    ],
  },
  PRE_FLIGHT_CHECK: {
    overview: 'LoopTroop validates that execution prerequisites are healthy before the first bead is allowed to run. This includes checking connectivity, workspace integrity, and the bead dependency graph.',
    steps: [
      'LoopTroop loads the approved beads and runs the pre-flight doctor against the current ticket workspace.',
      'The doctor checks OpenCode connectivity, ticket directory existence, relevant-files presence, bead availability, and dependency graph integrity.',
      'A structured pre-flight report is persisted regardless of pass or fail so the user can inspect what blocked execution.',
      'If everything passes, LoopTroop refreshes bead progress counters and marks the ticket ready for coding.',
    ],
    outputs: [
      'Pre-flight report artifact with pass, warning, and failure entries.',
      'Updated bead progress metadata when checks pass.',
      'Execution readiness decision.',
    ],
    transitions: [
      'Passing checks advance the workflow to Implementing.',
      'Any critical failure routes the ticket to Blocked Error.',
    ],
    notes: [
      'Context received: Relevant Files + Ticket Details.',
    ],
  },
  CODING: {
    overview: 'LoopTroop runs the approved beads one at a time, choosing the next runnable bead, executing it with the coding agent, and updating progress after each attempt. Only beads whose dependencies are satisfied can be picked. The status label shows current bead progress (e.g., "Implementing (Bead 3/7)").',
    steps: [
      'LoopTroop reads the authoritative bead tracker, finds the next runnable bead based on dependency state, and marks it `in_progress`.',
      'It assembles bead-specific context (bead description, acceptance criteria, iteration notes from prior attempts) and launches the locked main implementer with the configured retry and timeout settings.',
      'Execution events, prompts, session lifecycle, and bead results are streamed into the phase log while the agent works.',
      'On success, LoopTroop marks the bead done, records the execution artifact, updates ticket progress counters, and broadcasts bead completion.',
      'If more runnable beads remain, the state stays in Coding and the loop continues with the next bead. If a bead fails after retries, the bead is marked error and execution stops for manual intervention.',
    ],
    outputs: [
      'Updated bead statuses and ticket progress (visible in the UI progress ring).',
      'Per-bead execution artifacts and session logs.',
      'Incremental coding progress visible in the UI.',
    ],
    transitions: [
      'Successful bead completion keeps the workflow in Coding until all beads are done.',
      'When all beads are complete, the workflow advances to Self-Testing.',
      'A bead execution failure or an unrecoverable runtime issue routes the ticket to Blocked Error.',
    ],
    notes: [
      'Only runnable beads whose dependencies are satisfied can be picked.',
      'Context received: Current Bead Data + Bead Notes (iteration history from prior attempts).',
    ],
  },
  RUNNING_FINAL_TEST: {
    overview: 'After all beads finish, LoopTroop asks the main implementer to generate final ticket-level test commands and then executes them on the current ticket branch state. This is a verification gate before integration.',
    steps: [
      'LoopTroop loads ticket details plus the canonical interview, PRD, and beads artifacts to give the final test generator the full implementation context.',
      'The locked main implementer generates a structured final-test plan and command list.',
      'LoopTroop executes the generated commands in the ticket worktree under the configured timeout budget.',
      'A final test report artifact is written whether tests pass or fail, and the phase log records the command outcome for review.',
    ],
    outputs: [
      'Final test report with command plan, execution results, and errors.',
      'Phase logs showing whether commands passed or failed.',
      'A pass/fail gate before squash and manual review.',
    ],
    transitions: [
      'Passing final tests advances the workflow to Finalizing Code.',
      'Failed tests or final-test generation failures route the ticket to Blocked Error.',
    ],
    notes: [
      'Context received: Ticket Details + PRD + Beads Plan + Verification Tests.',
    ],
  },
  INTEGRATING_CHANGES: {
    overview: 'LoopTroop turns the unsquashed ticket branch state into a single reviewable candidate commit for human verification. This produces a clean squash commit on the ticket branch.',
    steps: [
      'LoopTroop resolves the ticket worktree and base branch, then calculates the merge base and current HEAD information.',
      'It performs a soft reset back to the merge base, stages the ticket changes, and creates a single candidate commit with LoopTroop commit metadata.',
      'The integration report captures the candidate commit SHA, merge base, pre-squash HEAD, and commit counts.',
      'If no staged changes exist or git operations fail, the phase records the failure and stops before manual verification.',
    ],
    outputs: [
      'Integration report artifact with commit details.',
      'Candidate squash commit ready for manual inspection.',
      'Recorded pre-squash metadata for audit and troubleshooting.',
    ],
    transitions: [
      'A successful candidate commit advances the workflow to Ready for Review.',
      'Integration failure routes the ticket to Blocked Error.',
    ],
    notes: [
      'Context received: Ticket Details + Interview Results + PRD + Beads Plan + Verification Tests.',
    ],
  },
  WAITING_MANUAL_VERIFICATION: {
    overview: 'LoopTroop stops automation and waits for a human to inspect the candidate branch state before final cleanup and closure. This is the last user-input gate — no AI work happens until you verify.',
    steps: [
      'The workspace shows the candidate branch or commit information generated during integration.',
      'No further AI execution happens automatically in this state; the system is waiting for an explicit human verification decision.',
      'You review the candidate output, logs, and artifacts, then confirm completion only when the result looks correct.',
      'Verification is the final manual gate before LoopTroop enters cleanup and terminal completion.',
    ],
    outputs: [
      'A stable candidate state for manual review.',
      'No new AI-owned artifacts unless you navigate and inspect existing ones.',
      'An explicit human approval checkpoint before closure.',
    ],
    transitions: [
      'Verify advances the workflow to Cleaning Up.',
      'Cancel moves the ticket to Canceled.',
      'If a new blocking system error is recorded here, the workflow can still route to Blocked Error.',
    ],
    notes: [
      'Context received: Ticket Details + Interview Results + PRD + Beads Plan + Verification Tests.',
    ],
  },
  CLEANING_ENV: {
    overview: 'LoopTroop removes temporary runtime resources created during the ticket run while preserving the artifacts needed for audit, review, and restart history.',
    steps: [
      'LoopTroop runs the cleanup routine against the ticket workspace and runtime directories.',
      'Transient runtime data such as lock files, session folders, stream buffers, temp files, and runtime state are removed when present.',
      'Planning artifacts (interview, PRD, beads), the execution log, and the beads data are intentionally preserved instead of being deleted.',
      'The cleanup report is persisted so the UI can show what was removed, preserved, or failed.',
    ],
    outputs: [
      'Cleanup report artifact detailing what was removed and preserved.',
      'Removed transient runtime paths.',
      'Preserved planning and audit artifacts.',
    ],
    transitions: [
      'Successful cleanup advances the workflow to Done.',
      'Cleanup failures route the ticket to Blocked Error.',
    ],
    notes: [
      'Context received: Ticket Details + Beads Plan.',
    ],
  },
  COMPLETED: {
    overview: 'The ticket has finished its full workflow and is now closed as a successful terminal state. All lifecycle artifacts remain accessible for review.',
    steps: [
      'LoopTroop marks the ticket status as completed after cleanup finishes.',
      'The workspace becomes read-only from a workflow perspective, with lifecycle artifacts available for review.',
      'Past planning, execution, testing, and cleanup evidence remains accessible through the navigator and artifact views.',
    ],
    outputs: [
      'Terminal completed status.',
      'Full lifecycle history for review (interview, PRD, beads, test reports, integration report).',
      'No further workflow actions except external inspection.',
    ],
    transitions: [
      'This is a terminal state with no forward workflow transitions.',
    ],
    notes: [
      'Context received: Ticket Details + Interview Results + PRD + Beads Plan + Verification Tests.',
    ],
  },
  CANCELED: {
    overview: 'The ticket was stopped by user action before normal completion and now sits in a terminal canceled state. History up to the cancellation point is preserved.',
    steps: [
      'LoopTroop records the cancellation and closes the active workflow run.',
      'The UI keeps the completed portion of the lifecycle reviewable up to the stored review cutoff status.',
      'No more planning or execution actions are allowed once cancellation is finalized.',
    ],
    outputs: [
      'Terminal canceled status.',
      'Preserved history up to the cancellation point.',
      'No additional workflow progress.',
    ],
    transitions: [
      'This is a terminal state with no forward workflow transitions.',
    ],
    notes: [
      'Context received: Ticket Details only.',
    ],
  },
  BLOCKED_ERROR: {
    overview: 'A blocking failure interrupted the workflow and LoopTroop is waiting for a human decision before it can continue. The error is tied to the phase where the failure happened, and the previous status is preserved so retry knows where to return.',
    steps: [
      'LoopTroop records the error message, error codes, occurrence timing, and the status where the failure happened.',
      'The blocked error becomes the active workflow state while preserving the previous status so retry knows where to return.',
      'The workspace surfaces the relevant failure details and the combined logs around the failing moment for diagnosis.',
      'You can choose Retry to send the machine back to the previous workflow status, or Cancel to terminate the ticket.',
    ],
    outputs: [
      'Error occurrence history with timestamps and resolution metadata.',
      'Blocked state tied to the phase that failed.',
      'Retry or cancel decision point for manual intervention.',
    ],
    transitions: [
      'Retry returns the workflow to the previously blocked status when supported by the state machine.',
      'Cancel moves the ticket to Canceled.',
    ],
    notes: [
      'Past error occurrences remain reviewable even after the ticket moves on or is canceled.',
      'Context received: Current Bead Data (if failed during coding) + Error Context.',
    ],
  },
} satisfies Record<string, WorkflowPhaseDetails>

export const WORKFLOW_GROUPS: WorkflowGroupMeta[] = [
  { id: 'todo', label: 'To Do' },
  { id: 'interview', label: 'Interview' },
  { id: 'prd', label: 'Specs (PRD)' },
  { id: 'beads', label: 'Blueprint (Beads)' },
  { id: 'execution', label: 'Execution' },
  { id: 'done', label: 'Done' },
]

const DRAFTING_PRD_CONTEXT_SECTIONS = [
  {
    label: 'Part 1',
    description: 'Answering Skipped Questions',
    keys: ['relevant_files', 'ticket_details', 'interview'],
  },
  {
    label: 'Part 2',
    description: 'Generating PRD Drafts',
    keys: ['relevant_files', 'ticket_details', 'full_answers'],
  },
] as const satisfies readonly WorkflowContextSection[]

const VERIFYING_BEADS_COVERAGE_CONTEXT_SECTIONS = [
  {
    label: 'Part 1',
    description: 'Coverage Review',
    keys: ['prd', 'beads'],
  },
  {
    label: 'Part 2',
    description: 'Final Expansion',
    keys: ['relevant_files', 'ticket_details', 'prd', 'beads_draft'],
  },
] as const satisfies readonly WorkflowContextSection[]

export const WORKFLOW_PHASES: WorkflowPhaseMeta[] = [
  {
    id: 'DRAFT',
    label: 'Backlog',
    description: 'Ticket created but inactive; backlog item waiting for Start.',
    details: WORKFLOW_PHASE_DETAILS.DRAFT,
    kanbanPhase: 'todo',
    groupId: 'todo',
    uiView: 'draft',
    editable: true,
    multiModelLogs: false,
    contextSummary: ['ticket_details'],
  },
  {
    id: 'SCANNING_RELEVANT_FILES',
    label: 'Scanning Relevant Files',
    description: 'AI reads and extracts relevant source file contents for context.',
    details: WORKFLOW_PHASE_DETAILS.SCANNING_RELEVANT_FILES,
    kanbanPhase: 'in_progress',
    groupId: 'interview',
    uiView: 'council',
    editable: true,
    multiModelLogs: false,
    contextSummary: ['ticket_details'],
  },
  {
    id: 'COUNCIL_DELIBERATING',
    label: 'AI Council Thinking',
    description: 'Models generate initial interview questions and debate approach.',
    details: WORKFLOW_PHASE_DETAILS.COUNCIL_DELIBERATING,
    kanbanPhase: 'in_progress',
    groupId: 'interview',
    uiView: 'council',
    editable: true,
    multiModelLogs: true,
    contextSummary: ['relevant_files', 'ticket_details'],
  },
  {
    id: 'COUNCIL_VOTING_INTERVIEW',
    label: 'Selecting Best Questions',
    description: 'Models vote on the strongest interview draft.',
    details: WORKFLOW_PHASE_DETAILS.COUNCIL_VOTING_INTERVIEW,
    kanbanPhase: 'in_progress',
    groupId: 'interview',
    uiView: 'council',
    editable: true,
    multiModelLogs: true,
    contextSummary: ['relevant_files', 'ticket_details', 'drafts'],
  },
  {
    id: 'COMPILING_INTERVIEW',
    label: 'Preparing Interview',
    description: 'Winning interview draft is consolidated.',
    details: WORKFLOW_PHASE_DETAILS.COMPILING_INTERVIEW,
    kanbanPhase: 'in_progress',
    groupId: 'interview',
    uiView: 'council',
    editable: true,
    multiModelLogs: false,
    contextSummary: ['relevant_files', 'ticket_details', 'drafts'],
  },
  {
    id: 'WAITING_INTERVIEW_ANSWERS',
    label: 'Interviewing',
    description: 'Waiting for your interview answers.',
    details: WORKFLOW_PHASE_DETAILS.WAITING_INTERVIEW_ANSWERS,
    kanbanPhase: 'needs_input',
    groupId: 'interview',
    uiView: 'interview_qa',
    editable: true,
    multiModelLogs: false,
    progressKind: 'questions',
    contextSummary: ['relevant_files', 'ticket_details', 'interview', 'user_answers'],
  },
  {
    id: 'VERIFYING_INTERVIEW_COVERAGE',
    label: 'Coverage Check (Interview)',
    description: 'Coverage check for interview completeness; may add targeted follow-up questions before approval.',
    details: WORKFLOW_PHASE_DETAILS.VERIFYING_INTERVIEW_COVERAGE,
    kanbanPhase: 'in_progress',
    groupId: 'interview',
    uiView: 'council',
    editable: true,
    multiModelLogs: false,
    contextSummary: ['ticket_details', 'user_answers', 'interview'],
  },
  {
    id: 'WAITING_INTERVIEW_APPROVAL',
    label: 'Approving Interview',
    description: 'Waiting for your approval of interview results before PRD drafting.',
    details: WORKFLOW_PHASE_DETAILS.WAITING_INTERVIEW_APPROVAL,
    kanbanPhase: 'needs_input',
    groupId: 'interview',
    uiView: 'approval',
    editable: true,
    multiModelLogs: false,
    reviewArtifactType: 'interview',
    contextSummary: [],
  },
  {
    id: 'DRAFTING_PRD',
    label: 'Drafting Specs',
    description: 'Models produce competing PRD drafts.',
    details: WORKFLOW_PHASE_DETAILS.DRAFTING_PRD,
    kanbanPhase: 'in_progress',
    groupId: 'prd',
    uiView: 'council',
    editable: true,
    multiModelLogs: true,
    contextSummary: mergeContextSections(DRAFTING_PRD_CONTEXT_SECTIONS),
    contextSections: DRAFTING_PRD_CONTEXT_SECTIONS,
  },
  {
    id: 'COUNCIL_VOTING_PRD',
    label: 'Voting on Specs',
    description: 'Models vote on the best PRD draft.',
    details: WORKFLOW_PHASE_DETAILS.COUNCIL_VOTING_PRD,
    kanbanPhase: 'in_progress',
    groupId: 'prd',
    uiView: 'council',
    editable: true,
    multiModelLogs: true,
    contextSummary: ['relevant_files', 'ticket_details', 'interview', 'drafts'],
  },
  {
    id: 'REFINING_PRD',
    label: 'Refining Specs',
    description: 'Winning draft is consolidated into PRD Candidate v1 using useful ideas from the losing drafts.',
    details: WORKFLOW_PHASE_DETAILS.REFINING_PRD,
    kanbanPhase: 'in_progress',
    groupId: 'prd',
    uiView: 'council',
    editable: true,
    multiModelLogs: false,
    contextSummary: ['relevant_files', 'ticket_details', 'full_answers', 'drafts'],
  },
  {
    id: 'VERIFYING_PRD_COVERAGE',
    label: 'Coverage Check (PRD)',
    description: 'LoopTroop checks the current PRD against the approved interview. If something is missing, it updates the PRD and checks again.',
    details: WORKFLOW_PHASE_DETAILS.VERIFYING_PRD_COVERAGE,
    kanbanPhase: 'in_progress',
    groupId: 'prd',
    uiView: 'council',
    editable: true,
    multiModelLogs: false,
    contextSummary: ['interview', 'full_answers', 'prd'],
  },
  {
    id: 'WAITING_PRD_APPROVAL',
    label: 'Approving Specs',
    description: 'Waiting for your approval of the latest PRD candidate.',
    details: WORKFLOW_PHASE_DETAILS.WAITING_PRD_APPROVAL,
    kanbanPhase: 'needs_input',
    groupId: 'prd',
    uiView: 'approval',
    editable: true,
    multiModelLogs: false,
    reviewArtifactType: 'prd',
    contextSummary: [],
  },
  {
    id: 'DRAFTING_BEADS',
    label: 'Architecting Beads',
    description: 'Models split PRD into implementable beads.',
    details: WORKFLOW_PHASE_DETAILS.DRAFTING_BEADS,
    kanbanPhase: 'in_progress',
    groupId: 'beads',
    uiView: 'council',
    editable: true,
    multiModelLogs: true,
    contextSummary: ['relevant_files', 'ticket_details', 'prd'],
  },
  {
    id: 'COUNCIL_VOTING_BEADS',
    label: 'Voting on Architecture',
    description: 'Models vote on the architecture/beads breakdown.',
    details: WORKFLOW_PHASE_DETAILS.COUNCIL_VOTING_BEADS,
    kanbanPhase: 'in_progress',
    groupId: 'beads',
    uiView: 'council',
    editable: true,
    multiModelLogs: true,
    contextSummary: ['relevant_files', 'ticket_details', 'prd', 'drafts'],
  },
  {
    id: 'REFINING_BEADS',
    label: 'Finalizing Plan',
    description: 'Winning draft is consolidated into the final semantic beads blueprint using the strongest ideas from the losing drafts.',
    details: WORKFLOW_PHASE_DETAILS.REFINING_BEADS,
    kanbanPhase: 'in_progress',
    groupId: 'beads',
    uiView: 'council',
    editable: true,
    multiModelLogs: false,
    contextSummary: ['relevant_files', 'ticket_details', 'prd', 'drafts'],
  },
  {
    id: 'VERIFYING_BEADS_COVERAGE',
    label: 'Coverage Check (Beads)',
    description: 'LoopTroop checks the current semantic beads blueprint against the approved PRD. If something is missing, it updates the blueprint, checks again, then expands the final version into execution-ready beads before approval.',
    details: WORKFLOW_PHASE_DETAILS.VERIFYING_BEADS_COVERAGE,
    kanbanPhase: 'in_progress',
    groupId: 'beads',
    uiView: 'council',
    editable: true,
    multiModelLogs: false,
    contextSummary: mergeContextSections(VERIFYING_BEADS_COVERAGE_CONTEXT_SECTIONS),
    contextSections: VERIFYING_BEADS_COVERAGE_CONTEXT_SECTIONS,
  },
  {
    id: 'WAITING_BEADS_APPROVAL',
    label: 'Approving Blueprint',
    description: 'Waiting for your approval of the beads blueprint.',
    details: WORKFLOW_PHASE_DETAILS.WAITING_BEADS_APPROVAL,
    kanbanPhase: 'needs_input',
    groupId: 'beads',
    uiView: 'approval',
    editable: true,
    multiModelLogs: false,
    reviewArtifactType: 'beads',
    contextSummary: [],
  },
  {
    id: 'PRE_FLIGHT_CHECK',
    label: 'Initializing Agent',
    description: 'Running checks before coding starts.',
    details: WORKFLOW_PHASE_DETAILS.PRE_FLIGHT_CHECK,
    kanbanPhase: 'in_progress',
    groupId: 'execution',
    uiView: 'coding',
    editable: true,
    multiModelLogs: false,
    contextSummary: ['relevant_files', 'ticket_details'],
  },
  {
    id: 'CODING',
    label: 'Implementing (Bead ?/?)',
    description: 'AI coding agent executes beads with retry loop.',
    details: WORKFLOW_PHASE_DETAILS.CODING,
    kanbanPhase: 'in_progress',
    groupId: 'execution',
    uiView: 'coding',
    editable: false,
    multiModelLogs: false,
    progressKind: 'beads',
    contextSummary: ['bead_data', 'bead_notes'],
  },
  {
    id: 'RUNNING_FINAL_TEST',
    label: 'Self-Testing',
    description: 'Running ticket-level final tests.',
    details: WORKFLOW_PHASE_DETAILS.RUNNING_FINAL_TEST,
    kanbanPhase: 'in_progress',
    groupId: 'execution',
    uiView: 'coding',
    editable: false,
    multiModelLogs: false,
    contextSummary: ['ticket_details', 'interview', 'prd', 'beads'],
  },
  {
    id: 'INTEGRATING_CHANGES',
    label: 'Finalizing Code',
    description: 'Preparing final candidate branch state.',
    details: WORKFLOW_PHASE_DETAILS.INTEGRATING_CHANGES,
    kanbanPhase: 'in_progress',
    groupId: 'execution',
    uiView: 'coding',
    editable: false,
    multiModelLogs: false,
    contextSummary: ['ticket_details', 'prd', 'beads', 'tests'],
  },
  {
    id: 'WAITING_MANUAL_VERIFICATION',
    label: 'Ready for Review',
    description: 'Waiting for your manual verification before completion.',
    details: WORKFLOW_PHASE_DETAILS.WAITING_MANUAL_VERIFICATION,
    kanbanPhase: 'needs_input',
    groupId: 'execution',
    uiView: 'coding',
    editable: false,
    multiModelLogs: false,
    contextSummary: ['ticket_details', 'interview', 'prd', 'beads', 'tests'],
  },
  {
    id: 'CLEANING_ENV',
    label: 'Cleaning Up',
    description: 'Cleaning temporary resources/worktree data.',
    details: WORKFLOW_PHASE_DETAILS.CLEANING_ENV,
    kanbanPhase: 'in_progress',
    groupId: 'execution',
    uiView: 'coding',
    editable: false,
    multiModelLogs: false,
    contextSummary: ['ticket_details', 'beads'],
  },
  {
    id: 'COMPLETED',
    label: 'Done',
    description: 'Ticket closed successfully.',
    details: WORKFLOW_PHASE_DETAILS.COMPLETED,
    kanbanPhase: 'done',
    groupId: 'done',
    uiView: 'done',
    editable: false,
    multiModelLogs: false,
    contextSummary: ['ticket_details', 'interview', 'prd', 'beads', 'tests'],
  },
  {
    id: 'CANCELED',
    label: 'Canceled',
    description: 'Ticket canceled by user action.',
    details: WORKFLOW_PHASE_DETAILS.CANCELED,
    kanbanPhase: 'done',
    groupId: 'done',
    uiView: 'canceled',
    editable: false,
    multiModelLogs: false,
    contextSummary: ['ticket_details'],
  },
  {
    id: 'BLOCKED_ERROR',
    label: 'Error (reason)',
    description: 'A blocking error requires retry or cancel.',
    details: WORKFLOW_PHASE_DETAILS.BLOCKED_ERROR,
    kanbanPhase: 'needs_input',
    groupId: 'execution',
    uiView: 'error',
    editable: false,
    multiModelLogs: false,
    contextSummary: ['bead_data', 'error_context'],
  },
]

export const WORKFLOW_PHASE_IDS = WORKFLOW_PHASES.map((phase) => phase.id)

export const WORKFLOW_PHASE_MAP = Object.fromEntries(
  WORKFLOW_PHASES.map((phase) => [phase.id, phase]),
) as Record<string, WorkflowPhaseMeta>

export function getWorkflowPhaseMeta(status: string): WorkflowPhaseMeta | undefined {
  return WORKFLOW_PHASE_MAP[status]
}

export type WorkflowAction = 'start' | 'approve' | 'cancel' | 'retry' | 'verify'

export const APPROVAL_PHASE_IDS = new Set(
  WORKFLOW_PHASES.filter((phase) => phase.uiView === 'approval' && phase.reviewArtifactType).map((phase) => phase.id),
)

export function isBeforeExecution(status: string): boolean {
  const index = WORKFLOW_PHASE_IDS.indexOf(status)
  const executionIndex = WORKFLOW_PHASE_IDS.indexOf('PRE_FLIGHT_CHECK')
  return index >= 0 && executionIndex >= 0 && index < executionIndex
}

export function isStatusAtOrPast(currentStatus: string, targetStatus: string): boolean {
  const currentIndex = WORKFLOW_PHASE_IDS.indexOf(currentStatus)
  const targetIndex = WORKFLOW_PHASE_IDS.indexOf(targetStatus)
  return currentIndex >= 0 && targetIndex >= 0 && currentIndex >= targetIndex
}

export function getAvailableWorkflowActions(status: string): WorkflowAction[] {
  switch (status) {
    case 'DRAFT':
      return ['start', 'cancel']
    case 'WAITING_INTERVIEW_APPROVAL':
    case 'WAITING_PRD_APPROVAL':
    case 'WAITING_BEADS_APPROVAL':
      return ['approve', 'cancel']
    case 'WAITING_MANUAL_VERIFICATION':
      return ['verify', 'cancel']
    case 'BLOCKED_ERROR':
      return ['retry', 'cancel']
    case 'COMPLETED':
    case 'CANCELED':
      return []
    default:
      return ['cancel']
  }
}
