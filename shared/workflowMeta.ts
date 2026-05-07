export type KanbanPhase = 'todo' | 'in_progress' | 'needs_input' | 'done'
type WorkflowGroupId =
  | 'todo'
  | 'discovery'
  | 'interview'
  | 'prd'
  | 'beads'
  | 'pre_implementation'
  | 'implementation'
  | 'post_implementation'
  | 'done'
  | 'errors'
type WorkflowUIView = 'draft' | 'council' | 'interview_qa' | 'approval' | 'coding' | 'error' | 'done' | 'canceled'
export type EditableArtifactType = 'interview' | 'prd' | 'beads' | 'execution_setup_plan'
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
  | 'execution_setup_plan'
  | 'execution_setup_plan_notes'
  | 'execution_setup_profile'
  | 'execution_setup_notes'
  | 'final_test_notes'
  | 'error_context'

export interface WorkflowPhaseDetails {
  overview: string
  steps: readonly string[]
  outputs: readonly string[]
  transitions: readonly string[]
  notes?: readonly string[]
  equivalents?: readonly string[]
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
    overview: 'The ticket exists as a backlog item only — no AI work, planning run, or execution state has started yet. Think of this as the "idea stage": the ticket is fully user-controlled and editable, giving you time to refine the title, description, priority, and project assignment before launching the automated workflow pipeline.',
    steps: [
      'Ticket Creation: When you create a ticket, LoopTroop stores the title, description, priority, project association, and any implementation notes you provide. This metadata becomes the seed context that every downstream AI phase will reference.',
      'Council Configuration Lock: Behind the scenes, LoopTroop has already assigned a main implementer model and a set of council member models based on your project configuration. These assignments are locked at start time, not at creation — so changing project settings before starting will affect which models participate.',
      'Editable Window: While in Draft, you can freely change any ticket field. Once you press Start, the title and description become the authoritative "Ticket Details" context artifact that the scanning phase reads. Edits after Start require navigating back and may trigger cascade warnings.',
      'No AI Activity: No relevant-files scan, interview artifact, PRD, beads plan, or runtime worktree activity is performed in this state. The ticket directory in the workspace may not even exist yet until Start is triggered.',
      'Start Trigger: When Start is triggered, LoopTroop locks the council configuration (main implementer and council members), initializes the ticket workspace directory on disk, creates the initial runtime state, and begins the planning pipeline from the first active AI phase (Scanning Relevant Files).',
    ],
    outputs: [
      'Ticket metadata record (title, description, priority, project association, implementation notes).',
      'No planning or execution artifacts exist yet — only the ticket record itself.',
      'The ticket status is fully user-controlled through Start or Cancel actions at this point.',
    ],
    transitions: [
      'Start → Scanning Relevant Files: Locks the council configuration, initializes the ticket workspace directory, and begins the automated planning pipeline.',
      'Cancel → Canceled: Moves the ticket directly to the terminal Canceled state without producing any artifacts.',
    ],
    notes: [
      'This is the only phase where the ticket is intentionally inactive — no background processing occurs.',
      'No AI-owned files or workspace directories are expected to exist yet.',
      'Context available: Ticket Details only (title, description, priority, project, implementation notes).',
      'Tip: Take your time here to write a clear, detailed description. The quality of your ticket description directly impacts how well the AI understands your intent throughout all subsequent phases.',
    ],
  },
  SCANNING_RELEVANT_FILES: {
    overview: 'LoopTroop performs a focused codebase scan before any council work starts, so later phases can reference the actual source files instead of guessing about your codebase structure. This is a single-model phase using the locked main implementer — not a multi-council step. The scan output becomes a reusable context artifact that every subsequent phase (interview, PRD, beads) can draw from.',
    steps: [
      'Prompt Assembly: LoopTroop builds a minimal prompt from the ticket title and description (the Ticket Details context). The prompt instructs the model to identify source files that are likely relevant to implementing this ticket — including files that would need modification, files that provide important interfaces or types, and files that contain related logic.',
      'Model Execution: The locked main implementer model processes the prompt and returns a structured response listing relevant files with their paths, content excerpts, relevance ratings (e.g., high/medium/low), and natural-language rationales explaining why each file matters to this ticket.',
      'Output Validation: LoopTroop validates the structured output against the expected schema (correct field types, non-empty file paths, valid relevance levels). If validation fails — for example, if the model returns malformed JSON or missing required fields — it automatically retries once, either within the same session or by starting a fresh session.',
      'Artifact Persistence: On success, LoopTroop writes the canonical `relevant-files.yaml` artifact into the ticket workspace directory. This YAML file becomes the reusable file-context artifact that all downstream phases can reference without needing to re-scan the codebase.',
      'Summarized Scan Artifact: A companion summarized scan artifact is also stored for UI review, giving you a quick overview of what files were identified and why.',
      'Logging: The normal phase log captures key session lifecycle milestones — prompt dispatch timing, summarized model output, retry attempts, validation results, and the final extracted file count.',
    ],
    outputs: [
      'Canonical `relevant-files.yaml` inside the ticket workspace — this becomes a shared context artifact that interview, PRD, and beads phases all receive as part of their input context.',
      'Structured scan artifact containing file paths, content previews, relevance levels (high/medium/low), and natural-language rationales for each identified file.',
      'Normal phase logs with session lifecycle, prompt dispatch, retry history, and diagnostics.',
    ],
    transitions: [
      'Success → Council Drafting Questions: A valid scan artifact advances the ticket to the council deliberation phase where multiple models begin drafting interview questions.',
      'Failure → Blocked Error: Validation failure after retry, model timeout, missing implementer configuration, or unexpected runtime errors route the ticket to the Blocked Error state for manual intervention.',
    ],
    notes: [
      'This phase is single-model (main implementer only), not multi-council — it is a preparatory step before the council engages.',
      'The scan is purely context-building: it reads and identifies files but does not modify any source files in your repository.',
      'Context available: Ticket Details only (the model does not yet have interview results, PRD, or beads — those are created in later phases).',
      'Why this matters: Without relevant file context, later phases would have to reason about your codebase from the ticket description alone. The scan gives the council concrete file references to ground their interview questions and specifications in your actual code.',
    ],
  },
  COUNCIL_DELIBERATING: {
    overview: 'The interview council creates competing interview/question drafts so the system can compare multiple approaches before asking you anything. This is the first multi-model phase in the workflow — each configured council member works independently and in parallel, producing their own interview strategy without seeing what the others are doing. The diversity of approaches is intentional: it ensures the final interview covers angles that any single model might miss.',
    steps: [
      'Context Loading: LoopTroop loads the ticket details (title, description, priority, implementation notes) and the relevant-files artifact (file paths, excerpts, rationales) as the shared prompt context that every council member receives identically.',
      'Parallel Draft Generation: Each configured council model receives the same context but drafts its own interview approach independently. Models are not allowed to see or influence each other\'s outputs — this independence is key to producing genuinely diverse interview strategies.',
      'Draft Content: Each draft typically includes a set of interview questions, their types (free-text, choice-based), ordering rationale, and a strategy explanation for why these particular questions would best clarify the implementation intent.',
      'Progress Tracking: LoopTroop tracks per-model progress in real time, streaming model logs to the UI so you can see how each council member is progressing. It also monitors quorum — the minimum number of successful drafts needed to proceed.',
      'Quorum Check: If too many models fail (insufficient successful drafts to meet quorum), the phase fails fast rather than waiting for all models to finish. This prevents wasted time when the council cannot produce enough valid drafts to vote on.',
      'Artifact Persistence: Each completed draft is persisted as a council artifact, stored alongside the model identity and draft metadata. These artifacts are used in the next voting phase for side-by-side comparison.',
    ],
    outputs: [
      'A set of competing interview drafts — one from each council member — each with its own question set, ordering, and strategic rationale.',
      'Per-model draft progress and selected session milestones viewable in the phase log panel; completed drafts are preserved as artifacts for exact review.',
      'Persisted council draft artifacts that will be anonymized and presented to voters in the next phase.',
    ],
    transitions: [
      'Quorum Met → Voting on Questions: When enough valid drafts are complete (meeting the configured quorum threshold), the workflow advances to the voting phase where the council scores each draft.',
      'Quorum Failure → Blocked Error: If too many models fail, produce invalid output, or time out — leaving fewer valid drafts than the quorum requires — the ticket routes to Blocked Error for manual retry.',
      'Cancel → Canceled: User cancellation during this phase stops all active model sessions and moves the ticket to Canceled.',
    ],
    notes: [
      'This is the first multi-model phase in the workflow — all phases before this used only the single main implementer.',
      'Council member independence is enforced: no model can see another\'s draft during this phase.',
      'Context available: Relevant Files + Ticket Details. The council does not yet have interview answers, PRD, or beads — it is creating the interview that will gather those answers.',
      'Why multiple drafts? A single model might focus narrowly on one aspect of the ticket. By having multiple models independently draft interview approaches, the system captures a wider range of relevant questions and perspectives.',
    ],
    equivalents: [
      'This is the "multi-model drafting" step of the Interview phase. The same pattern repeats in the Specs (PRD) phase as "Council Drafting Specs" (where council members independently write competing PRD documents from the approved interview) and in the Blueprint (Beads) phase as "Council Drafting Blueprint" (where council members independently propose competing task decompositions from the approved PRD).',
      'All three drafting phases share the same mechanics: parallel independent generation → quorum check → advance to voting. The difference is what is being drafted (interview questions vs. specification document vs. implementation plan) and what context each council member receives.',
    ],
  },
  COUNCIL_VOTING_INTERVIEW: {
    overview: 'The council scores the interview drafts against a structured voting rubric and selects the strongest candidate to become the canonical interview basis. Each member scores all drafts — not just their own — and the drafts are anonymized so models cannot identify or favor their own output. This ensures the selection is based purely on quality, not authorship bias.',
    steps: [
      'Draft Anonymization: LoopTroop strips authorship information from the available interview drafts and assigns neutral identifiers (e.g., Draft A, Draft B, Draft C). This prevents models from recognizing and self-voting for their own output.',
      'Randomized Presentation Order: The order in which drafts are presented to each voter is randomized to control for position bias — the tendency to favor drafts that appear first or last in a list.',
      'Independent Scoring: Each council member receives all anonymized drafts plus the scoring rubric and evaluates every draft independently. Scores are submitted as structured vote payloads with rubric scores, rankings, and written justifications.',
      'Rubric Categories: The voting rubric typically evaluates drafts on question relevance (do the questions target the right implementation concerns?), coverage breadth (are all important areas addressed?), question clarity (are questions unambiguous?), and actionability (will the answers actually help write better specs?).',
      'Vote Resolution: The vote resolver totals the rubric scores across all members, handles ties according to the configured tie-breaking rules, and identifies the single winning draft that will be refined into the canonical interview.',
      'Audit Trail: LoopTroop records presentation order, individual vote payloads, per-model scoring breakdowns, quorum state, and final outcome metadata. This full audit trail is preserved so you can later inspect exactly how and why a particular draft was selected.',
    ],
    outputs: [
      'Voting artifacts with per-model rubric scores, rankings, and written justifications for each draft.',
      'A resolved winning interview draft reference — the draft that scored highest overall.',
      'Complete audit data showing how the council arrived at the selection, including score spread, presentation order, and tie-breaking decisions (if any).',
    ],
    transitions: [
      'Winner Selected → Refining Interview: A successful winner selection advances the workflow to the refinement phase where the winning draft is normalized into the interactive interview format.',
      'Voting Failure → Blocked Error: Invalid vote structure, malformed model responses, quorum collapse (not enough valid votes), or unresolvable ties route the ticket to Blocked Error.',
    ],
    notes: [
      'Anonymization and randomized ordering are both designed to reduce bias — models cannot identify their own draft and cannot benefit from a favorable presentation position.',
      'Context available: Relevant Files + Ticket Details + Competing Drafts (all anonymized).',
      'The voting rubric is consistent across all council members to ensure scores are comparable.',
      'Why vote instead of just picking one? Voting aggregates multiple perspectives on quality. A draft that impresses all council members is more likely to be genuinely strong than one that a single model happened to prefer.',
    ],
    equivalents: [
      'This is the "council voting" step of the Interview phase. The same pattern repeats in the Specs (PRD) phase as "Voting on Specs" (where the council scores competing PRD drafts using a PRD-specific rubric) and in the Blueprint (Beads) phase as "Voting on Blueprint" (where the council scores competing beads blueprints using an architecture rubric).',
      'All three voting phases share the same mechanics: anonymization → randomized presentation → independent scoring → vote resolution → winner selection. The difference is the scoring rubric used: interview voting evaluates question relevance and coverage; PRD voting evaluates requirement completeness and acceptance criteria quality; beads voting evaluates decomposition quality and dependency correctness.',
    ],
  },
  COMPILING_INTERVIEW: {
    overview: 'LoopTroop turns the winning interview draft into the normalized, interactive interview session that you will actually answer. This is a single-model phase using the winning model from the vote. The refinement step standardizes question formats, sets up batch state tracking, and produces the UI-ready interview artifact that the interview screen renders.',
    steps: [
      'Winning Draft Ingestion: The winning interview draft (selected by council vote) is loaded along with its question set, ordering rationale, and any strategic notes the winning model included.',
      'Question Normalization: LoopTroop normalizes all questions into a standardized format — each question gets a unique identifier, a question type (free-text, single-choice, multi-choice), display text, optional context/hints, and ordering metadata. This ensures the interview UI can render any question regardless of how the original model formatted it.',
      'Session Snapshot Creation: LoopTroop builds the interview session snapshot, which tracks batch state (which questions are in the current batch vs. future batches), completion bookkeeping (answered, skipped, pending), question ordering, and overall session progress.',
      'Artifact Writing: The canonical interview YAML is written into the ticket workspace. This becomes the authoritative interview artifact that downstream phases (coverage check, approval, PRD drafting) reference.',
      'UI Companion Artifacts: Additional UI-friendly companion artifacts are generated so the interview screen can render structured questions with proper input controls — text areas for free-text questions, radio buttons or checkboxes for choice-based questions, and skip/unskip toggles for each item.',
    ],
    outputs: [
      'Canonical interview artifact (YAML) in the ticket workspace — the authoritative record of all interview questions.',
      'Interview session snapshot with batch state, question ordering, and completion tracking.',
      'Normalized question set with proper types, identifiers, and display metadata ready for the interview UI.',
      'UI companion artifacts enabling structured question rendering with appropriate input controls.',
    ],
    transitions: [
      'Success → Interviewing: Once the interview session is fully built and persisted, the workflow moves to the Interviewing phase where you can start answering questions.',
      'Failure → Blocked Error: Normalization errors, YAML writing failures, or session snapshot creation problems route the ticket to Blocked Error.',
    ],
    notes: [
      'This phase produces the first user-facing interactive artifact in the planning flow — everything before this was AI-only work.',
      'The refinement is done by the winning model (from the vote), not the main implementer or all council members.',
      'Context available: Relevant Files + Ticket Details + Competing Drafts (used for reference during normalization).',
      'The session snapshot is designed to support multiple interview rounds — if coverage later adds follow-up questions, the same snapshot structure accommodates them.',
    ],
    equivalents: [
      'This is the "refinement" step of the Interview phase. The same pattern repeats in the Specs (PRD) phase as "Refining Specs" (where the winning PRD draft is enhanced with ideas from losing drafts) and in the Blueprint (Beads) phase as "Refining Blueprint" (where the winning blueprint is enhanced with ideas from losing blueprints).',
      'All three use the winning model to consolidate the best output. The interview phase calls it "compiling" because it normalizes the draft into an interactive format; the PRD and beads phases call it "refining" because they merge improvements from losing drafts into the winner. The underlying principle is the same: take the best candidate and make it stronger.',
    ],
  },
  WAITING_INTERVIEW_ANSWERS: {
    overview: 'LoopTroop pauses all automated work and presents an interactive interview for you to answer. This is a user-input phase — no AI processing happens until you submit or skip the current question batch. Your answers (and skip decisions) directly shape the PRD that will be generated later, so this is your primary opportunity to guide the implementation direction. You may see this phase more than once if coverage finds gaps and generates follow-up questions.',
    steps: [
      'Question Presentation: The workspace presents the current interview batch with all pending questions. Each question shows its type (free-text or choice-based), any context/hints provided by the AI, and whether it has been previously answered or skipped.',
      'Answering Questions: You can answer questions in any order. Free-text questions accept open-ended responses; choice-based questions present the available options. Your answers are stored in a local draft state as you type, so you won\'t lose work if you switch between questions.',
      'Skipping Questions: If a question is not relevant or you don\'t have the information, you can skip it. Skipped questions are tracked separately — during PRD drafting, the AI will attempt to fill in reasonable answers for skipped questions based on the ticket context. You can also unskip a previously skipped question to answer it after all.',
      'Batch Submission: When you submit the current batch, LoopTroop normalizes your answers and skip decisions into the canonical interview state. This persists your responses into the interview session snapshot and updates the interview YAML artifact.',
      'Follow-Up Rounds: If the coverage check (which runs after submission) determines that more information is needed, the workflow returns here with a new targeted batch of follow-up questions. These follow-ups are generated based on gaps in your previous answers, not by repeating the same questions.',
      'Skip All: You can skip all remaining unanswered questions at once. This finalizes the current answers, marks all remaining questions as skipped, and advances the workflow directly to interview approval — bypassing the real coverage evaluation. A synthetic clean coverage record is written under the VERIFYING_INTERVIEW_COVERAGE phase label so audit history remains complete.',
    ],
    outputs: [
      'Recorded user answers and skip decisions persisted into the interview session snapshot.',
      'Updated canonical interview YAML artifact reflecting the current state of all questions.',
      'Question history grouped across initial and follow-up rounds, preserving the full interaction timeline.',
    ],
    transitions: [
      'Submit/Skip → Coverage Check (Interview): Submitting or skipping the active batch moves the workflow to the interview coverage check, which evaluates whether enough information has been gathered.',
      'Coverage Follow-Up → Back Here: If coverage identifies gaps, the workflow returns to this phase with additional targeted follow-up questions for you to answer.',
      'Skip All → Approving Interview (Direct): Finalizes all remaining unanswered questions as skipped, then advances directly to interview approval — bypassing the real coverage evaluation. A synthetic clean coverage artifact is written for audit continuity.',
    ],
    notes: [
      'This is a user-input phase — the workflow is intentionally paused. No AI models are running while you answer questions.',
      'This phase may appear multiple times in the lifecycle if coverage generates follow-up rounds — each round is a new batch of targeted questions.',
      'AI context available: Ticket Details only. The compiled question set, answered/skipped/pending state, and configured question limits are appended explicitly by the interview session logic when needed.',
      'Tip: Detailed, specific answers lead to better PRDs. If you\'re unsure about a question, it\'s better to answer with your best understanding and note any uncertainty than to skip it entirely.',
      'Tip: Skipping is fine for truly irrelevant questions — the AI will fill in reasonable defaults during PRD drafting. But skipping core architecture or business logic questions may result in a PRD that needs more manual editing later.',
    ],
  },
  VERIFYING_INTERVIEW_COVERAGE: {
    overview: 'The interview winner re-checks the ticket description and all recorded answers against the current interview results to decide whether enough information has been gathered, or if follow-up questions are still needed. This is a budgeted loop — LoopTroop tracks how many follow-up rounds have been used and will not exceed the configured maximum, ensuring the interview process eventually converges rather than looping indefinitely.',
    steps: [
      'Context Assembly: LoopTroop loads the canonical interview artifact, the ticket description, and a normalized answer summary. This gives the coverage model the full picture: what was asked, what was answered, what was skipped, and what the ticket is trying to accomplish.',
      'Coverage Evaluation: The winning interview model analyzes the collected answers against the ticket requirements and returns a structured coverage result. The result is either "clean" (all needed information has been collected) or "gaps found" (specific areas need more clarification).',
      'Gap Analysis (if gaps found): When gaps are identified, the model specifies exactly what information is missing and why it matters for downstream PRD generation. Each gap includes a description, the reason it is important, and a suggested follow-up question.',
      'Follow-Up Generation (if budget allows): If gaps remain and the follow-up budget has not been exhausted, LoopTroop generates targeted follow-up questions based on the identified gaps. These questions are added to the session snapshot as a new interview batch and the workflow returns to the Interviewing phase.',
      'Budget Enforcement: The follow-up budget tracks how many rounds of follow-up questions have been generated. Once the budget is exhausted, coverage will finalize the interview regardless of remaining gaps — the PRD phase will work with whatever information is available.',
      'Clean Finalization: If the interview is clean (no gaps or all gaps are minor), LoopTroop refreshes the canonical interview artifact with the finalized clean status and stores the coverage result for audit and UI review.',
      'Coverage History: Every coverage attempt (whether clean or gap-found) is persisted as a coverage history artifact, capturing the response, parsed result, follow-up budget usage, any artifact processing notices such as parser repairs or structured retries, and timestamps.',
    ],
    outputs: [
      'Interview coverage artifact describing whether the interview is clean or has remaining gaps, with detailed gap descriptions if applicable.',
      'Potentially new targeted follow-up questions added to the interview session (if gaps found and budget allows).',
      'Refreshed canonical interview artifact when the interview is finalized as clean.',
      'Coverage history with per-attempt details, follow-up budget tracking, and structural diagnostics.',
    ],
    transitions: [
      'Gaps + Budget Available → Interviewing: If follow-up questions are needed and the budget allows, the workflow returns to the Interviewing phase (WAITING_INTERVIEW_ANSWERS) with a new batch of targeted questions.',
      'Clean → Approving Interview: If the interview is clean (no gaps or all gaps resolved), the workflow advances to the interview approval gate.',
      'Budget Exhausted → Approving Interview: If the follow-up budget is used up, the interview advances to approval regardless of remaining gaps — the PRD phase will compensate where possible.',
      'Failure → Blocked Error: Coverage execution failures, model errors, or structural repair failures route the ticket to Blocked Error.',
    ],
    notes: [
      'The coverage loop is budgeted — it cannot run indefinitely. The maximum number of follow-up rounds is configured per project.',
      'Coverage is performed by the winning interview model (from the vote), ensuring consistency with the original interview strategy.',
      'Context available: Ticket Details + User Answers + Interview Results.',
      'Why budget the loop? Without a budget, a model could theoretically keep finding minor gaps and generating follow-up questions forever. The budget ensures the interview converges to a usable state within a reasonable number of rounds.',
    ],
    equivalents: [
      'This is the "coverage check" step of the Interview phase. The same pattern repeats in the Specs (PRD) phase as "Coverage Check (PRD)" (where the PRD is checked against the winning model\'s Full Answers artifact) and in the Blueprint (Beads) phase as "Coverage Check (Beads)" (where the beads blueprint is checked against the approved PRD).',
      'All three coverage checks share the goal of verifying completeness, but they differ in how gaps are resolved: Interview coverage sends you back to answer follow-up questions (user-facing loop). PRD coverage revises the document automatically within the same phase (AI-internal loop, up to the configured pass cap). Beads coverage also revises automatically within the Coverage Check (Beads) phase, and is then followed by a separate Expanding Blueprint phase that transforms the validated semantic blueprint into execution-ready bead records.',
      'Each coverage check has a budget or cap to ensure convergence — interview has a follow-up round budget, PRD has a configured pass cap, and beads has its own configured pass cap. Blueprint expansion happens in the dedicated Expanding Blueprint phase that follows.',
    ],
  },
  WAITING_INTERVIEW_APPROVAL: {
    overview: 'The interview is ready for human review and approval. This is a user-input gate — no AI work proceeds until you explicitly approve. You can inspect the full interview results (questions, answers, and skip decisions), make edits to answers or the raw YAML representation, and only approve when you are satisfied that the interview captures your intent correctly. The approved interview becomes the authoritative source material that drives PRD generation.',
    steps: [
      'Review Interface: LoopTroop exposes the canonical interview in two modes — a structured view showing questions and answers in a readable format, and a raw YAML editing view for direct text manipulation. You can switch between these views freely.',
      'Editing Answers: You can adjust any answer text, change skip decisions, or modify the raw YAML directly. The UI maintains temporary unsaved draft state between view switches so your edits are not lost when toggling between structured and raw modes.',
      'Saving Changes: Saving writes the updated interview artifact back to the ticket workspace and refreshes all relevant caches. If this is a post-approval edit while the ticket is still before PRE_FLIGHT_CHECK, saving archives the current approved interview version plus downstream PRD/beads planning attempts, intentionally cancels active downstream planning sessions, saves and approves the edited interview as the new active version, clears stale downstream artifacts and UI state, and starts DRAFTING_PRD.',
      'Approval Decision: Approving locks in the current interview results as the authoritative source material for PRD drafting. Once approved, the interview answers become the ground truth that the PRD council uses to generate specifications.',
      'Post-Approval Editing Window: After approval, interview edits remain allowed only while the ticket is still before PRE_FLIGHT_CHECK. Once the ticket reaches pre-flight or later, interview edits are rejected because implementation planning has already been locked for execution.',
    ],
    outputs: [
      'Approved interview artifact — the finalized, authoritative version of interview questions and answers.',
      'User-edited replacement (if edits were made before approval).',
      'Optional persisted UI draft state for in-progress edits.',
      'A locked interview baseline that the PRD council treats as ground truth.',
      'Archived approved interview versions and downstream PRD/beads planning attempts remain read-only history when a post-approval edit creates a new active version.',
    ],
    transitions: [
      'Approve → Council Drafting Specs: Approval advances the workflow to PRD drafting, where multiple council models independently generate specification documents based on your approved interview answers.',
      'Cancel → Canceled: Cancellation moves the ticket to the terminal Canceled state.',
    ],
    notes: [
      'This is the review artifact gate for the interview phase — it ensures a human has signed off before expensive PRD generation begins.',
      'No AI context is passed in this phase — it is entirely user-driven. The AI does not see or process anything during approval.',
      'Tip: Review skipped questions carefully. Skipped questions will have AI-generated answers filled in during PRD drafting. If you have opinions about those topics, it is better to provide real answers now than to rely on AI guesses later.',
      'Tip: This is your last easy chance to influence the interview before it feeds into the PRD. Editing after approval is possible only before PRE_FLIGHT_CHECK, and saving intentionally cancels active downstream planning sessions as cancellation rather than blocked errors so DRAFTING_PRD restarts from the new approved interview.',
    ],
    equivalents: [
      'This is the "approval gate" of the Interview phase. The same pattern repeats in the Specs (PRD) phase as "Approving Specs" (where you review and approve the PRD before beads planning) and in the Blueprint (Beads) phase as "Approving Blueprint" (where you review and approve the execution plan before coding starts).',
      'All three approval gates share the same mechanics: human review → optional editing → explicit approval to advance. Each gate controls what feeds into the next major phase: approved interview → PRD drafting, approved PRD → beads drafting, approved beads → coding execution.',
      'Post-approval edits are planning-only. Interview and PRD edits are allowed only before PRE_FLIGHT_CHECK. Saving them archives the previous approved planning generation and affected downstream attempts, treats active downstream session aborts as intentional cancellation, saves and approves the edit, and restarts the next drafting phase.',
    ],
  },
  DRAFTING_PRD: {
    overview: 'The PRD council produces competing specification drafts from the approved interview, relevant files, and ticket context. This is a 2-part phase: Part 1 lets each council member create its own Full Answers artifact by filling any skipped interview answers, and Part 2 uses that member-specific complete answer set to generate a full PRD draft. Each council member independently produces both its assumptions and its PRD — they do not collaborate or see each other\'s work.',
    steps: [
      'Part 1 — Answering Skipped Questions: LoopTroop loads the relevant files, ticket details, and interview results (including which questions were answered vs. skipped). For each skipped question, each council member generates a reasonable full answer based on the available context. The result is a per-model "Full Answers" artifact where every question has a response — either the user\'s original answer or that model\'s AI-generated fill-in.',
      'Why Keep Per-Model Full Answers? The PRD council benefits from diverse assumptions when the user skipped uncertain areas. Keeping Full Answers per model lets voting evaluate each PRD draft together with the assumptions that produced it, instead of forcing all members through one canonical guess before drafting.',
      'Part 2 — Generating PRD Drafts: LoopTroop loads the relevant files, ticket details, and that member\'s Full Answers artifact (including AI-filled responses). Each council model independently produces a complete PRD candidate rather than editing a shared draft. This independence ensures diverse specification approaches.',
      'PRD Content Structure: Each draft follows a consistent structure containing requirements (what the system should do), acceptance criteria (how to verify it works), edge cases (unusual situations to handle), test intent (what should be tested and how), and implementation guidance (suggested approach and constraints).',
      'Output Normalization: LoopTroop normalizes draft output to ensure consistent structure, records draft metrics (requirement count, acceptance criteria count, edge case count), logs structured-output diagnostics, and persists the draft artifacts for the upcoming voting phase.',
    ],
    outputs: [
      'Per-model Full Answers artifacts — complete interview documents with AI-generated responses filling in skipped questions where needed (produced in Part 1). The winning model\'s Full Answers artifact is later available read-only from Approving Specs.',
      'Competing PRD drafts — one from each council member — each containing requirements, acceptance criteria, edge cases, test intent, and implementation guidance.',
      'Draft metrics and structured-output diagnostics for each council member\'s output.',
    ],
    transitions: [
      'Quorum Met → Voting on Specs: When enough valid PRD drafts are ready (meeting the configured quorum threshold), the workflow advances to the PRD voting phase.',
      'Quorum Failure → Blocked Error: Draft generation failures, insufficient valid drafts for quorum, or council member timeouts route the ticket to Blocked Error.',
    ],
    notes: [
      'This phase has 2 internal parts with different context inputs: Part 1 receives Relevant Files + Ticket Details + Interview Results; Part 2 receives Relevant Files + Ticket Details + Full Answers.',
      'The PRD phase is the first stage that converts interview intent into a formal implementation specification — it bridges the gap between "what do you want" (interview) and "what should be built" (specification).',
      'Each council member drafts from its own Full Answers artifact, so the PRD vote selects both a specification approach and the assumptions behind it.',
    ],
    equivalents: [
      'This is the "multi-model drafting" step of the Specs (PRD) phase. The equivalent in the Interview phase is "Council Drafting Questions" (where council members independently draft competing interview questions) and in the Blueprint (Beads) phase is "Council Drafting Blueprint" (where council members independently propose competing task decompositions).',
      'Unlike the Interview drafting phase, PRD drafting has a 2-part structure: Part 1 fills in skipped interview answers first, then Part 2 generates actual PRD drafts from those completed answers. The Interview and Beads drafting phases are single-part.',
    ],
  },
  COUNCIL_VOTING_PRD: {
    overview: 'The council scores the PRD candidates against a weighted PRD rubric to choose the strongest specification baseline. Each member scores all drafts independently, and drafts are anonymized to prevent self-voting bias. The winning PRD becomes the starting point for refinement — it is not the final PRD, but the best foundation to build on.',
    steps: [
      'Draft Anonymization: LoopTroop strips authorship from the PRD drafts and assigns neutral identifiers. This prevents models from recognizing their own output and voting in their own favor.',
      'Randomized Presentation: Drafts are presented in a randomized order to each voter to control for position bias — the tendency to favor items that appear first or last.',
      'Independent Scoring: Each council member receives all anonymized PRD drafts plus the PRD scoring rubric and evaluates every draft independently. Votes include weighted rubric scores, draft rankings, and written justifications explaining their reasoning.',
      'PRD Rubric Categories: The rubric typically evaluates requirement completeness (are all needed requirements present?), acceptance criteria quality (are criteria specific and testable?), edge case coverage (are unusual scenarios addressed?), test intent clarity (is it clear what to test and how?), and structural coherence (is the document well-organized and internally consistent?).',
      'Vote Resolution: The vote resolver totals the weighted scores across all members, applying configured tie-breaking rules if needed, and selects the single winning PRD draft for refinement.',
      'Audit Persistence: Vote order, individual scoring payloads, per-model breakdowns, and final outcome metadata are all persisted for later review and transparency.',
    ],
    outputs: [
      'PRD vote artifacts with per-model rubric scores, rankings, and written justifications.',
      'A winning PRD draft reference — the draft that will be refined into the PRD Candidate v1.',
      'Full audit data showing the selected draft, score spread, presentation order, and any tie-breaking decisions.',
    ],
    transitions: [
      'Winner Selected → Refining Specs: A successful winner selection advances the workflow to refinement, where the winning draft is enhanced with the best ideas from the losing drafts.',
      'Voting Failure → Blocked Error: Malformed vote output, insufficient valid votes for quorum, or unresolvable errors route the ticket to Blocked Error.',
    ],
    notes: [
      'Context available: Relevant Files + Ticket Details + Interview Results + Competing Drafts (all anonymized).',
      'The winning draft is not the final PRD — it still goes through refinement and coverage checking before approval.',
      'The voting rubric is weighted, meaning some categories (like requirement completeness) may count more than others (like structural coherence) in the final score.',
    ],
    equivalents: [
      'This is the "council voting" step of the Specs (PRD) phase. The equivalent in the Interview phase is "Voting on Questions" (where the council votes on competing interview drafts) and in the Blueprint (Beads) phase is "Voting on Blueprint" (where the council votes on competing beads blueprints).',
      'The PRD voting rubric differs from the other two: it is weighted and focuses on requirement completeness, acceptance criteria quality, edge case coverage, test intent clarity, and structural coherence. Interview voting focuses on question relevance and coverage breadth. Beads voting focuses on decomposition quality, feasibility, and dependency correctness.',
    ],
  },
  REFINING_PRD: {
    overview: 'The winning PRD draft is upgraded into PRD Candidate v1 by selectively pulling in useful improvements from the losing drafts — additional requirements, stronger acceptance criteria, edge cases, or test scenarios that the winner missed. The winning model performs this refinement, preserving its own structure while incorporating the best elements from competitors.',
    steps: [
      'Context Assembly: LoopTroop gives the winning model its own winning draft plus all the losing drafts, clearly labeled. The prompt instructs the model to keep the winning draft\'s structure and core content intact while selectively merging stronger elements from the losers.',
      'Selective Merging: The model reviews each losing draft for requirements, acceptance criteria, edge cases, or test scenarios that are present in the losing draft but absent from the winner. It incorporates these improvements without duplicating existing content or breaking the winning draft\'s organizational structure.',
      'Output Validation: The refinement output is normalized and validated as a proper PRD document — checking for consistent structure, non-empty requirement sections, valid acceptance criteria format, and overall document integrity.',
      'Diff Metadata: LoopTroop optionally generates refinement diff metadata that describes what changed between the original winning draft and the refined candidate. This helps you understand what was added during refinement when you review the PRD later.',
      'Candidate Promotion: The resulting document becomes PRD Candidate v1 — the first versioned candidate that enters the coverage verification loop. This is not yet the final PRD; coverage may produce additional versions before approval until the configured cap is reached.',
    ],
    outputs: [
      'Refined PRD candidate artifact (PRD Candidate v1) — the winning draft enhanced with the best elements from losing drafts.',
      'Optional refinement diff metadata showing what was added or changed during the refinement process.',
      'Normalized PRD content ready for the coverage verification loop.',
    ],
    transitions: [
      'Success → Coverage Check (PRD): A valid refined candidate advances to the PRD coverage check, which verifies the PRD against the winning model\'s Full Answers artifact.',
      'Failure → Blocked Error: Refinement validation failures, malformed output, or model errors route the ticket to Blocked Error.',
    ],
    notes: [
      'The refinement is done by the winning model (from the vote), ensuring the refiner understands the winning approach and can merge additions coherently.',
      'Context available: Relevant Files + Ticket Details + Full Answers + Competing Drafts (the winner is labeled, losers are provided for mining improvements).',
      'PRD Candidate v1 is a versioned identifier — coverage may produce later versions if gaps are found and revisions are needed.',
      'Why refine? The winning draft scored highest overall, but losing drafts often contain individual insights that the winner lacks. Refinement captures those insights without losing the winning structure.',
    ],
    equivalents: [
      'This is the "refinement" step of the Specs (PRD) phase. The equivalent in the Interview phase is "Refining Interview" (where the winning interview draft is compiled into the interactive format) and in the Blueprint (Beads) phase is "Refining Blueprint" (where the winning blueprint is enhanced with ideas from losing blueprints).',
      'PRD and Beads refinement are very similar — both merge improvements from losing drafts into the winner. Interview compilation differs slightly because it also transforms the format (from a raw draft into a normalized, interactive session structure), but the core idea is the same: take the winning output and strengthen it.',
    ],
  },
  VERIFYING_PRD_COVERAGE: {
    overview: 'LoopTroop runs a versioned PRD coverage loop, comparing the current PRD candidate against the winning model\'s Full Answers artifact to find any missing requirements or gaps. Unlike the interview coverage loop (which sends you back to answer more questions), PRD coverage stays inside this same phase — the model revises the PRD directly when gaps are found. The loop can produce later PRD candidate versions until the configured cap is reached, and if gaps remain after that, the latest version still advances to approval with warnings.',
    steps: [
      'Coverage Evaluation: The winning PRD model compares the current PRD candidate against that model\'s Full Answers artifact. It returns a structured coverage result: either "clean" (the PRD fully covers the canonical completed answers) or "gaps found" (specific requirements or acceptance criteria are missing or incomplete).',
      'Gap Details: When gaps are found, the coverage result includes specific descriptions of what is missing, which completed answers are not reflected in the PRD, unresolved source-artifact contradictions when present, and why the gap matters for implementation correctness.',
      'In-Phase Revision: If gaps are found and the coverage cap has not been reached, LoopTroop asks the model to produce a revised PRD that addresses the identified gaps. The revised candidate is validated and promoted to the next version number (for example v1 → v2) within the same phase.',
      'Version History: Coverage attempts and version transitions are persisted, so you can see what changed between PRD versions and why. Each attempt records the coverage result, identified gaps, revision actions, and the resulting candidate version.',
      'Clean Finalization: If the PRD becomes clean (all gaps resolved), the clean result is recorded and the current candidate becomes the approval candidate with a clean status.',
      'Cap Enforcement: If the configured PRD coverage cap is reached, LoopTroop advances using the latest candidate even if minor gaps remain. The unresolved-gap history is preserved and visible during approval so you can address any remaining issues manually.',
    ],
    outputs: [
      'Versioned PRD coverage attempts and transition history — showing the journey from Candidate v1 through any revisions.',
      'Latest PRD candidate after zero or more coverage revisions.',
      'Structured diagnostics about artifact processing notices, identified gaps, and whether they were resolved.',
    ],
    transitions: [
      'Clean → Approving Specs: A clean candidate (no remaining gaps) advances to the PRD approval gate.',
      'Cap Reached → Approving Specs: If the coverage cap is hit, the latest candidate advances to approval with warnings about unresolved gaps preserved for your review.',
      'Failure → Blocked Error: Coverage execution failures, model errors, or revision validation problems route the ticket to Blocked Error.',
    ],
    notes: [
      'Unlike the interview loop (which bounces back to the user for more answers), PRD gap resolution stays inside this same phase — the model revises the PRD directly.',
      'The maximum number of coverage versions is configuration-driven to ensure convergence without hard-coding a single limit for every project.',
      'Context available: winning model Full Answers + PRD (current candidate version). The approved interview is not fed to this phase; the winner Full Answers artifact is the canonical coverage source.',
      'Why cap the loop? Diminishing returns: most meaningful gaps are caught in early revisions. The cap prevents the loop from endlessly polishing minor details while delaying your approval review.',
    ],
    equivalents: [
      'This is the "coverage check" step of the Specs (PRD) phase. The equivalent in the Interview phase is "Coverage Check (Interview)" (where the interview is checked for missing information) and in the Blueprint (Beads) phase is "Coverage Check (Beads)" (where the beads blueprint is checked against the approved PRD).',
      'Key difference from Interview coverage: PRD coverage resolves gaps automatically (the model revises the PRD within this same phase) rather than sending you back for more user input. Key difference from Beads coverage: Beads coverage is followed by a dedicated Expanding Blueprint phase that transforms the validated semantic blueprint into execution-ready bead records with commands, file targets, and dependency graphs — PRD coverage has no equivalent expansion phase.',
      'What is being verified against what: Interview coverage checks interview answers against the ticket description. PRD coverage checks the PRD against the winning model\'s Full Answers artifact. Beads coverage checks the beads blueprint against the approved PRD.',
    ],
  },
  WAITING_PRD_APPROVAL: {
    overview: 'The latest PRD candidate is ready for human review and approval before architecture planning starts. This is a user-input gate — no AI work proceeds until you explicitly approve. You can review the specification in structured or raw form, edit any section, inspect the winning model\'s read-only Full Answers artifact from Part 1 of PRD drafting, and check whether coverage warnings exist from the coverage loop. The approved PRD becomes the authoritative input that drives beads (implementation task) planning.',
    steps: [
      'Review Interface: LoopTroop renders the PRD in two modes — a structured view showing requirements, acceptance criteria, edge cases, and test intent in a readable format, and a raw YAML editing view for direct manipulation. You can switch freely between views.',
      'Full Answers Context: If the winning PRD model produced a Full Answers artifact during Part 1 of PRD drafting, the approval header shows a compact Full Answers chip. Opening it displays the complete read-only interview answer set that the winning PRD draft used, including user answers and any AI-filled skipped answers. This artifact is supporting context only; edits are made to the PRD itself.',
      'Coverage Warnings: If the latest PRD candidate reached approval after exhausting the coverage loop cap (rather than achieving a fully clean status), coverage warnings are displayed prominently. These warnings describe unresolved gaps, including unresolved source-artifact contradictions when present, so you can decide whether to address them manually before approving.',
      'Editing: You can edit any section of the PRD — add requirements, refine acceptance criteria, adjust edge cases, or rewrite test intent. The UI preserves temporary draft state between view switches. Saving writes the updated PRD artifact back to the ticket workspace. If this is a post-approval edit while the ticket is still before PRE_FLIGHT_CHECK, saving archives the current approved PRD version plus downstream beads planning attempts, intentionally cancels active downstream planning sessions, saves and approves the edited PRD as the new active version, clears stale downstream artifacts and UI state, and starts DRAFTING_BEADS.',
      'Approval Decision: Approving confirms the current PRD as the authoritative specification for beads drafting. The beads council will decompose this approved PRD into implementable tasks.',
      'Post-Approval Editing Window: After approval, PRD edits remain allowed only while the ticket is still before PRE_FLIGHT_CHECK. Once the ticket reaches pre-flight or later, PRD edits are rejected because the implementation plan has already been accepted for execution.',
    ],
    outputs: [
      'Approved PRD artifact — the finalized, authoritative specification for the implementation.',
      'User-edited replacement (if edits were made before approval).',
      'Optional UI draft state for in-progress structured and raw edits.',
      'Read-only winning Full Answers artifact available as approval context when PRD drafting produced one.',
      'A locked PRD baseline that the beads council uses as its primary input.',
      'Archived approved PRD versions and downstream beads planning attempts remain read-only history when a post-approval edit creates a new active version.',
    ],
    transitions: [
      'Approve → Council Drafting Blueprint: Approval advances the workflow to the beads drafting phase, where multiple council models independently decompose the PRD into implementable task blueprints.',
      'Cancel → Canceled: Cancellation moves the ticket to the terminal Canceled state.',
    ],
    notes: [
      'This is the review artifact gate for the PRD phase — it ensures a human has signed off on the specification before expensive architecture planning begins.',
      'No AI context is passed in this phase — it is entirely user-driven. The AI does not see or process anything during approval.',
      'The Full Answers chip does not create another editable approval artifact. It shows the winning model\'s Part 1 context so you can understand which completed interview answers shaped the PRD.',
      'Tip: Pay special attention to acceptance criteria — they directly determine how the AI will verify its own implementation during the coding phase.',
      'Tip: If coverage warnings exist, read the unresolved gaps carefully. Minor gaps may be acceptable, but gaps in core requirements could lead to an incomplete implementation.',
      'Tip: Editing the PRD after beads planning starts intentionally cancels and archives downstream beads planning. Active downstream session aborts are cancellation, not blocked errors; archived attempts remain inspectable, while DRAFTING_BEADS restarts from the edited approved PRD.',
    ],
    equivalents: [
      'This is the "approval gate" of the Specs (PRD) phase. The equivalent in the Interview phase is "Approving Interview" (where you review and approve the interview results before PRD drafting) and in the Blueprint (Beads) phase is "Approving Blueprint" (where you review and approve the execution plan before coding starts).',
      'All three approval gates serve as quality checkpoints between major pipeline stages. This one sits between interview → PRD (upstream) and PRD → beads (downstream). Approving here locks the PRD as authoritative input for beads planning, just as approving the interview locks it for PRD drafting.',
    ],
  },
  DRAFTING_BEADS: {
    overview: 'The beads council decomposes the approved PRD into implementable tasks — called "beads" — that the coding agent will later execute one by one. Each council member independently proposes a semantic beads blueprint: a task-level breakdown with descriptions, acceptance criteria, dependencies, and test intent. The blueprints at this stage are still "semantic" (describing what to do) rather than "execution-ready" (containing exact commands and file paths).',
    steps: [
      'Context Loading: LoopTroop loads the approved PRD, ticket details, and relevant-files context into the beads drafting prompt. This gives each council member the full picture: what needs to be built (PRD), why (ticket), and what code already exists (relevant files).',
      'Independent Blueprint Drafting: Each council member independently proposes a semantic beads blueprint. A blueprint contains individual bead definitions, each with a description of what the bead should accomplish, acceptance criteria for verifying completion, dependency declarations (which beads must complete before this one can start), and test intent (what tests should verify this bead\'s work).',
      'Task Decomposition Strategy: Models decide how to split the PRD into beads — balancing granularity (each bead should be a meaningful unit of work) against dependency complexity (too many fine-grained beads create complex dependency chains). Different council members may propose very different decomposition strategies.',
      'Validation & Metrics: Draft output is normalized, validated against the expected schema (proper bead structure, valid dependency references, non-empty fields), and stored as council draft artifacts. Draft metrics capture task counts, structure depth, and dependency graph complexity for each blueprint.',
    ],
    outputs: [
      'Competing beads blueprint drafts — one from each council member — each proposing a different task decomposition strategy.',
      'Draft metrics for task counts, dependency graph complexity, and structural analysis.',
      'Council artifacts persisted for the upcoming voting phase.',
    ],
    transitions: [
      'Quorum Met → Voting on Blueprint: When enough valid blueprints are complete (meeting quorum), the workflow advances to the beads voting phase.',
      'Quorum Failure → Blocked Error: Drafting failures, insufficient valid blueprints for quorum, or model timeouts route the ticket to Blocked Error.',
    ],
    notes: [
      'Context available: Relevant Files + Ticket Details + PRD.',
      'Blueprints at this stage are semantic — they describe tasks conceptually without execution-specific fields like shell commands or exact file paths. Those are added later during the expansion step.',
      'Why independent drafting? Different models may identify different natural task boundaries. Voting on competing blueprints helps select the most logical and implementable decomposition.',
    ],
    equivalents: [
      'This is the "multi-model drafting" step of the Blueprint (Beads) phase. The equivalent in the Interview phase is "Council Drafting Questions" (where council members draft competing interview questions) and in the Specs (PRD) phase is "Council Drafting Specs" (where council members draft competing PRD documents).',
      'Unlike PRD drafting (which has a 2-part structure with skipped-answer filling), beads drafting is a single-part phase. The output is also fundamentally different: instead of a document (interview questions or specification), each council member produces a task decomposition graph with dependencies — making this the most architecturally complex drafting phase.',
    ],
  },
  COUNCIL_VOTING_BEADS: {
    overview: 'The council ranks the competing beads blueprints to pick the most credible implementation plan. Each member scores all blueprints independently against an architecture rubric that evaluates decomposition quality, feasibility, dependency correctness, and testability. The winning blueprint becomes the foundation for refinement.',
    steps: [
      'Blueprint Anonymization: LoopTroop anonymizes the beads blueprints and assigns neutral identifiers to prevent self-voting bias.',
      'Randomized Presentation: Blueprints are presented in randomized order to each voter to control for position bias.',
      'Independent Scoring: Each council member evaluates every blueprint independently using the architecture rubric. Scores cover decomposition quality (are the tasks logically divided?), feasibility (can each bead actually be implemented independently?), dependency correctness (are dependencies properly declared and acyclic?), and testability (can each bead\'s completion be meaningfully verified?).',
      'Vote Resolution: The vote resolver totals the rubric scores across all members, applies tie-breaking rules if needed, and selects the winning beads blueprint.',
      'Audit Persistence: Votes, presentation order, per-model scoring breakdowns, and outcome metadata are stored as artifacts for audit and transparency.',
    ],
    outputs: [
      'Beads voting artifacts with per-model architecture scorecards and justifications.',
      'A winning semantic blueprint reference — the blueprint that scored highest overall.',
      'Audit history showing why the blueprint won, including score spread, per-category breakdowns, and any tie-breaking decisions.',
    ],
    transitions: [
      'Winner Selected → Refining Blueprint: A successful winner selection advances the workflow to the refinement phase, where the winner is enhanced with the best ideas from losing blueprints.',
      'Voting Failure → Blocked Error: Invalid votes, quorum collapse, or unresolvable errors route the ticket to Blocked Error.',
    ],
    notes: [
      'Context available: Relevant Files + Ticket Details + PRD + Competing Drafts (all anonymized).',
      'The architecture rubric differs from the PRD and interview rubrics — it focuses on implementation feasibility and dependency structure rather than requirement coverage.',
      'The winning blueprint is not the final plan — it still goes through refinement, coverage checking (Coverage Check (Beads)), and expansion (Expanding Blueprint) before becoming execution-ready beads.',
    ],
    equivalents: [
      'This is the "council voting" step of the Blueprint (Beads) phase. The equivalent in the Interview phase is "Voting on Questions" (where the council votes on competing interview drafts) and in the Specs (PRD) phase is "Voting on Specs" (where the council votes on competing PRD drafts).',
      'The architecture rubric used here is the most technically focused of the three voting rubrics: it evaluates decomposition quality, feasibility, dependency correctness, and testability. By contrast, interview voting evaluates question relevance and coverage, while PRD voting evaluates requirement completeness and acceptance criteria quality.',
    ],
  },
  REFINING_BEADS: {
    overview: 'The winning beads blueprint stays the backbone while LoopTroop pulls in stronger tasks, tests, constraints, and edge cases from the losing blueprints. The refined output remains a semantic plan — execution-specific fields (shell commands, exact file paths, runtime configuration) are added later during the expansion step in the Expanding Blueprint phase that follows coverage checking.',
    steps: [
      'Context Assembly: The winning model receives its own winning blueprint plus all losing blueprints, clearly labeled. The prompt instructs it to preserve the winning structure while selectively merging improvements from the losers.',
      'Selective Merging: The model reviews each losing blueprint for tasks, acceptance criteria, edge cases, or dependency insights that are present in the loser but absent from the winner. It incorporates these improvements without duplicating content, breaking the dependency graph, or fundamentally restructuring the winning blueprint.',
      'Output Normalization: LoopTroop normalizes the refinement output, validates the bead structure and dependency graph integrity, and stores the refined candidate. Attribution metadata is preserved where possible so you can see which improvements came from which losing blueprint.',
      'UI Diff Artifacts: Diff artifacts are generated showing what changed between the original winning blueprint and the refined version, helping you understand the refinement impact during later review.',
      'Semantic Preservation: The refined candidate is intentionally kept at the semantic level — task descriptions, acceptance criteria, and dependency declarations, but no execution commands or runtime paths. The expansion step (in the Expanding Blueprint phase, after coverage checking) handles that transformation.',
    ],
    outputs: [
      'Refined semantic beads blueprint — the winning blueprint enhanced with the best elements from losing competitors.',
      'Refinement attribution and diff metadata for UI inspection.',
      'A validated candidate structure ready for the coverage verification loop.',
    ],
    transitions: [
      'Success → Coverage Check (Beads): A valid refined blueprint advances to the beads coverage loop, which verifies it against the approved PRD.',
      'Failure → Blocked Error: Refinement failures, dependency graph violations, or validation errors route the ticket to Blocked Error.',
    ],
    notes: [
      'This phase still works on the semantic plan, not execution-ready bead records. Execution fields are added in the Expanding Blueprint phase, after coverage checking.',
      'Context available: Relevant Files + Ticket Details + PRD + Competing Drafts.',
      'Why refine before expansion? Semantic-level refinement is cheaper and more flexible. It is easier to add or modify task descriptions than to redo execution-specific fields after expansion.',
    ],
    equivalents: [
      'This is the "refinement" step of the Blueprint (Beads) phase. The equivalent in the Interview phase is "Refining Interview" (where the winning interview draft is compiled into the interactive format) and in the Specs (PRD) phase is "Refining Specs" (where the winning PRD draft is enhanced with ideas from losing drafts).',
      'Beads refinement is very similar to PRD refinement — both merge improvements from losing drafts. The key difference is that beads refinement stays at the semantic level (task descriptions and acceptance criteria) because the execution-ready fields (commands, file paths) are added later in the Expanding Blueprint phase, after the coverage check. PRD refinement produces the near-final document directly.',
    ],
  },
  VERIFYING_BEADS_COVERAGE: {
    overview: 'LoopTroop verifies the semantic beads blueprint against the approved PRD, revising it until it is acceptable. This is a pure coverage review loop: it checks and revises the semantic blueprint against the PRD until coverage is clean or until the configured beads coverage cap is reached. Once done, the workflow automatically advances to the Expanding Blueprint phase.',
    steps: [
      'Coverage Evaluation: The winning beads model compares the current semantic blueprint against the PRD and returns a structured clean-or-gaps result. "Clean" means every PRD requirement is covered by at least one bead. "Gaps" means specific requirements lack corresponding beads, have insufficient acceptance criteria, or depend on unresolved source-artifact contradictions.',
      'Gap Resolution: If gaps are found, LoopTroop records the coverage attempt, requests a targeted revision that adds the missing beads or strengthens existing acceptance criteria, validates the revision, and promotes the next blueprint version. This loop can repeat until clean or until the configured beads coverage cap is reached.',
      'Version Tracking: Each coverage attempt and revision is persisted as coverage history, so you can see the evolution from the initial blueprint through each revision and understand what changed at each step.',
      'Finalization: Once coverage is clean (or the cap is reached), the workflow emits the result and automatically advances to the Expanding Blueprint phase, which transforms the validated semantic blueprint into execution-ready bead records.',
    ],
    outputs: [
      'Versioned beads coverage history showing each coverage evaluation and revision.',
      'Latest refined semantic blueprint (after coverage revisions).',
      'Coverage result (clean or cap-reached), including any unresolved-gap warnings, that triggers automatic advancement to the expansion phase.',
    ],
    transitions: [
      'Coverage Clean → Expanding Blueprint: When the semantic blueprint passes coverage with no gaps, the workflow automatically advances to the Expanding Blueprint phase.',
      'Coverage Cap Reached → Expanding Blueprint: If the coverage cap is hit, the workflow advances to expansion with the latest available blueprint even if minor gaps remain. Coverage history is preserved for later review.',
      'Coverage Failure → Blocked Error: Coverage evaluation errors, revision validation failures, or model timeouts route the ticket to Blocked Error.',
    ],
    notes: [
      'This phase handles only the semantic coverage loop — expansion into execution-ready bead records happens in the separate Expanding Blueprint phase that follows.',
      'The beads coverage cap ensures convergence — the loop cannot run indefinitely.',
      'Context available: PRD + Beads (semantic blueprint).',
      'Why separate coverage from expansion? Coverage at the semantic level is cheaper and faster than expansion. By checking coverage first at the semantic level, LoopTroop avoids wasting expansion effort on a blueprint that would need revision.',
    ],
    equivalents: [
      'This is the "coverage check" step of the Blueprint (Beads) phase. The equivalent in the Interview phase is "Coverage Check (Interview)" (where the interview is checked for missing information) and in the Specs (PRD) phase is "Coverage Check (PRD)" (where the PRD is checked against the winning model\'s Full Answers artifact).',
      'All three coverage checks share the goal of verifying completeness and resolve gaps automatically or via user input. What makes beads coverage unique is that it is followed by a separate expansion phase (Expanding Blueprint) that transforms the validated semantic blueprint into execution-ready bead records with commands, file targets, and dependency graphs. Interview and PRD coverage have no equivalent expansion step.',
      'What is being verified against what: Interview coverage checks answers against the ticket. PRD coverage checks the PRD against the winning model\'s Full Answers artifact. Beads coverage checks the blueprint against the approved PRD.',
    ],
  },
  EXPANDING_BEADS: {
    overview: 'LoopTroop transforms the coverage-validated semantic blueprint into execution-ready bead records. This expansion step adds execution-specific fields to each bead — shell commands to run, file paths to create or modify, expected test commands, dependency graph with topological ordering, and runtime metadata. The expanded output becomes the approval candidate shown in the beads approval UI.',
    steps: [
      'Blueprint Loading: LoopTroop loads the latest semantic blueprint from the coverage phase — either the final coverage revision or the original refined blueprint if no revisions were needed.',
      'Expansion: The expansion model receives the semantic blueprint along with the relevant files, ticket details, and approved PRD. It produces execution-ready bead records by enriching each bead with shell commands, file targets, test commands, dependency edges, and runtime metadata.',
      'Bead Record Writing: The expanded bead records are written to the ticket workspace as the canonical beads data file. This is the file the pre-flight check validates and the coding loop consumes bead-by-bead.',
      'Approval Candidate: The expanded output is persisted as the beads approval candidate artifact. This is what you review in the Approving Blueprint phase before coding starts.',
    ],
    outputs: [
      'Expanded execution-ready beads data with commands, file targets, dependency graphs, and runtime metadata.',
      'Canonical beads data file in the ticket workspace — the file the coding agent consumes.',
      'Approval candidate artifact for the Approving Blueprint UI.',
    ],
    transitions: [
      'Expansion Complete → Approving Blueprint: After the expansion step completes, the workflow advances to beads approval where you review the full execution plan.',
      'Expansion Failure → Blocked Error: Expansion errors or model timeouts route the ticket to Blocked Error.',
    ],
    notes: [
      'This is the only planning phase that ends with an explicit semantic-to-execution expansion step — all other phases work at the semantic level only.',
      'Context available: Relevant Files + Ticket Details + PRD + Semantic Blueprint (beads_draft).',
      'Why expand separately from coverage? Expansion is expensive and adds execution-specific detail. By doing coverage at the semantic level first (in Coverage Check (Beads)), LoopTroop avoids wasting expansion effort on a blueprint that would need revision.',
    ],
    equivalents: [
      'This is the "expansion" step unique to the Blueprint (Beads) phase — it has no direct equivalent in the Interview or Specs (PRD) phases. It follows immediately after Coverage Check (Beads) and precedes Approving Blueprint.',
      'Unlike all other planning phases which stay at the semantic level, this phase produces execution-ready artifacts: bead records with concrete commands, file targets, and dependency graphs that the coding agent will consume directly.',
    ],
  },
  WAITING_BEADS_APPROVAL: {
    overview: 'The final expanded beads plan is ready for human review before any coding begins. This is the last user-input gate before execution starts — once you approve, the coding agent will begin implementing beads one by one. You can review the full execution plan including task descriptions, dependencies, acceptance criteria, and test commands, and edit the plan if needed.',
    steps: [
      'Execution Plan Review: LoopTroop shows the execution-ready beads breakdown, including each bead\'s description, acceptance criteria, dependency chain, file targets, test commands, and execution ordering. You can see exactly what the coding agent will do and in what order.',
      'Dependency Visualization: The beads are shown with their dependency relationships, so you can verify that the execution order makes sense — beads that depend on other beads will not run until their dependencies complete.',
      'Editing: You can review the plan in structured form or edit the raw representation before approving. Changes are saved back to the beads artifact.',
      'Coverage Warnings: If the beads plan reached approval after exhausting the coverage loop cap (rather than achieving a fully clean status), coverage warnings are displayed. These describe unresolved gaps, including PRD requirements that may not have corresponding beads and unresolved source-artifact contradictions when present.',
      'Approval Decision: Approval confirms the execution plan that the coding loop will consume bead-by-bead. After approval, the coding agent receives individual bead specifications — it does not see the full plan, only the bead it is currently implementing.',
    ],
    outputs: [
      'Approved execution-ready beads plan — the authoritative task breakdown the coding agent will follow.',
      'User-edited replacement (if edits were made before approval).',
      'Saved approval editor state for in-progress reviews.',
      'The authoritative bead set consumed by pre-flight checks and the coding loop.',
    ],
    transitions: [
      'Approve → Checking Readiness: Approval advances the workflow to pre-flight checks, which validate that the execution environment is ready before the first bead runs.',
      'Cancel → Canceled: Cancellation moves the ticket to the terminal Canceled state.',
    ],
    notes: [
      'This is the review artifact gate for the beads phase and the last approval step before automated code execution begins.',
      'No AI context is passed in this phase — it is entirely user-driven.',
      'Tip: Review the dependency chain carefully. Incorrect dependencies could cause beads to run before their prerequisites are ready, leading to implementation errors.',
      'Tip: Check that acceptance criteria are specific and testable. The coding agent uses acceptance criteria to verify its own work — vague criteria may lead to incomplete implementations.',
    ],
    equivalents: [
      'This is the "approval gate" of the Blueprint (Beads) phase — the last of three approval gates in the planning pipeline. The equivalent in the Interview phase is "Approving Interview" (the first gate) and in the Specs (PRD) phase is "Approving Specs" (the second gate).',
      'This is the most consequential approval gate because it is the last human checkpoint before automated code execution begins. Approving the interview feeds into PRD drafting (a planning step). Approving the PRD feeds into beads drafting (still a planning step). But approving beads feeds directly into the coding agent — which will start modifying files in your repository.',
    ],
  },
  PRE_FLIGHT_CHECK: {
    overview: 'LoopTroop runs a deterministic pre-flight gate before any execution-band AI work starts. This validates coding-agent connectivity, execution-mode session capability, workspace integrity, required artifact availability, and the bead dependency graph\'s structural correctness. The pre-flight check exists to prevent the execution setup and coding phases from starting in a broken state.',
    steps: [
      'Workspace Validation: LoopTroop verifies that the ticket workspace directory exists, is writable, and contains the expected artifact files (relevant files, interview, PRD, beads data).',
      'Coding Agent Connectivity: The pre-flight doctor checks that the configured coding agent (OpenCode) is reachable and responsive. This catches connectivity issues, authentication problems, or configuration errors before execution-band work begins.',
      'Execution Capability Probe: LoopTroop creates a temporary execution-band session using the same model/variant combination planned for real work, sends a tiny read-only probe prompt, requires the exact response `OK`, and then tears the probe session down. This catches session-create or tool-mode incompatibilities that a generic health check would miss.',
      'Bead Availability Check: LoopTroop confirms that the approved beads data file exists, is parseable, and contains at least one runnable bead with valid structure.',
      'Dependency Graph Validation: The bead dependency graph is checked for structural integrity — no circular dependencies, no references to non-existent beads, and at least one bead with no dependencies (so the execution loop has a valid starting point).',
      'Pre-Flight Report: A structured pre-flight report is generated with pass, warning, and failure entries for each check. This report is persisted regardless of the overall outcome so you can inspect exactly what passed and what failed.',
      'Execution Handoff: If all checks pass, LoopTroop advances into the dedicated execution-setup phase. Bead progress is not started here — coding still begins later at bead 1/N.',
    ],
    outputs: [
      'Pre-flight report artifact with pass, warning, and failure entries for each validation check.',
      'Execution readiness decision — either "ready to draft the setup plan" or "blocked with specific failure reason."',
    ],
    transitions: [
      'All Checks Pass → Approving Workspace Setup: The workflow advances to the setup-plan approval gate, which audits workspace readiness and drafts only any missing temporary setup before anything mutates the worktree.',
      'Any Critical Failure → Blocked Error: Connectivity failures, missing artifacts, dependency graph problems, or workspace integrity issues route the ticket to Blocked Error with a detailed failure reason.',
    ],
    notes: [
      'This phase is intentionally deterministic and lightweight — it does not perform ticket-specific execution setup or permanent repository changes.',
      'The pre-flight check is designed to catch environmental issues early, before the execution setup or coding agent wastes time on work that would fail due to missing prerequisites.',
      'Warning-level results (non-critical issues) are recorded but do not block execution. Only critical failures prevent the coding loop from starting.',
    ],
  },
  WAITING_EXECUTION_SETUP_APPROVAL: {
    overview: 'LoopTroop audits the current workspace, drafts only the temporary setup that is still missing, and pauses for your review before any execution setup commands run. This gate keeps environment preparation separate from the beads blueprint: beads approval decides what to build, while setup-plan approval decides whether anything must be prepared and, if so, how LoopTroop may prepare the worktree for coding. The review artifact now includes an explicit readiness assessment, so it can cleanly say "already ready, no actions required" without forcing placeholder setup steps.',
    steps: [
      'Automatic Readiness Audit On Entry: When this state is entered, LoopTroop asks the locked main implementer to inspect the approved ticket details, relevant files, PRD, beads, the current worktree, and any prior reusable setup profile, then decide whether temporary setup is actually needed. The draft is created automatically if no current setup-plan artifact exists.',
      'Structured Setup Plan: The draft plan captures an explicit readiness assessment (`ready`, `partial`, or `missing`), whether actions are required, the evidence gathered, unresolved gaps, any ordered setup steps that remain necessary, the allowed temp roots, discovered project-wide command families, and the default quality-gate policy later coding beads should follow.',
      'No-Action Cases Are First-Class: If the audit finds that the environment already has everything needed, the plan stays reviewable but contains no setup steps. You can still approve it as-is or edit it to add commands if you want LoopTroop to do additional temporary preparation.',
      'User Review And Editing: The approval UI lets you review the readiness assessment and setup steps in structured form, edit commands or descriptions, add or remove steps, and fall back to raw YAML/JSON editing when you need full control over the artifact.',
      'Regenerate With Commentary: If the initial assessment or plan is close but not correct, you can send commentary describing what should change. LoopTroop will archive the current plan as a prior version, then regenerate a new draft in the background. You are returned to the ticket overview immediately while generation runs. All previous versions are accessible via the VERSION dropdown at the top of the approval pane.',
      'Approval Handoff: Once approved, this plan becomes the primary execution contract for the next phase. The execution-setup agent must respect the approved readiness assessment and start from the approved plan rather than rediscovering workspace initialization from scratch.',
    ],
    outputs: [
      'Editable `execution_setup_plan` artifact containing the readiness assessment, any proposed temporary environment-setup steps, user-facing diagnostics, and regenerate commentary history.',
      'Underlying plan-generation report and notes artifacts retained for workflow context, auditability, and regenerate continuity.',
      'Approval receipt confirming the reviewed setup plan was explicitly approved before execution setup begins.',
    ],
    transitions: [
      'Approve → Preparing Workspace Runtime: The workflow advances to the execution setup phase, which verifies the approved readiness assessment, performs only the missing temporary setup, and writes the reusable runtime profile.',
      'Regenerate → Returns To Overview: LoopTroop archives the current setup-plan draft as a prior version, starts a new empty draft (loading state), runs generation in the background, and returns you to the ticket overview immediately. All prior versions are accessible via the VERSION dropdown at the top of the approval pane.',
      'Generation Failure → Blocked Error: If LoopTroop cannot produce a valid setup-plan artifact, the ticket routes to Blocked Error with the plan report preserved for diagnosis.',
    ],
    notes: [
      'This state is still pre-coding. No permanent repository files should be modified here.',
      'No AI execution proceeds past this gate until you approve the proposed setup plan.',
      'The approved setup plan is separate from the final execution setup profile. The profile is produced only after the next phase verifies readiness and runs any approved temporary setup inside LoopTroop-owned runtime paths.',
      'Setup-plan generation owns its OpenCode session only while producing the draft: ready reports complete the session, while invalid or failed reports abandon it so retry starts from clean durable context.',
    ],
  },
  PREPARING_EXECUTION_ENV: {
    overview: 'LoopTroop runs a dedicated execution setup phase after the setup-plan approval gate and before coding. This is an AI-driven, retryable, temporary-only phase whose job is to verify the approved readiness assessment, perform only the missing temporary setup under LoopTroop-owned runtime paths, and persist a setup profile that later beads can read by reference when needed. When the approved plan says the environment is already ready, this phase should stay effectively no-op aside from verification and profile emission.',
    steps: [
      'Approved Plan First: The locked main implementer reads the approved setup-plan artifact first, then loads only the focused runtime context — ticket details, beads plan, and any prior setup retry notes. User edits in the approved plan take precedence over the model\'s original draft.',
      'Readiness Verification Before Action: The setup agent must verify the approved readiness assessment first. If the approved plan says no actions are required and that remains true, it should avoid running bootstrap commands and simply emit a reusable profile describing the ready environment.',
      'Temporary-Only Initialization: When setup is still missing, the agent executes only the approved temporary steps, may inspect the repository, run repo-native bootstrap commands, warm caches, or prepare generated runtime artifacts, but only inside LoopTroop-owned runtime paths under `.ticket/runtime/execution-setup/**` plus the profile mirror file `.ticket/runtime/execution-setup-profile.json`.',
      'Reusable Profile Generation: The agent finishes by returning a structured execution setup result that records the temp roots it prepared, bootstrap commands it used, reusable artifacts it created, discovered project command families, and the quality-gate policy later coding beads should follow.',
      'Audited Augmentations: If the approved plan is insufficient and the setup agent must run extra temporary-only commands, those additions are recorded in the setup report so you can see exactly how execution diverged from the approved draft.',
      'Structured Validation: LoopTroop parses the result via a strict marker/schema contract. If the marker or schema is wrong, it sends a same-session structured retry prompt instead of treating the attempt as an implementation failure.',
      'Filesystem Policy Enforcement: After each attempt, LoopTroop verifies in code that setup touched only the allowed runtime paths. Any tracked file changes or off-policy untracked output immediately fail the attempt and produce a retry note describing the violation.',
      'Retry and Reset: If an attempt fails, LoopTroop records retry notes, resets tracked repository files back to the setup phase start commit, clears the setup temp roots/profile mirror, preserves the execution log, and retries until the normal iteration budget is exhausted.',
    ],
    outputs: [
      'Canonical execution setup profile artifact describing reusable temp roots, discovered command families, and quality-gate policy for later coding beads.',
      'Execution setup report artifact with attempt history, final status, retry notes, and structured-output diagnostics.',
      'Temporary runtime artifacts stored only under `.ticket/runtime/execution-setup/**` plus the profile mirror file `.ticket/runtime/execution-setup-profile.json`.',
    ],
    transitions: [
      'Setup Ready → Implementing: A valid setup profile advances the workflow into coding, where the first real bead starts at 1/N.',
      'Setup Failure → Blocked Error: Retry exhaustion, provider/session failures, or temp-only policy violations route the ticket to Blocked Error with the setup report preserved for diagnosis.',
    ],
    notes: [
      'This phase is not a real bead. It does not change bead counts, does not participate in final testing scope, and never produces commits or pushes.',
      'Coding receives a read-only setup profile file path rather than the profile inline, keeping later execution context small while still avoiding repeated environment rediscovery when setup details are needed.',
      'The approved setup plan remains the user-facing review artifact. Execution setup may augment it temporarily, but those augmentations are audited in the execution report instead of silently rewriting the approved plan.',
      'Everything created here is temporary runtime state. Cleanup removes the temp roots at ticket end while preserving audit artifacts and the execution log.',
    ],
  },
  CODING: {
    overview: 'LoopTroop runs the approved beads one at a time, selecting the next runnable bead by dependency order and priority, executing it with the coding agent, and recovering cleanly between failed iterations via worktree reset. Each bead runs in an OpenCode session with its own context, retry budget, and timeout. When an iteration fails, the worktree is reset to the pre-bead git snapshot and the next attempt starts with an AI-generated diagnostic note as additional context. Successful beads are committed to git and their code diffs are captured as artifacts. The status label shows current bead progress (e.g., "Implementing (Bead 3/7)").',
    steps: [
      'Bead Selection and Tracker Update: LoopTroop reads the authoritative bead tracker, identifies all runnable beads (status `pending` with every entry in `blocked_by` present in the done-bead set), and sorts them by `priority` ascending. The first bead in that sorted list is selected. The selected bead is immediately marked `in_progress` in the tracker and ticket progress counters are updated so the UI progress ring reflects active work.',
      'Bead Start Commit Recording (Best Effort): Before the agent writes any files, LoopTroop attempts to record the current git HEAD SHA of the worktree as `beadStartCommit` and persists it in the bead tracker. This SHA is the worktree reset anchor — if a later iteration fails, the worktree can be rolled back to exactly this state. If recording fails (e.g., a git error), execution continues without it; context-wipe reset and bead-diff capture are simply disabled for this bead.',
      'Context Assembly: For the selected bead, LoopTroop assembles inline context from the bead\'s own description, acceptance criteria, file targets, and test commands (`bead_data`) plus any iteration notes accumulated from prior failed attempts (`bead_notes` — these grow with each context wipe). The prompt also points to the read-only setup profile at `.ticket/runtime/execution-setup-profile.json` for optional setup/tooling lookup. The agent receives only this bead-focused context — it does not see the full beads plan, other beads\' results, the PRD, or the interview.',
      'Session Creation and Main Prompt: The locked main implementer opens a new OpenCode session with `keepActive: true` (the session stays open for potential in-session retries without re-creation overhead). The initial bead prompt built from template PROM_CODING is dispatched. Session creation, prompt dispatch, and the start of streaming are logged as AI milestone events.',
      'Inner Response Loop — Completion Marker Evaluation: After each agent response, LoopTroop parses the `<BEAD_STATUS>...</BEAD_STATUS>` completion marker from the response text and branches into one of three paths. (1) Marker present and all gates passing (tests, lint, typecheck, qualitative all "pass", status "done") → success, exit the inner loop immediately. (2) Marker missing or has a validation error (`shouldUseStructuredRetry()` returns true) → if the session is still healthy, sends a same-session structured retry prompt with the BEAD_STATUS_SCHEMA_REMINDER; if the session is unhealthy, abandons it and re-sends the full original bead prompt in a fresh session. (3) Marker found but gates not all passing → sends a continuation prompt (`buildContinuationPrompt`) in the same session, instructing the agent to inspect failures, keep working, and return the final marker only when done. A per-iteration timeout deadline (`perIterationTimeoutMs`) is tracked across all inner-loop steps; once remaining time drops to zero, the inner loop exits with a Timeout error.',
      'Live Streaming: High-signal execution events, prompt dispatches, visible agent responses, file modification events, test results, and session lifecycle events are emitted into the normal phase log in real time. Deeper forensic/debug details live in the debug log.',
      'Scoped Verification: During execution, LoopTroop prefers bead-specific test commands first, then impacted or package-scoped lint and typecheck commands. When command-family details are needed, the coding agent can read the setup profile file instead of receiving it inline. This avoids failing beads solely because of pre-existing repository-wide baseline failures unrelated to this bead\'s work.',
      'Success Path — Git Commit, Diff Capture, Artifacts, and Broadcast: When the inner loop exits successfully, LoopTroop marks the bead `done` in the tracker and updates progress counters. It then runs best-effort git side effects: (a) `commitBeadChanges` creates a per-bead git commit of all file changes and optionally pushes to the remote branch — git failures are logged as warnings but do not un-mark the bead as done; (b) if `beadStartCommit` was recorded, `captureBeadDiff` generates a code-only diff from that SHA to the new HEAD (excluding `.ticket/**` metadata) and stores it as a `bead_diff:{beadId}` phase artifact. The full execution result (iteration count, response text, error history) is persisted as a `bead_execution:{beadId}` phase artifact on both success and failure. Finally, a `bead_complete` SSE event with progress counters (e.g., completed 3/7) is broadcast to the UI.',
      'Failure Path — Context Wipe Note Generation: When an iteration fails (timeout, uncaught error, or inner-loop exhaustion without a valid completion marker), LoopTroop attempts to generate an AI context wipe note by sending the PROM51 prompt to the still-open failing session. PROM51 asks the model to summarise what went wrong, what it tried, and what the next attempt should do differently — the session\'s accumulated tool calls, test output, and error traces make this note more informative than any static template. If PROM51 itself fails (session error, timeout, parse failure), LoopTroop falls back to a deterministic note built from the recorded iteration errors and recent tool-failure excerpts. The note (AI-generated or fallback) is stamped with the iteration number and timestamp and appended to `bead.notes`, accumulating across iterations. These notes are included in the bead context on every subsequent attempt.',
      'Failure Path — Worktree Reset and Status Rollback: After the context wipe note is generated, LoopTroop resets the worktree back to `beadStartCommit` via `resetToBeadStart` (this step is skipped if `beadStartCommit` was not recorded). Only paths listed in `EXECUTION_RUNTIME_PRESERVE_PATHS` survive the reset; all uncommitted file changes from the failed attempt are discarded. The bead\'s status is set back to `pending` in the tracker with the accumulated notes attached. The active session is abandoned after the note is generated, and the outer iteration counter increments.',
      'Retry Budget Exhaustion and Loop Continuation: If the iteration counter reaches `maxIterations`, the bead is marked `error` in the tracker with the `BEAD_RETRY_BUDGET_EXHAUSTED` error code attached, and a `BEAD_ERROR` event is sent — routing the ticket to Blocked Error. From Blocked Error you can retry (re-enters CODING and re-attempts the failed bead using the accumulated iteration notes as context) or cancel. After a successful bead, `isAllComplete` is checked: if every bead is done, `ALL_BEADS_DONE` is sent and the workflow advances to final testing; otherwise `BEAD_COMPLETE` is sent and the state stays in CODING, immediately picking the next runnable bead.',
    ],
    outputs: [
      'Updated bead statuses (pending → in_progress → done/error) and ticket progress counters visible in the UI progress ring.',
      'Per-bead git commits (one per successfully completed bead) created on the ticket worktree branch and optionally pushed to remote (best-effort — git failures are logged as warnings but do not un-mark the bead as done).',
      'Per-bead code-only diffs (`bead_diff:{beadId}`) capturing what each bead changed in the repository (excluding `.ticket/**` metadata), stored as phase artifacts — only produced when `beadStartCommit` was successfully recorded.',
      'Per-bead execution result artifacts (`bead_execution:{beadId}`) with full iteration history, response output, and error details, written on both success and failure.',
      'Accumulated iteration notes in `bead.notes` for any bead that required context wipes — diagnostic context for retry attempts from Blocked Error.',
      '`bead_complete` SSE broadcast events enabling real-time UI progress ring updates after each successful bead.',
    ],
    transitions: [
      'Bead Success + More Remaining → Stays in Coding: After a successful bead, `BEAD_COMPLETE` is sent and the loop immediately selects the next runnable bead.',
      'All Beads Done → Testing Implementation: When every bead is marked `done`, `ALL_BEADS_DONE` is sent and the workflow advances to the final testing phase.',
      'Bead Failure → Blocked Error: A bead that exhausts its iteration budget (`BEAD_RETRY_BUDGET_EXHAUSTED`) or hits an unrecoverable runtime error sends `BEAD_ERROR` and routes the ticket to Blocked Error. Retry from there re-enters CODING and re-attempts the failed bead using accumulated iteration notes as additional context.',
    ],
    notes: [
      'Only runnable beads (status `pending` with all `blocked_by` dependencies in the done set) are eligible for selection. Among those, the one with the lowest `priority` value is picked first. Beads with status `in_progress` or `error` are never selected.',
      'Inline context available to the agent: Current Bead Data (`bead_data`) + Accumulated Iteration Notes (`bead_notes`). Execution setup details remain available by reading `.ticket/runtime/execution-setup-profile.json` when needed. The agent does not receive the full beads plan, the PRD, the interview, or other beads\' results.',
      'The `beadStartCommit` is best-effort: if git fails to record it before execution starts, that bead cannot be reset on context wipe and its diff artifact cannot be captured, but execution still proceeds normally.',
      'Context wipe notes accumulate: each failed iteration appends a new stamped note to `bead.notes`. By iteration N the agent receives a progressive diagnostic history of everything that has been tried and what went wrong — this is the primary mechanism for conveying failure context across iterations.',
      'The context wipe note (PROM51) uses the failing session\'s full accumulated context (tool calls, test output, error traces) to generate an AI-authored diagnostic. If PROM51 itself fails, a deterministic fallback note is built from recorded errors and recent tool-failure excerpts — the worktree reset always completes regardless of whether the AI note succeeds.',
      'Each successful bead produces a separate per-bead git commit. The integration phase later squashes all bead commits into a single clean candidate commit for the pull request.',
    ],
  },
  RUNNING_FINAL_TEST: {
    overview: 'After all beads finish successfully, LoopTroop runs a ticket-level final test to verify the complete implementation as a whole — not just individual beads in isolation. The main implementer generates a comprehensive test plan based on focused implementation context (ticket details, PRD, beads, and any final-test retry notes), and then the generated test commands are executed on the current ticket branch. This catches integration issues that individual bead tests might miss.',
    steps: [
      'Context Assembly: LoopTroop loads ticket details, the approved PRD, the beads plan, and any final-test retry notes. The interview and Full Answers artifacts are intentionally not fed because the PRD and beads already carry the approved implementation intent.',
      'Test Plan Generation: The locked main implementer analyzes the full context and generates a structured final-test plan. This plan includes test commands to execute, expected outcomes, and what each test is verifying. Tests may include unit tests, integration tests, build verification, and acceptance criteria validation.',
      'Test Execution: LoopTroop executes the generated test commands in the ticket worktree under the configured timeout budget. Tests run on the actual branch state produced by the coding phase.',
      'Result Recording: A final test report artifact is written whether tests pass or fail. The report includes the generated test plan, actual command output, pass/fail status for each test, and any error messages or stack traces from failures.',
      'Phase Logging: The normal phase log captures the test lifecycle — plan generation, command execution, output streams, and final results — for review and diagnosis.',
    ],
    outputs: [
      'Final test report with the generated test plan, execution results, pass/fail status, and error details.',
      'Phase logs showing test command execution and output.',
      'A pass/fail gate that determines whether the implementation proceeds to integration or needs manual intervention.',
    ],
    transitions: [
      'All Tests Pass → Preparing Final Commit: Successful final tests advance the workflow to the integration phase, which prepares a clean candidate commit.',
      'Any Test Failure → Blocked Error: Failed tests or test generation failures route the ticket to Blocked Error, where you can retry (re-run tests) or cancel.',
    ],
    notes: [
      'Context available: Ticket Details + PRD + Beads Plan + Final Test Retry Notes.',
      'This phase tests the complete implementation holistically — it catches integration issues between beads that individual bead-level tests might miss.',
      'The test budget (timeout) prevents infinite-running tests from blocking the workflow.',
      'Why generate tests dynamically? The main implementer can create tests tailored to what was actually implemented, rather than relying on pre-written tests that might not exist for new features.',
    ],
  },
  INTEGRATING_CHANGES: {
    overview: 'LoopTroop turns the unsquashed ticket branch (which may contain many small commits from individual bead executions) into a single, clean candidate commit ready for pull-request creation. This produces one reviewable squash commit on the ticket branch while preserving the earlier bead-level history in the audit trail.',
    steps: [
      'Branch Analysis: LoopTroop resolves the ticket worktree and base branch, calculates the merge base (where the ticket branch diverged), and counts the number of individual commits made during bead execution.',
      'Soft Reset: The branch is soft-reset back to the merge base, which unstages all bead-level commits but keeps all file changes in the working directory. This effectively "un-commits" the individual bead commits.',
      'Reviewer-Facing Candidate: All ticket changes (excluding LoopTroop-owned operational files that should not appear in the final PR) are staged and committed as a single candidate commit with LoopTroop-specific commit metadata.',
      'Handoff Metadata: Integration records the candidate SHA, merge base, pre-squash HEAD, and squash statistics. That metadata becomes the source of truth for the next phase, which will push the candidate and create or update the draft PR.',
      'Integration Report: The integration report captures the candidate commit SHA, merge base SHA, pre-squash HEAD, total commit count that was squashed, and file change statistics. This report is persisted for audit and troubleshooting.',
      'Edge Case Handling: If no staged changes exist (e.g., the beads produced no file modifications), or if git operations fail (merge conflicts, corrupt index), the phase records the failure and stops before advancing to PR creation.',
    ],
    outputs: [
      'Integration report artifact with candidate commit SHA, merge base, pre-squash HEAD, commit counts, and file change statistics.',
      'Candidate squash commit on the ticket branch — a single clean commit containing all implementation changes.',
      'Pre-squash metadata for audit, rollback reference, and troubleshooting.',
    ],
    transitions: [
      'Success → Creating Pull Request: A successful candidate commit advances the workflow to the GitHub sync phase, which creates or updates the draft PR.',
      'Failure → Blocked Error: Git operation failures, empty changesets, or merge conflicts route the ticket to Blocked Error.',
    ],
    notes: [
      'Context available: Git state, integration metadata, and final test report. No new model context is assembled in this deterministic git phase.',
      'The squash commit preserves all file changes but replaces the individual bead-level commit history with a single clean commit.',
      'Why squash? Individual bead commits are implementation artifacts — they reflect the AI\'s step-by-step execution, not a meaningful commit history for human review. Squashing produces a single commit that represents "what was implemented" as a whole.',
      'The candidate commit is still local at the end of this phase. GitHub branch and PR synchronization happen in the next automatic phase.',
    ],
  },
  CREATING_PULL_REQUEST: {
    overview: 'LoopTroop pushes the final candidate SHA to the remote ticket branch and creates or updates a draft pull request on GitHub. This is an automatic GitHub-sync phase: it packages the final diff, the ticket intent, and the validation results into a reviewer-facing draft PR without merging anything yet.',
    steps: [
      'Remote Candidate Push: LoopTroop force-pushes the final candidate SHA to the remote ticket branch using a lease, replacing the bead-level backup branch state with the single reviewable candidate commit.',
      'PR Drafting: The locked main implementer generates a draft PR title and body in a fresh owned session using only ticket details and PRD as context, with integration report, final test report, diff stat, changed-file status, and diff patch appended as explicit prompt sections. The interview and beads artifacts are not fed to PR drafting.',
      'PR Upsert: LoopTroop creates a new draft PR when none exists, or updates the existing PR title/body and metadata when one already exists for the ticket branch.',
      'Metadata Persistence: The PR URL, number, state, head SHA, generated title/body, and timestamps are written into ticket artifacts so the review UI and later phases can reuse them deterministically.',
      'Failure Safety: If the push or GitHub operation fails, LoopTroop preserves the local candidate/worktree state and writes a recovery receipt describing the exact next-safe actions.',
    ],
    outputs: [
      'Pull Request report artifact with PR URL, state, number, generated title/body, head SHA, and timestamps.',
      'Remote ticket branch updated to the final candidate commit.',
      'A draft GitHub pull request ready for human review.',
    ],
    transitions: [
      'Success → Reviewing Pull Request: A successful PR sync advances the workflow to the human PR review gate.',
      'Failure → Blocked Error: Push failures, GitHub auth issues, or PR creation/update failures route the ticket to Blocked Error.',
    ],
    notes: [
      'Context available: Ticket Details + PRD, plus explicit integration report, final test report, diff stat, diff name/status, and diff patch sections.',
      'PR drafting always forces a fresh owned OpenCode session. If a matching active CREATING_PULL_REQUEST session exists, LoopTroop aborts and abandons it before creating the new one; successful drafting completes the session because `keepActive` remains false.',
      'This is the GitHub-native handoff point between execution and review.',
      'The PR is draft-first by design so later automated review or human review can happen before merge.',
    ],
  },
  WAITING_PR_REVIEW: {
    overview: 'LoopTroop stops automation and waits for you to review the draft pull request before finishing the ticket. This is the last human gate: you can inspect the PR in GitHub, review the candidate diff and test results locally, and then either merge the PR or finish the ticket without merging.',
    steps: [
      'Draft PR Presentation: The workspace shows the PR URL, current PR state, candidate SHA, branch/base refs, integration report, and final test summary.',
      'Manual Review: You inspect the draft PR and the local result. There is no time limit; LoopTroop waits for your decision.',
      'Merge Path: Choosing Merge PR & Finish marks the PR ready if needed, merges it into the base branch on GitHub, fast-forwards the local base branch to origin, then proceeds to cleanup.',
      'Finish Without Merge Path: Choosing Finish Without Merge preserves the PR and remote ticket branch exactly as they are, then proceeds directly to cleanup and terminal completion.',
      'External Merge Detection: If the PR is merged manually in GitHub while this phase is open, LoopTroop detects that during polling, syncs the local base branch, and continues automatically.',
    ],
    outputs: [
      'A stable draft-PR review gate that exposes the final PR metadata, test results, and integration summary.',
      'A merge report artifact recording whether the ticket completed as merged or closed unmerged.',
      'An explicit human decision before cleanup and terminal completion.',
    ],
    transitions: [
      'Merge PR & Finish → Cleaning Up: GitHub merge succeeds, local base branch is synced, and cleanup starts.',
      'Finish Without Merge → Cleaning Up: The ticket closes successfully without merging and cleanup starts.',
      'System Error → Blocked Error: If PR merge or local sync fails, the workflow routes to Blocked Error with recovery details.',
    ],
    notes: [
      'Context available: PR metadata, final test report, integration summary, and merge controls. No AI prompt context is assembled in this review gate.',
      'This is the human quality gate for the GitHub-native endgame.',
      'LoopTroop completion does not require deleting the PR or remote branch when you finish without merge.',
    ],
  },
  CLEANING_ENV: {
    overview: 'LoopTroop removes temporary runtime resources created during the ticket run while carefully preserving the artifacts needed for audit, review, and historical reference. This phase is automatic — it runs immediately after verification and does not require user input.',
    steps: [
      'Cleanup Scope Determination: LoopTroop identifies which runtime resources are transient (safe to remove) and which are permanent artifacts (must be preserved). The distinction is based on resource type: runtime state is transient, planning and audit artifacts are permanent.',
      'Transient Resource Removal: Lock files, active session folders, stream buffers, temporary files, and runtime state files are removed when present. These resources were needed during execution but have no long-term value.',
      'Artifact Preservation: Planning artifacts (interview, PRD, beads plan), normal and debug execution logs, test reports, integration reports, and phase log history are intentionally preserved. These remain accessible for review, audit, and reference long after the ticket is closed.',
      'Cleanup Report: A cleanup report artifact is generated detailing what was removed, what was preserved, and whether any cleanup operations failed. This report is itself preserved as part of the ticket\'s permanent record.',
    ],
    outputs: [
      'Cleanup report artifact listing all removed and preserved resources.',
      'Freed disk space from transient runtime data (lock files, session folders, temp files).',
      'Intact planning and audit artifacts (interview, PRD, beads, test reports, logs) preserved for future reference.',
    ],
    transitions: [
      'Success → Done: Successful cleanup advances the workflow to the terminal Done state.',
      'Failure → Blocked Error: Cleanup failures (e.g., permission errors, locked files) route the ticket to Blocked Error. Retry will re-attempt the cleanup.',
    ],
    notes: [
      'Context available: Ticket Details + Beads Plan.',
      'Cleanup is conservative — when in doubt, resources are preserved rather than deleted.',
      'The cleanup phase is automatic and does not require user interaction.',
    ],
  },
  COMPLETED: {
    overview: 'The ticket has finished its full workflow lifecycle and is now closed as a successful terminal state. All planning, execution, PR, testing, and cleanup artifacts remain accessible for review. The ticket records whether it completed via a merged PR or as a closed-unmerged finish while preserving the full implementation history.',
    steps: [
      'Terminal Status: LoopTroop marks the ticket status as "completed" after cleanup finishes. This is a final, irreversible state — the ticket cannot be restarted or modified.',
      'Read-Only Workspace: The workspace becomes read-only from a workflow perspective. No further AI phases will run, no artifacts will be modified, and no new planning or execution occurs.',
      'Full History Access: All lifecycle artifacts remain accessible through the navigator and artifact views — interview results, PRD, beads plan, per-bead execution logs, test reports, integration report, and cleanup report. You can review the entire journey from ticket creation to completion.',
    ],
    outputs: [
      'Terminal "completed" status — the successful end state of the workflow.',
      'Full lifecycle history preserved for review: interview, PRD, beads plan, execution logs, test reports, integration report, pull request report, merge report, and cleanup report.',
      'Completion metadata indicating whether the ticket finished as merged or closed unmerged.',
    ],
    transitions: [
      'None — this is a terminal state. There are no forward workflow transitions from Completed.',
    ],
    notes: [
      'Reference artifacts available: ticket details, interview results, PRD, beads plan, test reports, integration report, and pull request report.',
      'The completed ticket serves as a permanent record of the implementation process — useful for understanding decisions, reviewing approaches, or learning from the AI\'s workflow.',
      'The candidate branch is not automatically merged — you decide when and how to merge the implementation into your main branch.',
    ],
  },
  CANCELED: {
    overview: 'The ticket was stopped by user action before normal completion and now sits in a terminal canceled state. By default, all progress and artifacts created up to the cancellation point are preserved. At cancellation time the user may optionally choose to delete AI-generated artifacts (interview results, PRD drafts, beads plan, worktree code) and/or the execution logs.',
    steps: [
      'Cancellation Recording: LoopTroop records the cancellation event, including the phase from which cancellation was triggered, the timestamp, and any active sessions that were terminated.',
      'Active Session Cleanup: If AI sessions were running when cancellation was triggered (e.g., during a council phase or coding), those sessions are terminated gracefully.',
      'Optional Cleanup: If requested at cancellation time, AI-generated artifacts (interview Q&A, PRD drafts, beads plan, worktree code and its git branch) and/or both execution log files may be permanently deleted. Both options are opt-in and unchecked by default.',
      'History Preservation: Unless the user explicitly chose to delete them, all artifacts generated before cancellation (interview results, PRD drafts, beads plans, execution logs) remain accessible through the navigator.',
      'Terminal State: No more planning or execution actions are allowed once cancellation is finalized. The ticket cannot be restarted from the canceled state.',
    ],
    outputs: [
      'Terminal "canceled" status — the workflow has been permanently stopped by user action.',
      'Preserved history up to the cancellation point — all artifacts generated before cancellation remain accessible unless the user chose to delete them at cancellation time.',
      'No additional workflow progress or artifact generation.',
    ],
    transitions: [
      'None — this is a terminal state. There are no forward workflow transitions from Canceled.',
    ],
    notes: [
      'Context available for reference: Ticket Details only (though all artifacts generated before cancellation are preserved in the workspace by default).',
      'Cancellation is available from most phases — you can cancel during planning, approval, execution, or error recovery.',
      'Canceled tickets cannot be restarted. If you want to retry the work, create a new ticket.',
    ],
  },
  BLOCKED_ERROR: {
    overview: 'A blocking failure interrupted the workflow and LoopTroop is waiting for a human decision before it can continue. The error is tied to the specific phase where the failure occurred, and the previous status is preserved so retry knows exactly where to return. You can see the error details, inspect logs around the failing moment, and choose to either retry the failed phase or cancel the ticket entirely.',
    steps: [
      'Error Recording: LoopTroop captures the error message, error codes (if available), the precise timestamp of the failure, and the workflow status where the failure occurred. This information is stored as an error occurrence record.',
      'State Preservation: The blocked error becomes the active workflow state while preserving the previous status (the phase that failed). This preserved status is critical — it tells the retry mechanism exactly which phase to re-enter when you click Retry.',
      'Error History: If a ticket has been blocked multiple times (e.g., retry → fail → retry → fail), all error occurrences are preserved in a history list. This helps you identify recurring issues and decide whether retry is likely to succeed.',
      'Diagnostic Context: The workspace surfaces the relevant failure details — error messages, stack traces, the combined logs around the failing moment, and any bead-specific context (if the failure happened during coding). This gives you enough information to understand what went wrong.',
      'Decision Point: You choose either Retry (which returns the workflow to the previously blocked status and re-attempts the failed operation) or Cancel (which moves the ticket to the terminal Canceled state, preserving all artifacts).',
    ],
    outputs: [
      'Error occurrence history with timestamps, error messages, error codes, and the phase where each failure occurred.',
      'Blocked state metadata linking the error to the specific phase that failed.',
      'Retry or cancel decision point for manual intervention.',
    ],
    transitions: [
      'Retry → Previous Status: Retry returns the workflow to the previously blocked status. The failed phase is re-entered and re-attempted from the beginning of that phase\'s logic.',
      'Cancel → Canceled: Cancel moves the ticket to the terminal Canceled state. Artifacts and error history are preserved by default; the cancellation dialog offers optional cleanup of AI-generated artifacts and/or the execution log.',
    ],
    notes: [
      'Past error occurrences remain reviewable even after the ticket moves on (via retry) or is canceled — the error history is never deleted.',
      'Context available: Current Bead Data (if the failure occurred during the coding phase) + Error Context (error message, codes, phase, timing).',
      'Common causes of blocked errors: model timeouts, API connectivity issues, malformed AI output that fails validation, git operation failures, test failures, and dependency graph violations.',
      'Tip: Before retrying, check the error details. If the error is a transient issue (timeout, connectivity), retry is likely to succeed. If the error indicates a fundamental problem (malformed output, missing configuration), retry may fail again.',
    ],
  },
} satisfies Record<string, WorkflowPhaseDetails>

