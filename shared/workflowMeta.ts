export type KanbanPhase = 'todo' | 'in_progress' | 'needs_input' | 'done'
type WorkflowGroupId = 'todo' | 'interview' | 'prd' | 'beads' | 'execution' | 'done'
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
      'Logging: Phase logs capture the full session lifecycle — prompt dispatch timing, model response, any retry attempts, validation results, and the final extracted file count.',
    ],
    outputs: [
      'Canonical `relevant-files.yaml` inside the ticket workspace — this becomes a shared context artifact that interview, PRD, and beads phases all receive as part of their input context.',
      'Structured scan artifact containing file paths, content previews, relevance levels (high/medium/low), and natural-language rationales for each identified file.',
      'Phase logs with session lifecycle, prompt dispatch, retry history, and diagnostics.',
    ],
    transitions: [
      'Success → AI Council Thinking: A valid scan artifact advances the ticket to the council deliberation phase where multiple models begin drafting interview questions.',
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
      'Per-model draft progress and session logs viewable in the phase log panel (you can see exactly what each model produced).',
      'Persisted council draft artifacts that will be anonymized and presented to voters in the next phase.',
    ],
    transitions: [
      'Quorum Met → Selecting Best Questions: When enough valid drafts are complete (meeting the configured quorum threshold), the workflow advances to the voting phase where the council scores each draft.',
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
      'This is the "multi-model drafting" step of the Interview phase. The same pattern repeats in the Specs (PRD) phase as "Drafting Specs" (where council members independently write competing PRD documents from the approved interview) and in the Blueprint (Beads) phase as "Architecting Beads" (where council members independently propose competing task decompositions from the approved PRD).',
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
      'Winner Selected → Preparing Interview: A successful winner selection advances the workflow to the compilation phase where the winning draft is normalized into the interactive interview format.',
      'Voting Failure → Blocked Error: Invalid vote structure, malformed model responses, quorum collapse (not enough valid votes), or unresolvable ties route the ticket to Blocked Error.',
    ],
    notes: [
      'Anonymization and randomized ordering are both designed to reduce bias — models cannot identify their own draft and cannot benefit from a favorable presentation position.',
      'Context available: Relevant Files + Ticket Details + Competing Drafts (all anonymized).',
      'The voting rubric is consistent across all council members to ensure scores are comparable.',
      'Why vote instead of just picking one? Voting aggregates multiple perspectives on quality. A draft that impresses all council members is more likely to be genuinely strong than one that a single model happened to prefer.',
    ],
    equivalents: [
      'This is the "council voting" step of the Interview phase. The same pattern repeats in the Specs (PRD) phase as "Voting on Specs" (where the council scores competing PRD drafts using a PRD-specific rubric) and in the Blueprint (Beads) phase as "Voting on Architecture" (where the council scores competing beads blueprints using an architecture rubric).',
      'All three voting phases share the same mechanics: anonymization → randomized presentation → independent scoring → vote resolution → winner selection. The difference is the scoring rubric used: interview voting evaluates question relevance and coverage; PRD voting evaluates requirement completeness and acceptance criteria quality; beads voting evaluates decomposition quality and dependency correctness.',
    ],
  },
  COMPILING_INTERVIEW: {
    overview: 'LoopTroop turns the winning interview draft into the normalized, interactive interview session that you will actually answer. This is a single-model phase using the winning model from the vote. The compilation step standardizes question formats, sets up batch state tracking, and produces the UI-ready interview artifact that the interview screen renders.',
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
      'The compilation is done by the winning model (from the vote), not the main implementer or all council members.',
      'Context available: Relevant Files + Ticket Details + Competing Drafts (used for reference during normalization).',
      'The session snapshot is designed to support multiple interview rounds — if coverage later adds follow-up questions, the same snapshot structure accommodates them.',
    ],
    equivalents: [
      'This is the "refinement/compilation" step of the Interview phase. The same pattern repeats in the Specs (PRD) phase as "Refining Specs" (where the winning PRD draft is enhanced with ideas from losing drafts) and in the Blueprint (Beads) phase as "Finalizing Plan" (where the winning blueprint is enhanced with ideas from losing blueprints).',
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
      'Skip All: You can skip all remaining unanswered questions at once. This finalizes the current answers, marks everything else as skipped, and lets the coverage check decide whether the interview is sufficient to proceed.',
    ],
    outputs: [
      'Recorded user answers and skip decisions persisted into the interview session snapshot.',
      'Updated canonical interview YAML artifact reflecting the current state of all questions.',
      'Question history grouped across initial and follow-up rounds, preserving the full interaction timeline.',
    ],
    transitions: [
      'Submit/Skip → Coverage Check (Interview): Submitting or skipping the active batch moves the workflow to the interview coverage check, which evaluates whether enough information has been gathered.',
      'Coverage Follow-Up → Back Here: If coverage identifies gaps, the workflow returns to this phase with additional targeted follow-up questions for you to answer.',
      'Skip All → Coverage Check (Interview): Finalizes all remaining unanswered questions as skipped, then advances to coverage check.',
    ],
    notes: [
      'This is a user-input phase — the workflow is intentionally paused. No AI models are running while you answer questions.',
      'This phase may appear multiple times in the lifecycle if coverage generates follow-up rounds — each round is a new batch of targeted questions.',
      'Context available: Relevant Files + Ticket Details + Interview Results + User Answers.',
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
      'Coverage History: Every coverage attempt (whether clean or gap-found) is persisted as a coverage history artifact, capturing the response, parsed result, follow-up budget usage, any structural repair metadata, and timestamps.',
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
      'This is the "coverage check" step of the Interview phase. The same pattern repeats in the Specs (PRD) phase as "Coverage Check (PRD)" (where the PRD is checked against the approved interview) and in the Blueprint (Beads) phase as "Coverage Check (Beads)" (where the beads blueprint is checked against the approved PRD).',
      'All three coverage checks share the goal of verifying completeness, but they differ in how gaps are resolved: Interview coverage sends you back to answer follow-up questions (user-facing loop). PRD coverage revises the document automatically within the same phase (AI-internal loop, up to 3 versions). Beads coverage also revises automatically, then performs a final expansion step to produce execution-ready bead records.',
      'Each coverage check has a budget or cap to ensure convergence — interview has a follow-up round budget, PRD has a 3-version cap, and beads has its own coverage cap plus the expansion step.',
    ],
  },
  WAITING_INTERVIEW_APPROVAL: {
    overview: 'The interview is ready for human review and approval. This is a user-input gate — no AI work proceeds until you explicitly approve. You can inspect the full interview results (questions, answers, and skip decisions), make edits to answers or the raw YAML representation, and only approve when you are satisfied that the interview captures your intent correctly. The approved interview becomes the authoritative source material that drives PRD generation.',
    steps: [
      'Review Interface: LoopTroop exposes the canonical interview in two modes — a structured view showing questions and answers in a readable format, and a raw YAML editing view for direct text manipulation. You can switch between these views freely.',
      'Editing Answers: You can adjust any answer text, change skip decisions, or modify the raw YAML directly. The UI maintains temporary unsaved draft state between view switches so your edits are not lost when toggling between structured and raw modes.',
      'Saving Changes: Saving writes the updated interview artifact back to the ticket workspace and refreshes all relevant caches. The saved version replaces the previous canonical interview.',
      'Approval Decision: Approving locks in the current interview results as the authoritative source material for PRD drafting. Once approved, the interview answers become the ground truth that the PRD council uses to generate specifications.',
      'Post-Approval Editing: If you navigate back to the interview after approval and make edits, LoopTroop will display a cascade warning explaining that changes will trigger regeneration of the PRD and potentially the beads plan — because those downstream artifacts were generated based on the original approved interview.',
    ],
    outputs: [
      'Approved interview artifact — the finalized, authoritative version of interview questions and answers.',
      'User-edited replacement (if edits were made before approval).',
      'Optional persisted UI draft state for in-progress edits.',
      'A locked interview baseline that the PRD council treats as ground truth.',
    ],
    transitions: [
      'Approve → Drafting Specs: Approval advances the workflow to PRD drafting, where multiple council models independently generate specification documents based on your approved interview answers.',
      'Cancel → Canceled: Cancellation moves the ticket to the terminal Canceled state.',
    ],
    notes: [
      'This is the review artifact gate for the interview phase — it ensures a human has signed off before expensive PRD generation begins.',
      'No AI context is passed in this phase — it is entirely user-driven. The AI does not see or process anything during approval.',
      'Tip: Review skipped questions carefully. Skipped questions will have AI-generated answers filled in during PRD drafting. If you have opinions about those topics, it is better to provide real answers now than to rely on AI guesses later.',
      'Tip: This is your last easy chance to influence the interview before it feeds into the PRD. Editing after approval is possible but triggers cascade regeneration of downstream artifacts.',
    ],
    equivalents: [
      'This is the "approval gate" of the Interview phase. The same pattern repeats in the Specs (PRD) phase as "Approving Specs" (where you review and approve the PRD before beads planning) and in the Blueprint (Beads) phase as "Approving Blueprint" (where you review and approve the execution plan before coding starts).',
      'All three approval gates share the same mechanics: human review → optional editing → explicit approval to advance. Each gate controls what feeds into the next major phase: approved interview → PRD drafting, approved PRD → beads drafting, approved beads → coding execution.',
      'Post-approval edits trigger cascade warnings in all three cases — because downstream artifacts were built on the approved version and would need regeneration.',
    ],
  },
  DRAFTING_PRD: {
    overview: 'The PRD council produces competing specification drafts from the approved interview, relevant files, and ticket context. This is a 2-part phase: Part 1 fills in any skipped interview answers with AI-generated responses so the council has a complete working basis, and Part 2 uses the complete answer set to generate full PRD drafts. Each council member independently produces their own PRD — they do not collaborate or see each other\'s work.',
    steps: [
      'Part 1 — Answering Skipped Questions: LoopTroop loads the relevant files, ticket details, and interview results (including which questions were answered vs. skipped). For each skipped question, the model generates a reasonable full answer based on the available context. The result is a "Full Answers" artifact where every question has a response — either the user\'s original answer or an AI-generated fill-in.',
      'Why Fill Skipped Answers? The PRD council needs a complete picture to write thorough specifications. Rather than forcing each council member to independently guess answers to skipped questions (leading to inconsistency), LoopTroop produces a single consistent set of full answers that all council members share.',
      'Part 2 — Generating PRD Drafts: LoopTroop loads the relevant files, ticket details, and the full answers artifact (including AI-filled responses). Each council model independently produces a complete PRD candidate rather than editing a shared draft. This independence ensures diverse specification approaches.',
      'PRD Content Structure: Each draft follows a consistent structure containing requirements (what the system should do), acceptance criteria (how to verify it works), edge cases (unusual situations to handle), test intent (what should be tested and how), and implementation guidance (suggested approach and constraints).',
      'Output Normalization: LoopTroop normalizes draft output to ensure consistent structure, records draft metrics (requirement count, acceptance criteria count, edge case count), logs structured-output diagnostics, and persists the draft artifacts for the upcoming voting phase.',
    ],
    outputs: [
      'Full Answers artifact — the complete interview with AI-generated responses filling in skipped questions (produced in Part 1).',
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
      'The Full Answers artifact from Part 1 is reused by all council members in Part 2, ensuring consistency in how skipped questions are handled.',
    ],
    equivalents: [
      'This is the "multi-model drafting" step of the Specs (PRD) phase. The equivalent in the Interview phase is "AI Council Thinking" (where council members independently draft competing interview questions) and in the Blueprint (Beads) phase is "Architecting Beads" (where council members independently propose competing task decompositions).',
      'Unlike the Interview drafting phase, PRD drafting has a 2-part structure: Part 1 fills in skipped interview answers first, then Part 2 generates actual PRD drafts. This extra step ensures all council members work from the same complete answer set. The Interview and Beads drafting phases are single-part.',
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
      'This is the "council voting" step of the Specs (PRD) phase. The equivalent in the Interview phase is "Selecting Best Questions" (where the council votes on competing interview drafts) and in the Blueprint (Beads) phase is "Voting on Architecture" (where the council votes on competing beads blueprints).',
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
      'Candidate Promotion: The resulting document becomes PRD Candidate v1 — the first versioned candidate that enters the coverage verification loop. This is not yet the final PRD; coverage may produce additional versions (up to v3) before approval.',
    ],
    outputs: [
      'Refined PRD candidate artifact (PRD Candidate v1) — the winning draft enhanced with the best elements from losing drafts.',
      'Optional refinement diff metadata showing what was added or changed during the refinement process.',
      'Normalized PRD content ready for the coverage verification loop.',
    ],
    transitions: [
      'Success → Coverage Check (PRD): A valid refined candidate advances to the PRD coverage check, which verifies the PRD against the approved interview answers.',
      'Failure → Blocked Error: Refinement validation failures, malformed output, or model errors route the ticket to Blocked Error.',
    ],
    notes: [
      'The refinement is done by the winning model (from the vote), ensuring the refiner understands the winning approach and can merge additions coherently.',
      'Context available: Relevant Files + Ticket Details + Full Answers + Competing Drafts (the winner is labeled, losers are provided for mining improvements).',
      'PRD Candidate v1 is a versioned identifier — coverage may produce v2 or v3 if gaps are found and revisions are needed.',
      'Why refine? The winning draft scored highest overall, but losing drafts often contain individual insights that the winner lacks. Refinement captures those insights without losing the winning structure.',
    ],
    equivalents: [
      'This is the "refinement" step of the Specs (PRD) phase. The equivalent in the Interview phase is "Preparing Interview" (where the winning interview draft is compiled into the interactive format) and in the Blueprint (Beads) phase is "Finalizing Plan" (where the winning blueprint is enhanced with ideas from losing blueprints).',
      'PRD and Beads refinement are very similar — both merge improvements from losing drafts into the winner. Interview compilation differs slightly because it also transforms the format (from a raw draft into a normalized, interactive session structure), but the core idea is the same: take the winning output and strengthen it.',
    ],
  },
  VERIFYING_PRD_COVERAGE: {
    overview: 'LoopTroop runs a versioned PRD coverage loop, comparing the current PRD candidate against the approved interview answers to find any missing requirements or gaps. Unlike the interview coverage loop (which sends you back to answer more questions), PRD coverage stays inside this same phase — the model revises the PRD directly when gaps are found. The loop can produce up to PRD Candidate v3, and if gaps remain after the cap, the latest version still advances to approval with warnings.',
    steps: [
      'Coverage Evaluation: The winning PRD model compares the current PRD candidate against the approved interview and full answers. It returns a structured coverage result: either "clean" (the PRD fully covers the interview) or "gaps found" (specific requirements or acceptance criteria are missing or incomplete).',
      'Gap Details: When gaps are found, the coverage result includes specific descriptions of what is missing, which interview answers are not reflected in the PRD, and why the gap matters for implementation correctness.',
      'In-Phase Revision: If gaps are found and the coverage cap has not been reached, LoopTroop asks the model to produce a revised PRD that addresses the identified gaps. The revised candidate is validated and promoted to the next version number (e.g., v1 → v2 → v3) within the same phase.',
      'Version History: Coverage attempts and version transitions are persisted, so you can see what changed between PRD versions and why. Each attempt records the coverage result, identified gaps, revision actions, and the resulting candidate version.',
      'Clean Finalization: If the PRD becomes clean (all gaps resolved), the clean result is recorded and the current candidate becomes the approval candidate with a clean status.',
      'Cap Enforcement: If the fixed PRD coverage cap is reached (maximum 3 versions), LoopTroop advances using the latest candidate even if minor gaps remain. The unresolved-gap history is preserved and visible during approval so you can address any remaining issues manually.',
    ],
    outputs: [
      'Versioned PRD coverage attempts and transition history — showing the journey from Candidate v1 through any revisions.',
      'Latest PRD candidate after zero or more coverage revisions.',
      'Structured diagnostics about repair attempts, retries, identified gaps, and whether they were resolved.',
    ],
    transitions: [
      'Clean → Approving Specs: A clean candidate (no remaining gaps) advances to the PRD approval gate.',
      'Cap Reached → Approving Specs: If the coverage cap is hit, the latest candidate advances to approval with warnings about unresolved gaps preserved for your review.',
      'Failure → Blocked Error: Coverage execution failures, model errors, or revision validation problems route the ticket to Blocked Error.',
    ],
    notes: [
      'Unlike the interview loop (which bounces back to the user for more answers), PRD gap resolution stays inside this same phase — the model revises the PRD directly.',
      'The maximum number of coverage versions is fixed at 3 (v1, v2, v3) to ensure convergence.',
      'Context available: Interview Results + Full Answers + PRD (current candidate version).',
      'Why cap at 3 versions? Diminishing returns: most meaningful gaps are caught in the first revision. The cap prevents the loop from endlessly polishing minor details while delaying your approval review.',
    ],
    equivalents: [
      'This is the "coverage check" step of the Specs (PRD) phase. The equivalent in the Interview phase is "Coverage Check (Interview)" (where the interview is checked for missing information) and in the Blueprint (Beads) phase is "Coverage Check (Beads)" (where the beads blueprint is checked against the approved PRD).',
      'Key difference from Interview coverage: PRD coverage resolves gaps automatically (the model revises the PRD within this same phase) rather than sending you back for more user input. Key difference from Beads coverage: Beads coverage includes a final expansion step that transforms the semantic blueprint into execution-ready bead records — PRD coverage does not have an equivalent expansion.',
      'What is being verified against what: Interview coverage checks interview answers against the ticket description. PRD coverage checks the PRD against the approved interview. Beads coverage checks the beads blueprint against the approved PRD. Each layer verifies against the previous approved artifact.',
    ],
  },
  WAITING_PRD_APPROVAL: {
    overview: 'The latest PRD candidate is ready for human review and approval before architecture planning starts. This is a user-input gate — no AI work proceeds until you explicitly approve. You can review the specification in structured or raw form, edit any section, and check whether coverage warnings exist from the coverage loop. The approved PRD becomes the authoritative input that drives beads (implementation task) planning.',
    steps: [
      'Review Interface: LoopTroop renders the PRD in two modes — a structured view showing requirements, acceptance criteria, edge cases, and test intent in a readable format, and a raw YAML editing view for direct manipulation. You can switch freely between views.',
      'Coverage Warnings: If the latest PRD candidate reached approval after exhausting the coverage loop cap (rather than achieving a fully clean status), coverage warnings are displayed prominently. These warnings describe any unresolved gaps so you can decide whether to address them manually before approving.',
      'Editing: You can edit any section of the PRD — add requirements, refine acceptance criteria, adjust edge cases, or rewrite test intent. The UI preserves temporary draft state between view switches. Saving writes the updated PRD artifact back to the ticket workspace.',
      'Approval Decision: Approving confirms the current PRD as the authoritative specification for beads drafting. The beads council will decompose this approved PRD into implementable tasks.',
      'Post-Approval Cascade: If you navigate back to the PRD after approval and make edits, LoopTroop displays a cascade warning. Editing the PRD at this point will restart the beads phase — all previously generated beads data will be lost and regenerated from the updated PRD.',
    ],
    outputs: [
      'Approved PRD artifact — the finalized, authoritative specification for the implementation.',
      'User-edited replacement (if edits were made before approval).',
      'Optional UI draft state for in-progress structured and raw edits.',
      'A locked PRD baseline that the beads council uses as its primary input.',
    ],
    transitions: [
      'Approve → Architecting Beads: Approval advances the workflow to the beads drafting phase, where multiple council models independently decompose the PRD into implementable task blueprints.',
      'Cancel → Canceled: Cancellation moves the ticket to the terminal Canceled state.',
    ],
    notes: [
      'This is the review artifact gate for the PRD phase — it ensures a human has signed off on the specification before expensive architecture planning begins.',
      'No AI context is passed in this phase — it is entirely user-driven. The AI does not see or process anything during approval.',
      'Tip: Pay special attention to acceptance criteria — they directly determine how the AI will verify its own implementation during the coding phase.',
      'Tip: If coverage warnings exist, read the unresolved gaps carefully. Minor gaps may be acceptable, but gaps in core requirements could lead to an incomplete implementation.',
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
      'Quorum Met → Voting on Architecture: When enough valid blueprints are complete (meeting quorum), the workflow advances to the beads voting phase.',
      'Quorum Failure → Blocked Error: Drafting failures, insufficient valid blueprints for quorum, or model timeouts route the ticket to Blocked Error.',
    ],
    notes: [
      'Context available: Relevant Files + Ticket Details + PRD.',
      'Blueprints at this stage are semantic — they describe tasks conceptually without execution-specific fields like shell commands or exact file paths. Those are added later during the expansion step.',
      'Why independent drafting? Different models may identify different natural task boundaries. Voting on competing blueprints helps select the most logical and implementable decomposition.',
    ],
    equivalents: [
      'This is the "multi-model drafting" step of the Blueprint (Beads) phase. The equivalent in the Interview phase is "AI Council Thinking" (where council members draft competing interview questions) and in the Specs (PRD) phase is "Drafting Specs" (where council members draft competing PRD documents).',
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
      'Winner Selected → Finalizing Plan: A successful winner selection advances the workflow to the refinement phase, where the winner is enhanced with the best ideas from losing blueprints.',
      'Voting Failure → Blocked Error: Invalid votes, quorum collapse, or unresolvable errors route the ticket to Blocked Error.',
    ],
    notes: [
      'Context available: Relevant Files + Ticket Details + PRD + Competing Drafts (all anonymized).',
      'The architecture rubric differs from the PRD and interview rubrics — it focuses on implementation feasibility and dependency structure rather than requirement coverage.',
      'The winning blueprint is not the final plan — it still goes through refinement, coverage checking, and expansion before becoming execution-ready beads.',
    ],
    equivalents: [
      'This is the "council voting" step of the Blueprint (Beads) phase. The equivalent in the Interview phase is "Selecting Best Questions" (where the council votes on competing interview drafts) and in the Specs (PRD) phase is "Voting on Specs" (where the council votes on competing PRD drafts).',
      'The architecture rubric used here is the most technically focused of the three voting rubrics: it evaluates decomposition quality, feasibility, dependency correctness, and testability. By contrast, interview voting evaluates question relevance and coverage, while PRD voting evaluates requirement completeness and acceptance criteria quality.',
    ],
  },
  REFINING_BEADS: {
    overview: 'The winning beads blueprint stays the backbone while LoopTroop pulls in stronger tasks, tests, constraints, and edge cases from the losing blueprints. The refined output remains a semantic plan — execution-specific fields (shell commands, exact file paths, runtime configuration) are added later during the expansion step in the coverage phase.',
    steps: [
      'Context Assembly: The winning model receives its own winning blueprint plus all losing blueprints, clearly labeled. The prompt instructs it to preserve the winning structure while selectively merging improvements from the losers.',
      'Selective Merging: The model reviews each losing blueprint for tasks, acceptance criteria, edge cases, or dependency insights that are present in the loser but absent from the winner. It incorporates these improvements without duplicating content, breaking the dependency graph, or fundamentally restructuring the winning blueprint.',
      'Output Normalization: LoopTroop normalizes the refinement output, validates the bead structure and dependency graph integrity, and stores the refined candidate. Attribution metadata is preserved where possible so you can see which improvements came from which losing blueprint.',
      'UI Diff Artifacts: Diff artifacts are generated showing what changed between the original winning blueprint and the refined version, helping you understand the refinement impact during later review.',
      'Semantic Preservation: The refined candidate is intentionally kept at the semantic level — task descriptions, acceptance criteria, and dependency declarations, but no execution commands or runtime paths. The expansion step (in the next phase) handles that transformation.',
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
      'This phase still works on the semantic plan, not execution-ready bead records. Execution fields are added in the next phase\'s expansion step.',
      'Context available: Relevant Files + Ticket Details + PRD + Competing Drafts.',
      'Why refine before expansion? Semantic-level refinement is cheaper and more flexible. It is easier to add or modify task descriptions than to redo execution-specific fields after expansion.',
    ],
    equivalents: [
      'This is the "refinement" step of the Blueprint (Beads) phase. The equivalent in the Interview phase is "Preparing Interview" (where the winning interview draft is compiled into the interactive format) and in the Specs (PRD) phase is "Refining Specs" (where the winning PRD draft is enhanced with ideas from losing drafts).',
      'Beads refinement is very similar to PRD refinement — both merge improvements from losing drafts. The key difference is that beads refinement stays at the semantic level (task descriptions and acceptance criteria) because the execution-ready fields (commands, file paths) are added later during the expansion step in the next phase. PRD refinement produces the near-final document directly.',
    ],
  },
  VERIFYING_BEADS_COVERAGE: {
    overview: 'LoopTroop verifies the semantic beads blueprint against the approved PRD, revises it until acceptable, and then expands the final blueprint into execution-ready bead records. This is a 2-part phase: Part 1 is the coverage review loop (checking and revising the semantic blueprint against the PRD), and Part 2 is the final expansion step that transforms the validated semantic blueprint into execution-ready bead data with commands, file targets, and dependency graphs.',
    steps: [
      'Part 1 — Coverage Review: The winning beads model compares the current semantic blueprint against the PRD and returns a structured clean-or-gaps result. "Clean" means every PRD requirement is covered by at least one bead. "Gaps" means specific requirements lack corresponding beads or have insufficient acceptance criteria.',
      'Part 1 — Gap Resolution: If gaps are found, LoopTroop records the coverage attempt, requests a targeted revision that adds the missing beads or strengthens existing acceptance criteria, validates the revision, and promotes the next blueprint version. This loop can repeat until clean or until the fixed beads coverage cap is reached.',
      'Part 1 — Version Tracking: Each coverage attempt and revision is persisted as coverage history, so you can see the evolution from the initial blueprint through each revision and understand what changed at each step.',
      'Part 2 — Final Expansion: Once the blueprint is clean (or the cap is reached), LoopTroop runs the expansion step. This transforms the semantic blueprint (task descriptions, acceptance criteria) into execution-ready bead records. Expansion adds fields like shell commands to run, file paths to create or modify, expected test commands, dependency graph with topological ordering, and runtime metadata.',
      'Part 2 — Expansion Output: The expanded bead data becomes the actual execution plan that the coding agent will consume bead-by-bead. Each bead record includes everything the coding agent needs to implement that task without additional context about the overall plan.',
      'Part 2 — Approval Candidate: The expanded output is persisted and becomes the approval candidate shown in the beads approval UI, where you can review the full execution plan before coding starts.',
    ],
    outputs: [
      'Versioned beads coverage history showing each coverage evaluation and revision.',
      'Latest refined semantic blueprint (after coverage revisions).',
      'Expanded execution-ready beads data with commands, file targets, dependency graphs, and runtime metadata (produced in Part 2).',
      'Approval candidate artifact for the beads approval UI.',
    ],
    transitions: [
      'After Expansion → Approving Blueprint: After the expansion step completes, the workflow advances to beads approval where you review the execution plan.',
      'Coverage or Expansion Failure → Blocked Error: Coverage evaluation errors, revision validation failures, expansion errors, or model timeouts route the ticket to Blocked Error.',
    ],
    notes: [
      'This is the only planning phase that ends with an explicit semantic-to-execution expansion step — all other phases work at the semantic level only.',
      'This phase has 2 internal parts with different context inputs: Part 1 receives PRD + Beads (semantic blueprint); Part 2 receives Relevant Files + Ticket Details + PRD + Semantic Blueprint (beads_draft).',
      'The beads coverage cap ensures convergence — the loop cannot run indefinitely.',
      'Why expand separately? Expansion is expensive and adds execution-specific detail. By doing coverage at the semantic level first, LoopTroop avoids wasting expansion effort on a blueprint that would need revision.',
    ],
    equivalents: [
      'This is the "coverage check" step of the Blueprint (Beads) phase. The equivalent in the Interview phase is "Coverage Check (Interview)" (where the interview is checked for missing information) and in the Specs (PRD) phase is "Coverage Check (PRD)" (where the PRD is checked against the approved interview).',
      'Beads coverage is the most complex of the three coverage checks because it has a 2-part structure: Part 1 is the standard coverage loop (similar to PRD coverage — automatic revisions within the same phase), and Part 2 is the unique "expansion" step that transforms the semantic blueprint into execution-ready bead records with commands, file targets, and dependency graphs. Neither Interview nor PRD coverage has an equivalent expansion step.',
      'What is being verified against what: Interview coverage checks answers against the ticket. PRD coverage checks the PRD against the approved interview. Beads coverage checks the blueprint against the approved PRD. This creates a chain of verification where each artifact is validated against its predecessor.',
    ],
  },
  WAITING_BEADS_APPROVAL: {
    overview: 'The final expanded beads plan is ready for human review before any coding begins. This is the last user-input gate before execution starts — once you approve, the coding agent will begin implementing beads one by one. You can review the full execution plan including task descriptions, dependencies, acceptance criteria, and test commands, and edit the plan if needed.',
    steps: [
      'Execution Plan Review: LoopTroop shows the execution-ready beads breakdown, including each bead\'s description, acceptance criteria, dependency chain, file targets, test commands, and execution ordering. You can see exactly what the coding agent will do and in what order.',
      'Dependency Visualization: The beads are shown with their dependency relationships, so you can verify that the execution order makes sense — beads that depend on other beads will not run until their dependencies complete.',
      'Editing: You can review the plan in structured form or edit the raw representation before approving. Changes are saved back to the beads artifact.',
      'Coverage Warnings: If the beads plan reached approval after exhausting the coverage loop cap (rather than achieving a fully clean status), coverage warnings are displayed. These describe any PRD requirements that may not have corresponding beads.',
      'Approval Decision: Approval confirms the execution plan that the coding loop will consume bead-by-bead. After approval, the coding agent receives individual bead specifications — it does not see the full plan, only the bead it is currently implementing.',
    ],
    outputs: [
      'Approved execution-ready beads plan — the authoritative task breakdown the coding agent will follow.',
      'User-edited replacement (if edits were made before approval).',
      'Saved approval editor state for in-progress reviews.',
      'The authoritative bead set consumed by pre-flight checks and the coding loop.',
    ],
    transitions: [
      'Approve → Initializing Agent: Approval advances the workflow to pre-flight checks, which validate that the execution environment is ready before the first bead runs.',
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
      'All Checks Pass → Approve Workspace Setup: The workflow advances to the setup-plan approval gate, which audits workspace readiness and drafts only any missing temporary setup before anything mutates the worktree.',
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
      'Regenerate With Commentary: If the initial assessment or plan is close but not correct, you can send commentary describing what should change. LoopTroop will regenerate the draft in the same approval state, reusing the active planning session when possible so the revision stays grounded in the previous attempt.',
      'Approval Handoff: Once approved, this plan becomes the primary execution contract for the next phase. The execution-setup agent must respect the approved readiness assessment and start from the approved plan rather than rediscovering workspace initialization from scratch.',
    ],
    outputs: [
      'Editable `execution_setup_plan` artifact containing the readiness assessment, any proposed temporary environment-setup steps, user-facing diagnostics, and regenerate commentary history.',
      'Underlying plan-generation report and notes artifacts retained for workflow context, auditability, and regenerate continuity.',
      'Approval receipt confirming the reviewed setup plan was explicitly approved before execution setup begins.',
    ],
    transitions: [
      'Approve → Preparing Workspace Runtime: The workflow advances to the execution setup phase, which verifies the approved readiness assessment, performs only the missing temporary setup, and writes the reusable runtime profile.',
      'Regenerate → Stays Here: Regeneration replaces the current setup-plan draft while remaining in the same approval state for another review pass.',
      'Generation Failure → Blocked Error: If LoopTroop cannot produce a valid setup-plan artifact, the ticket routes to Blocked Error with the plan report preserved for diagnosis.',
    ],
    notes: [
      'This state is still pre-coding. No permanent repository files should be modified here.',
      'No AI execution proceeds past this gate until you approve the proposed setup plan.',
      'The approved setup plan is separate from the final execution setup profile. The profile is produced only after the next phase verifies readiness and runs any approved temporary setup inside LoopTroop-owned runtime paths.',
    ],
  },
  PREPARING_EXECUTION_ENV: {
    overview: 'LoopTroop runs a dedicated execution setup phase after the setup-plan approval gate and before coding. This is an AI-driven, retryable, temporary-only phase whose job is to verify the approved readiness assessment, perform only the missing temporary setup under LoopTroop-owned runtime paths, and persist a compact setup profile for later beads to consume. When the approved plan says the environment is already ready, this phase should stay effectively no-op aside from verification and profile emission.',
    steps: [
      'Approved Plan First: The locked main implementer reads the approved setup-plan artifact first, then loads the supporting planning context — ticket details, relevant files, PRD, beads plan, any prior reusable setup profile, and any prior setup retry notes. User edits in the approved plan take precedence over the model\'s original draft.',
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
      'Coding consumes the compact setup profile rather than full setup transcripts, keeping later execution context small while still avoiding repeated environment rediscovery.',
      'The approved setup plan remains the user-facing review artifact. Execution setup may augment it temporarily, but those augmentations are audited in the execution report instead of silently rewriting the approved plan.',
      'Everything created here is temporary runtime state. Cleanup removes the temp roots at ticket end while preserving audit artifacts and the execution log.',
    ],
  },
  CODING: {
    overview: 'LoopTroop runs the approved beads one at a time, choosing the next runnable bead based on dependency satisfaction, executing it with the coding agent, and updating progress after each attempt. The status label shows current bead progress (e.g., "Implementing (Bead 3/7)"). Only beads whose dependencies are fully satisfied (all prerequisite beads marked "done") can be picked for execution. Each bead runs in an isolated session with its own context, retry budget, and timeout, while reusing the compact execution setup profile created earlier.',
    steps: [
      'Bead Selection: LoopTroop reads the authoritative bead tracker, identifies all runnable beads (dependencies satisfied, not yet started), and selects the next bead to execute. The selection follows the topological order established during expansion, respecting the dependency graph.',
      'Context Assembly: For the selected bead, LoopTroop assembles bead-specific context: the bead description, acceptance criteria, file targets, test commands, any iteration notes from prior attempts, and the compact execution setup profile. The coding agent still receives only this bead-focused context — it does not see the full plan or other beads\' details.',
      'Environment Reuse: The coding agent reads the execution setup profile and reuses its temp roots, bootstrap outputs, and discovered command families instead of repeatedly rediscovering environment setup from scratch.',
      'Agent Execution: The locked main implementer launches a coding session with the configured retry and timeout settings. The agent reads the bead specification, writes code, creates or modifies files, runs tests, and attempts to satisfy the acceptance criteria.',
      'Live Streaming: Execution events, prompts, agent responses, file modifications, test results, and session lifecycle events are streamed into the phase log in real time. You can watch the agent work and see its progress.',
      'Scoped Verification: During each bead, LoopTroop prefers bead-specific tests first, then impacted or package-scoped lint/typecheck commands derived from the setup profile. It avoids failing beads solely because of unrelated repository-wide baseline debt.',
      'Success Handling: When a bead succeeds (acceptance criteria met), LoopTroop marks it "done" in the bead tracker, records the execution artifact (what was changed, test results), updates the ticket progress counters (e.g., 3/7 → 4/7), and broadcasts bead completion to the UI.',
      'Failure Handling: If a bead fails after exhausting its retry budget, it is marked "error" in the bead tracker. Execution stops for that bead, and iteration notes (error messages, partial progress, diagnostic hints) are recorded to help the next retry attempt if you choose to retry from the Blocked Error state.',
      'Loop Continuation: If more runnable beads remain after a successful completion, the state stays in Coding and the loop immediately picks the next runnable bead. The process continues until all beads are done or a bead fails.',
    ],
    outputs: [
      'Updated bead statuses (pending → in_progress → done/error) and ticket progress counters visible in the UI progress ring.',
      'Per-bead execution artifacts including file modifications, test results, and session logs.',
      'Iteration notes for failed beads (error messages, partial progress, diagnostics) to help retry attempts.',
    ],
    transitions: [
      'Bead Success + More Remaining → Stays in Coding: The loop continues with the next runnable bead.',
      'All Beads Done → Self-Testing: When every bead is marked "done," the workflow advances to the final testing phase.',
      'Bead Failure → Blocked Error: A bead that fails after retries, or an unrecoverable runtime issue, routes the ticket to Blocked Error. Retry from there will re-attempt the failed bead.',
    ],
    notes: [
      'Only runnable beads (all dependencies satisfied, not yet started) can be selected for execution.',
      'Context available: Current Bead Data + Bead Notes + Execution Setup Profile.',
      'The coding agent sees only the current bead plus the compact setup profile — it does not have access to the full plan, other beads\' results, or the overall PRD during execution.',
      'Each bead has its own retry budget and timeout. The agent can make multiple attempts at a single bead before marking it failed.',
    ],
  },
  RUNNING_FINAL_TEST: {
    overview: 'After all beads finish successfully, LoopTroop runs a ticket-level final test to verify the complete implementation as a whole — not just individual beads in isolation. The main implementer generates a comprehensive test plan based on the full implementation context (ticket, interview, PRD, beads), and then the generated test commands are executed on the current ticket branch. This catches integration issues that individual bead tests might miss.',
    steps: [
      'Full Context Assembly: LoopTroop loads the complete implementation context — ticket details, canonical interview, approved PRD, and beads plan — so the test generator understands not just what was implemented, but why and what the expected behavior should be.',
      'Test Plan Generation: The locked main implementer analyzes the full context and generates a structured final-test plan. This plan includes test commands to execute, expected outcomes, and what each test is verifying. Tests may include unit tests, integration tests, build verification, and acceptance criteria validation.',
      'Test Execution: LoopTroop executes the generated test commands in the ticket worktree under the configured timeout budget. Tests run on the actual branch state produced by the coding phase.',
      'Result Recording: A final test report artifact is written whether tests pass or fail. The report includes the generated test plan, actual command output, pass/fail status for each test, and any error messages or stack traces from failures.',
      'Phase Logging: The phase log captures the full test lifecycle — plan generation, command execution, output streams, and final results — for review and diagnosis.',
    ],
    outputs: [
      'Final test report with the generated test plan, execution results, pass/fail status, and error details.',
      'Phase logs showing test command execution and output.',
      'A pass/fail gate that determines whether the implementation proceeds to integration or needs manual intervention.',
    ],
    transitions: [
      'All Tests Pass → Finalizing Code: Successful final tests advance the workflow to the integration phase, which prepares a clean candidate commit.',
      'Any Test Failure → Blocked Error: Failed tests or test generation failures route the ticket to Blocked Error, where you can retry (re-run tests) or cancel.',
    ],
    notes: [
      'Context available: Ticket Details + Interview Results + PRD + Beads Plan + Verification Tests.',
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
      'Success → Creating PR: A successful candidate commit advances the workflow to the GitHub sync phase, which creates or updates the draft PR.',
      'Failure → Blocked Error: Git operation failures, empty changesets, or merge conflicts route the ticket to Blocked Error.',
    ],
    notes: [
      'Context available: Ticket Details + Interview Results + PRD + Beads Plan + Verification Tests.',
      'The squash commit preserves all file changes but replaces the individual bead-level commit history with a single clean commit.',
      'Why squash? Individual bead commits are implementation artifacts — they reflect the AI\'s step-by-step execution, not a meaningful commit history for human review. Squashing produces a single commit that represents "what was implemented" as a whole.',
      'The candidate commit is still local at the end of this phase. GitHub branch and PR synchronization happen in the next automatic phase.',
    ],
  },
  CREATING_PULL_REQUEST: {
    overview: 'LoopTroop pushes the final candidate SHA to the remote ticket branch and creates or updates a draft pull request on GitHub. This is an automatic GitHub-sync phase: it packages the final diff, the ticket intent, and the validation results into a reviewer-facing draft PR without merging anything yet.',
    steps: [
      'Remote Candidate Push: LoopTroop force-pushes the final candidate SHA to the remote ticket branch using a lease, replacing the bead-level backup branch state with the single reviewable candidate commit.',
      'PR Drafting: The locked main implementer generates a draft PR title and body using the ticket intent, approved artifacts, final diff, and final test report. The diff explains what changed; the earlier artifacts explain why.',
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
      'Success → Review Draft PR: A successful PR sync advances the workflow to the human PR review gate.',
      'Failure → Blocked Error: Push failures, GitHub auth issues, or PR creation/update failures route the ticket to Blocked Error.',
    ],
    notes: [
      'Context available: Ticket Details + Interview Results + PRD + Beads Plan + Verification Tests.',
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
      'Context available: Ticket Details + Interview Results + PRD + Beads Plan + Verification Tests.',
      'This is the human quality gate for the GitHub-native endgame.',
      'LoopTroop completion does not require deleting the PR or remote branch when you finish without merge.',
    ],
  },
  CLEANING_ENV: {
    overview: 'LoopTroop removes temporary runtime resources created during the ticket run while carefully preserving the artifacts needed for audit, review, and historical reference. This phase is automatic — it runs immediately after verification and does not require user input.',
    steps: [
      'Cleanup Scope Determination: LoopTroop identifies which runtime resources are transient (safe to remove) and which are permanent artifacts (must be preserved). The distinction is based on resource type: runtime state is transient, planning and audit artifacts are permanent.',
      'Transient Resource Removal: Lock files, active session folders, stream buffers, temporary files, and runtime state files are removed when present. These resources were needed during execution but have no long-term value.',
      'Artifact Preservation: Planning artifacts (interview, PRD, beads plan), execution logs, test reports, integration reports, and all phase log history are intentionally preserved. These remain accessible for review, audit, and reference long after the ticket is closed.',
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
      'Context available for reference: Ticket Details + Interview Results + PRD + Beads Plan + Verification Tests.',
      'The completed ticket serves as a permanent record of the implementation process — useful for understanding decisions, reviewing approaches, or learning from the AI\'s workflow.',
      'The candidate branch is not automatically merged — you decide when and how to merge the implementation into your main branch.',
    ],
  },
  CANCELED: {
    overview: 'The ticket was stopped by user action before normal completion and now sits in a terminal canceled state. All progress and artifacts created up to the cancellation point are preserved — nothing is deleted. You can still review the partial lifecycle to understand what was accomplished before cancellation.',
    steps: [
      'Cancellation Recording: LoopTroop records the cancellation event, including the phase from which cancellation was triggered, the timestamp, and any active sessions that were terminated.',
      'Active Session Cleanup: If AI sessions were running when cancellation was triggered (e.g., during a council phase or coding), those sessions are terminated gracefully.',
      'History Preservation: The UI preserves the completed portion of the lifecycle for review. All artifacts generated before cancellation (interview results, PRD drafts, beads plans, partial execution logs) remain accessible through the navigator.',
      'Terminal State: No more planning or execution actions are allowed once cancellation is finalized. The ticket cannot be restarted from the canceled state.',
    ],
    outputs: [
      'Terminal "canceled" status — the workflow has been permanently stopped by user action.',
      'Preserved history up to the cancellation point — all artifacts generated before cancellation remain accessible.',
      'No additional workflow progress or artifact generation.',
    ],
    transitions: [
      'None — this is a terminal state. There are no forward workflow transitions from Canceled.',
    ],
    notes: [
      'Context available for reference: Ticket Details only (though all artifacts generated before cancellation are preserved in the workspace).',
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
      'Cancel → Canceled: Cancel moves the ticket to the terminal Canceled state, preserving all artifacts and error history.',
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
    description: 'Running checks before coding starts. This status does not use context for AI models.',
    details: WORKFLOW_PHASE_DETAILS.PRE_FLIGHT_CHECK,
    kanbanPhase: 'in_progress',
    groupId: 'execution',
    uiView: 'coding',
    editable: true,
    multiModelLogs: false,
    contextSummary: [],
  },
  {
    id: 'WAITING_EXECUTION_SETUP_APPROVAL',
    label: 'Approve Workspace Setup',
    description: 'Review the readiness audit and approve any temporary workspace preparation before execution runs it.',
    details: WORKFLOW_PHASE_DETAILS.WAITING_EXECUTION_SETUP_APPROVAL,
    kanbanPhase: 'needs_input',
    groupId: 'execution',
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
    groupId: 'execution',
    uiView: 'coding',
    editable: false,
    multiModelLogs: false,
    contextSummary: ['ticket_details', 'relevant_files', 'prd', 'beads', 'execution_setup_plan', 'execution_setup_notes'],
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
    contextSummary: ['bead_data', 'bead_notes', 'execution_setup_profile'],
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
    id: 'CREATING_PULL_REQUEST',
    label: 'Creating PR',
    description: 'Pushing final candidate branch and creating or updating a draft pull request.',
    details: WORKFLOW_PHASE_DETAILS.CREATING_PULL_REQUEST,
    kanbanPhase: 'in_progress',
    groupId: 'execution',
    uiView: 'coding',
    editable: false,
    multiModelLogs: false,
    contextSummary: ['ticket_details', 'interview', 'prd', 'beads', 'tests'],
  },
  {
    id: 'WAITING_PR_REVIEW',
    label: 'Review Draft PR',
    description: 'Waiting for your review of the draft pull request before finishing the ticket.',
    details: WORKFLOW_PHASE_DETAILS.WAITING_PR_REVIEW,
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

export type WorkflowAction = 'start' | 'approve' | 'cancel' | 'retry' | 'merge' | 'close_unmerged'

export const APPROVAL_PHASE_IDS = new Set(
  WORKFLOW_PHASES.filter((phase) => phase.uiView === 'approval' && phase.reviewArtifactType).map((phase) => phase.id),
)

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