export const WORKFLOW_GROUPS: WorkflowGroupMeta[] = [
  { id: 'todo', label: 'To Do' },
  { id: 'discovery', label: 'Discovery' },
  { id: 'interview', label: 'Interview' },
  { id: 'prd', label: 'Specs (PRD)' },
  { id: 'beads', label: 'Blueprint (Beads)' },
  { id: 'pre_implementation', label: 'Pre-Implementation' },
  { id: 'implementation', label: 'Implementation' },
  { id: 'post_implementation', label: 'Post-Implementation' },
  { id: 'done', label: 'Done' },
  { id: 'errors', label: 'Errors' },
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
    label: 'Coverage Review',
    description: 'Checking Blueprint Against PRD',
    keys: ['prd', 'beads'],
  },
] as const satisfies readonly WorkflowContextSection[]

const EXPANDING_BEADS_CONTEXT_SECTIONS = [
  {
    label: 'Expansion',
    description: 'Transforming Blueprint into Execution-Ready Beads',
    keys: ['relevant_files', 'ticket_details', 'prd', 'beads_draft'],
  },
] as const satisfies readonly WorkflowContextSection[]

function getSafeResumeDescription(phase: Pick<WorkflowPhaseMeta, 'id' | 'kanbanPhase'>): string {
  if (phase.id === 'DRAFT') {
    return 'No automation is running; browser or server restarts reload the saved ticket fields.'
  }
  if (phase.id === 'CODING') {
    return 'After backend or OpenCode restart, LoopTroop resets any interrupted in-progress bead to its bead start commit, preserves retry notes, and continues from the next runnable bead; if no reset anchor exists, it blocks instead of reusing dirty work.'
  }
  if (phase.id === 'BLOCKED_ERROR') {
    return 'Retry is allowed only when the failed previous status is known from durable state; otherwise the ticket stays blocked for manual review.'
  }
  if (phase.id === 'COMPLETED') {
    return 'This terminal result is read-only and reloads from stored artifacts after any restart.'
  }
  if (phase.id === 'CANCELED') {
    return 'This terminal cancellation is read-only; partial artifacts remain available after restart, but automation does not resume.'
  }
  if (phase.kanbanPhase === 'needs_input') {
    return 'No background model work should be active; browser/frontend restarts reload the saved artifact or UI draft, and backend restarts keep waiting for the same user action.'
  }
  return 'Backend or OpenCode restarts rehydrate the ticket actor and rerun or reconnect this phase from durable artifacts; unrecoverable state moves to Blocked Error.'
}

function withSafeResumeMetadata(phase: WorkflowPhaseMeta): WorkflowPhaseMeta {
  const safeResume = getSafeResumeDescription(phase)
  return {
    ...phase,
    description: `${phase.description} Safe resume: ${safeResume}`,
    details: {
      ...phase.details,
      notes: [...(phase.details.notes ?? []), `Safe resume: ${safeResume}`],
    },
  }
}

const BASE_WORKFLOW_PHASES: WorkflowPhaseMeta[] = [
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
    description: 'The locked main implementer scans the codebase and extracts relevant file paths, excerpts, and rationales. This single-model step produces the shared relevant-files context artifact that every subsequent planning phase draws from.',
    details: WORKFLOW_PHASE_DETAILS.SCANNING_RELEVANT_FILES,
    kanbanPhase: 'in_progress',
    groupId: 'discovery',
    uiView: 'council',
    editable: true,
    multiModelLogs: false,
    contextSummary: ['ticket_details'],
  },
  {
    id: 'COUNCIL_DELIBERATING',
    label: 'Council Drafting Questions',
    description: 'Each council member independently drafts its own interview question strategy in parallel — no model sees another\'s draft, ensuring diverse coverage before the voting round selects the strongest candidate.',
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
    label: 'Voting on Questions',
    description: 'Council members score all anonymized interview drafts against a structured rubric (question relevance, coverage breadth, clarity, and actionability) to select the strongest candidate.',
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
    label: 'Refining Interview',
    description: 'The winning interview draft is normalized into an interactive session: questions get unique IDs, types, and display metadata, and a batch-state snapshot is built for the interview UI.',
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
    description: 'Answer the interview questions that will shape the PRD. Your responses and skip decisions are recorded; if coverage finds gaps after submission, follow-up question batches may bring you back here.',
    details: WORKFLOW_PHASE_DETAILS.WAITING_INTERVIEW_ANSWERS,
    kanbanPhase: 'needs_input',
    groupId: 'interview',
    uiView: 'interview_qa',
    editable: true,
    multiModelLogs: false,
    progressKind: 'questions',
    contextSummary: ['ticket_details'],
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
    description: 'Review and approve the final interview Q&A before PRD drafting starts. Edits are allowed; saving a post-approval edit archives the current version and restarts downstream PRD planning.',
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
    label: 'Council Drafting Specs',
    description: 'Models produce per-model Full Answers artifacts and competing PRD drafts.',
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
    description: 'Council members score all anonymized PRD drafts against a weighted rubric (requirement completeness, acceptance criteria quality, edge-case coverage, test intent clarity) to select the strongest specification baseline.',
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
    description: 'LoopTroop checks the current PRD against the winning model\'s Full Answers artifact. If something is missing, it updates the PRD and checks again.',
    details: WORKFLOW_PHASE_DETAILS.VERIFYING_PRD_COVERAGE,
    kanbanPhase: 'in_progress',
    groupId: 'prd',
    uiView: 'council',
    editable: true,
    multiModelLogs: false,
    contextSummary: ['full_answers', 'prd'],
  },
  {
    id: 'WAITING_PRD_APPROVAL',
    label: 'Approving Specs',
    description: 'Review and approve the PRD candidate before architecture planning starts. The winning Full Answers artifact is available as reference context. Edits are allowed; saving a post-approval edit archives the current version and restarts beads planning.',
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
    label: 'Council Drafting Blueprint',
    description: 'Each council member independently decomposes the approved PRD into a competing semantic beads blueprint — a task graph with descriptions, acceptance criteria, dependencies, and test intent — before voting selects the best candidate.',
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
    label: 'Voting on Blueprint',
    description: 'Council members score all anonymized beads blueprints against an architecture rubric (decomposition quality, feasibility, dependency correctness, and testability) to select the best implementation plan.',
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
    label: 'Refining Blueprint',
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
    description: 'LoopTroop checks the current semantic beads blueprint against the approved PRD. If something is missing, it updates the blueprint and checks again. Once clean or the cap is reached, the workflow advances automatically to the Expanding Blueprint phase.',
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
    id: 'EXPANDING_BEADS',
    label: 'Expanding Blueprint',
    description: 'LoopTroop transforms the coverage-validated semantic blueprint into execution-ready bead records with commands, file targets, dependency graphs, and runtime metadata.',
    details: WORKFLOW_PHASE_DETAILS.EXPANDING_BEADS,
    kanbanPhase: 'in_progress',
    groupId: 'beads',
    uiView: 'council',
    editable: true,
    multiModelLogs: false,
    contextSummary: mergeContextSections(EXPANDING_BEADS_CONTEXT_SECTIONS),
    contextSections: EXPANDING_BEADS_CONTEXT_SECTIONS,
  },
  {
    id: 'WAITING_BEADS_APPROVAL',
    label: 'Approving Blueprint',
    description: 'Review and approve the full execution-ready beads plan — task descriptions, acceptance criteria, dependency chain, and test commands. This is the last human gate before the coding agent begins.',
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
    label: 'Checking Readiness',
    description: 'Validates the execution environment before coding begins: workspace health, coding-agent connectivity, an execution-mode session probe, bead artifact availability, and dependency-graph integrity. No AI context is passed.',
    details: WORKFLOW_PHASE_DETAILS.PRE_FLIGHT_CHECK,
    kanbanPhase: 'in_progress',
    groupId: 'pre_implementation',
    uiView: 'coding',
    editable: true,
    multiModelLogs: false,
    contextSummary: [],
  },
  {
    id: 'WAITING_EXECUTION_SETUP_APPROVAL',
    label: 'Approving Workspace Setup',
    description: 'Review the readiness audit and approve any temporary workspace preparation before execution runs it.',
    details: WORKFLOW_PHASE_DETAILS.WAITING_EXECUTION_SETUP_APPROVAL,
    kanbanPhase: 'needs_input',
    groupId: 'pre_implementation',
    uiView: 'approval',
    editable: true,
    multiModelLogs: false,
    reviewArtifactType: 'execution_setup_plan',
    contextSummary: [],
  },
  {
    id: 'PREPARING_EXECUTION_ENV',
    label: 'Preparing Workspace Runtime',
    description: 'Verifying readiness and performing only the missing temporary execution setup before coding begins.',
    details: WORKFLOW_PHASE_DETAILS.PREPARING_EXECUTION_ENV,
    kanbanPhase: 'in_progress',
    groupId: 'pre_implementation',
    uiView: 'coding',
    editable: false,
    multiModelLogs: false,
    contextSummary: ['ticket_details', 'beads', 'execution_setup_plan', 'execution_setup_notes'],
  },
  {
    id: 'CODING',
    label: 'Implementing (Bead ?/?)',
    description: 'AI coding agent executes beads one at a time; each bead has its own session, context-wipe recovery between iterations, and a git commit after success.',
    details: WORKFLOW_PHASE_DETAILS.CODING,
    kanbanPhase: 'in_progress',
    groupId: 'implementation',
    uiView: 'coding',
    editable: false,
    multiModelLogs: false,
    progressKind: 'beads',
    contextSummary: ['bead_data', 'bead_notes'],
  },
  {
    id: 'RUNNING_FINAL_TEST',
    label: 'Testing Implementation',
    description: 'The main implementer generates a comprehensive test plan from ticket details, PRD, beads, and retry notes, then runs it against the ticket branch to verify the whole implementation holistically — catching integration issues individual bead tests may miss.',
    details: WORKFLOW_PHASE_DETAILS.RUNNING_FINAL_TEST,
    kanbanPhase: 'in_progress',
    groupId: 'post_implementation',
    uiView: 'coding',
    editable: false,
    multiModelLogs: false,
    contextSummary: ['ticket_details', 'prd', 'beads', 'final_test_notes'],
  },
  {
    id: 'INTEGRATING_CHANGES',
    label: 'Preparing Final Commit',
    description: 'Squashes all individual bead commits into one clean candidate commit on the ticket branch, ready for the draft pull request. Per-bead history is preserved in the audit trail.',
    details: WORKFLOW_PHASE_DETAILS.INTEGRATING_CHANGES,
    kanbanPhase: 'in_progress',
    groupId: 'post_implementation',
    uiView: 'coding',
    editable: false,
    multiModelLogs: false,
    contextSummary: ['ticket_details', 'prd', 'beads', 'tests'],
  },
  {
    id: 'CREATING_PULL_REQUEST',
    label: 'Creating Pull Request',
    description: 'Pushing the final candidate branch and drafting the PR from ticket details, PRD, final reports, and git diff sections in a fresh owned session.',
    details: WORKFLOW_PHASE_DETAILS.CREATING_PULL_REQUEST,
    kanbanPhase: 'in_progress',
    groupId: 'post_implementation',
    uiView: 'coding',
    editable: false,
    multiModelLogs: false,
    contextSummary: ['ticket_details', 'prd'],
  },
  {
    id: 'WAITING_PR_REVIEW',
    label: 'Reviewing Pull Request',
    description: 'Review the draft pull request on GitHub, then choose Merge PR & Finish or Finish Without Merge. Either path closes the ticket successfully and proceeds to cleanup.',
    details: WORKFLOW_PHASE_DETAILS.WAITING_PR_REVIEW,
    kanbanPhase: 'needs_input',
    groupId: 'post_implementation',
    uiView: 'coding',
    editable: false,
    multiModelLogs: false,
    contextSummary: ['ticket_details', 'interview', 'prd', 'beads', 'tests'],
  },
  {
    id: 'CLEANING_ENV',
    label: 'Cleaning Up',
    description: 'Removes transient runtime resources (lock files, session folders, temp files) while preserving permanent artifacts (interview, PRD, beads, logs, test and integration reports) for long-term review and audit.',
    details: WORKFLOW_PHASE_DETAILS.CLEANING_ENV,
    kanbanPhase: 'in_progress',
    groupId: 'post_implementation',
    uiView: 'coding',
    editable: false,
    multiModelLogs: false,
    contextSummary: ['ticket_details', 'beads'],
  },
  {
    id: 'COMPLETED',
    label: 'Done',
    description: 'The workflow reached its successful terminal state. All planning, execution, PR, and cleanup artifacts remain accessible. The ticket records whether it closed as a merged PR or finished without merge.',
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
    description: 'Ticket canceled by user action. Artifacts are preserved by default; optional cleanup is available at cancellation time.',
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
    description: 'A phase failure paused the workflow. The failed phase is preserved so Retry re-enters it with full context. Inspect the error details and logs, then choose Retry or Cancel.',
    details: WORKFLOW_PHASE_DETAILS.BLOCKED_ERROR,
    kanbanPhase: 'needs_input',
    groupId: 'errors',
    uiView: 'error',
    editable: false,
    multiModelLogs: false,
    contextSummary: ['bead_data', 'error_context'],
  },
]

export const WORKFLOW_PHASES: WorkflowPhaseMeta[] = BASE_WORKFLOW_PHASES.map(withSafeResumeMetadata)

export const WORKFLOW_PHASE_IDS = WORKFLOW_PHASES.map((phase) => phase.id)

export const WORKFLOW_PHASE_MAP = Object.fromEntries(
  WORKFLOW_PHASES.map((phase) => [phase.id, phase]),
) as Record<string, WorkflowPhaseMeta>

export function getWorkflowPhaseMeta(status: string): WorkflowPhaseMeta | undefined {
  return WORKFLOW_PHASE_MAP[status]
}

export type WorkflowAction = 'start' | 'approve' | 'cancel' | 'retry' | 'merge' | 'close_unmerged'

export function isBeforeExecution(status: string, previousStatus?: string | null): boolean {
  if (status === 'BLOCKED_ERROR' && previousStatus) {
    return isBeforeExecution(previousStatus)
  }
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
    case 'WAITING_EXECUTION_SETUP_APPROVAL':
      return ['approve', 'cancel']
    case 'WAITING_PR_REVIEW':
      return ['merge', 'close_unmerged', 'cancel']
    case 'BLOCKED_ERROR':
      return ['retry', 'cancel']
    case 'COMPLETED':
    case 'CANCELED':
      return []
    default:
      return ['cancel']
  }
}
