import type { PromptPart } from '../opencode/types'
import type { OpenCodeToolPolicy } from '../opencode/toolPolicy'
import { VOTING_RUBRIC_BEADS, VOTING_RUBRIC_INTERVIEW, VOTING_RUBRIC_PRD } from '../council/types'
import { GLOBAL_RULES, CONVERSATIONAL_RULES } from './globalRules'
import { buildCompletionInstructions } from '../phases/execution/completionSchema'

interface PromptTemplate {
  id: string
  description: string
  systemRole: string
  task: string
  instructions: string[]
  outputFormat: string
  contextInputs: string[]
  toolPolicy: OpenCodeToolPolicy
}

function buildStrictVoteOutputInstruction(categories: string[]): string {
  const exampleScoresA = [18, 17, 16, 15, 18]
  const exampleScoresB = [14, 15, 14, 16, 13]
  const renderExampleDraft = (label: string, scores: number[]) => [
    `  ${label}:`,
    ...categories.map((category, index) => `    ${category}: ${scores[index] ?? 15}`),
    `    total_score: ${categories.reduce((sum, _, index) => sum + (scores[index] ?? 15), 0)}`,
  ].join('\n')

  return [
    'Output Format: Output strict machine-readable YAML. The top-level key MUST be `draft_scores`. Under `draft_scores`, include one mapping entry per presented draft using the exact provided draft label as the key (for example: `Draft 1`, `Draft 2`).',
    `Each draft entry MUST contain exactly ${categories.length + 1} integer fields on single lines: ${categories.map(category => `\`${category}\``).join(', ')}, and \`total_score\`.`,
    'All category scores MUST be plain integers from 0 to 20. `total_score` MUST be a plain integer from 0 to 100 and MUST equal the sum of the category scores for that draft.',
    'Do not output prose, explanations, markdown fences, comments, rankings, winners, averages, extra keys, or omitted drafts.',
    'Example:',
    '```yaml',
    'draft_scores:',
    renderExampleDraft('Draft 1', exampleScoresA),
    renderExampleDraft('Draft 2', exampleScoresB),
    '```',
  ].join('\n')
}

const STRICT_VOTE_OUTPUT_FORMAT = 'YAML with top-level `draft_scores` mapping keyed by exact draft labels. Each draft: rubric integer fields plus `total_score`. No other fields.'
const STRUCTURED_SELF_CHECK = 'Final Self-Check: before responding, verify that you are returning only the artifact, using the exact required top-level shape, with no prose, no markdown fences, no commentary, and no extra wrapper keys.'
const COVERAGE_OUTPUT_FORMAT = 'YAML with exactly these top-level keys: `status`, `gaps`, `follow_up_questions`. `status` must be `clean` or `gaps`. `gaps` must be a YAML list of double-quoted strings. Quote every `gaps` item even when it contains code identifiers, file paths, flags, backticks, or punctuation. `follow_up_questions` must be a YAML list (empty when status is `clean`).'
const INTERVIEW_COVERAGE_OUTPUT_FORMAT = 'YAML with exactly these top-level keys: `status`, `gaps`, `follow_up_questions`. `status` must be `clean` or `gaps`. `gaps` must be a YAML list of double-quoted strings. Quote every `gaps` item even when it contains code identifiers, file paths, flags, backticks, or punctuation. When `status` is `clean`, `follow_up_questions` must be `[]`. When `status` is `gaps`, `follow_up_questions` must be a YAML list of objects with these fields: `id`, `question`, `phase`, `priority`, `rationale`, `answer_type` (required: free_text|single_choice|multiple_choice|yes_no), and optionally `options` (list of {id, label}) when answer_type is single_choice or multiple_choice. Do not return plain strings in `follow_up_questions`.'
const PRD_OUTPUT_FORMAT = [
  'YAML with exactly these top-level keys (no wrappers): `schema_version`, `ticket_id`, `artifact`, `status`, `source_interview`, `product`, `scope`, `technical_requirements`, `epics`, `risks`, `approval`.',
  '`artifact` must be `prd`. `source_interview` must include `content_sha256`.',
  '`product` keys: `problem_statement`, `target_users`.',
  '`scope` keys: `in_scope`, `out_of_scope`.',
  '`technical_requirements` keys: `architecture_constraints`, `data_model`, `api_contracts`, `security_constraints`, `performance_constraints`, `reliability_constraints`, `error_handling_rules`, `tooling_assumptions`.',
  '`epics` must be a non-empty list. Each epic: `id`, `title`, `objective`, `implementation_steps`, `user_stories`.',
  'Each user story: `id`, `title`, `acceptance_criteria`, `implementation_steps`, `verification.required_commands`.',
  'Example:',
  '```yaml',
  'schema_version: 1',
  'ticket_id: "PROJ-1"',
  'artifact: "prd"',
  'status: "draft"',
  'source_interview:',
  '  content_sha256: "<sha256>"',
  'product:',
  '  problem_statement: "..."',
  '  target_users:',
  '    - "..."',
  'scope:',
  '  in_scope:',
  '    - "..."',
  '  out_of_scope:',
  '    - "..."',
  'technical_requirements:',
  '  architecture_constraints: []',
  '  data_model: []',
  '  api_contracts: []',
  '  security_constraints: []',
  '  performance_constraints: []',
  '  reliability_constraints: []',
  '  error_handling_rules: []',
  '  tooling_assumptions: []',
  'epics:',
  '  - id: "EPIC-1"',
  '    title: "..."',
  '    objective: "..."',
  '    implementation_steps:',
  '      - "..."',
  '    user_stories:',
  '      - id: "US-1"',
  '        title: "..."',
  '        acceptance_criteria:',
  '          - "..."',
  '        implementation_steps:',
  '          - "..."',
  '        verification:',
  '          required_commands:',
  '            - "npm test"',
  'risks:',
  '  - "..."',
  'approval:',
  '  approved_by: ""',
  '  approved_at: ""',
  '```',
].join('\n')
const INTERVIEW_PHASE_ORDER_RULE = 'Phase Order Is Mandatory: all `foundation` questions first, then all `structure` questions, then all `assembly` questions. Never go backwards to an earlier phase once you have entered a later phase.'
const BEADS_ORDER_PRESERVATION_RULE = 'Order Is Mandatory: Preserve the bead list order from the winning draft exactly. When adding new beads, insert them at a logical position that respects dependency ordering, but do not reorder, merge, or split existing beads. The app executes beads sequentially and derives `priority` from this list order.'
const BEAD_SUBSET_OUTPUT_FORMAT = [
  'YAML with a single top-level `beads` key containing a list.',
  'Each bead item must include exactly these fields:',
  '```yaml',
  'beads:',
  '  - id: "setup-db-schema"',
  '    title: "Create database schema"',
  '    prdRefs:',
  '      - "EPIC-1"',
  '      - "US-1-1"',
  '    description: "Detailed technical implementation steps for this bead."',
  '    contextGuidance:',
  '      patterns:',
  '        - "Use Drizzle ORM migrations."',
  '      anti_patterns:',
  '        - "Avoid raw SQL."',
  '    acceptanceCriteria:',
  '      - "Schema file exists and migrations run cleanly."',
  '    tests:',
  '      - "Unit test verifies table creation."',
  '    testCommands:',
  '      - "npm run test -- server/db"',
  '```',
  'Write `contextGuidance` as an object with two keys: `patterns` (list of specific patterns to follow) and `anti_patterns` (list of anti-patterns to avoid).',
  'No other top-level keys. No prose before or after the YAML.',
].join('\n')
const BEADS_JSONL_OUTPUT_FORMAT = 'JSONL only. One JSON object per line. No markdown fences, no surrounding array, no prose, and no wrapper object.'

// Relevant Files Context Extraction Prompt
export const PROM0: PromptTemplate = {
  id: 'PROM0',
  description: 'Relevant Files Context Extraction Prompt',
  systemRole: 'You are an expert software architect performing codebase analysis for implementation planning.',
  task: 'Given the ticket description, identify and read the source files most relevant to this ticket. Use your file-reading and directory-listing tools to explore the project structure, examine the actual code, then return a structured identification of the relevant files with detailed rationales.',
  instructions: [
    'Analysis Strategy: Study the ticket description to understand what needs to be implemented. Use your file-reading and directory-listing tools to explore the project structure and identify files that would need to be read, modified, or depended upon when implementing this ticket.',
    'Rationale Depth: For each file, write a detailed multi-sentence rationale (3-6 sentences) that explains: (a) WHY this file is relevant to the ticket, (b) WHICH specific symbols (functions, classes, types, exports) inside the file matter and why, (c) what role this file plays in the implementation (dependency, modification target, type source, test target, etc.), and (d) how it connects to other relevant files. The rationale is the primary value of your output — be thorough and specific.',
    'Content Preview: For each file, include a `content_preview` field containing ONLY the key symbol signatures relevant to the ticket — function/method signatures, type/interface definitions, class declarations, and export statements. Do NOT include function bodies, implementations, or full code blocks. Aim for 5-20 lines of signatures per file. Think of this as a table-of-contents for the file, not a code excerpt.',
    'Relevance Ordering: Present files in descending order of relevance. Core implementation files first, then type definitions, then supporting utilities, then tests/configs.',
    'Scope Discipline: Read only files genuinely relevant to the ticket. Do not read entire directories. Aim for precision: 5-25 files depending on ticket scope. Never exceed 30 files.',
    'Output Envelope: Return exactly one <RELEVANT_FILES_RESULT>...</RELEVANT_FILES_RESULT> block and nothing else before or after it.',
    'YAML Discipline: Inside the block, output only strict YAML with valid indentation. Do not use markdown fences anywhere inside the block.',
    'Count Consistency: `file_count` must exactly equal the final number of entries in `files`.',
    STRUCTURED_SELF_CHECK,
  ],
  outputFormat: 'YAML inside <RELEVANT_FILES_RESULT> tags with top-level keys: `file_count` (integer), `files` (list). Each file item: `path` (string), `rationale` (string, detailed 3-6 sentences), `relevance` (high|medium|low), `likely_action` (read|modify|create), `content_preview` (string, key symbol signatures only — no implementations). No other top-level keys.',
  contextInputs: ['ticket_details'],
  toolPolicy: 'default',
}

// Interview Phase Prompts
export const PROM1: PromptTemplate = {
  id: 'PROM1',
  description: 'Interview Draft Specification Prompt',
  systemRole: 'You are an expert product manager and technical interviewer.',
  task: "Generate a comprehensive set of interview questions to gather all requirements and clarify the user's intent for the project.",
  instructions: [
    'Phase 1 - Foundation (What/Who/Why): First establish project intent, target user, core value, constraints (and out of scope), and non-goals. Exit criteria: no core ambiguity remains for problem, user, and objective.',
    'Phase 2 - Structure (Complete Feature Inventory): Then capture the full list of required features and major user flows before deep implementation details. Exit criteria: feature inventory is complete, deduplicated, and prioritized.',
    'Phase 3 - Assembly (Deep Dive Per Feature): Then go feature-by-feature and define implementation-level expectations (behavior, edge cases, acceptance criteria, test intent, dependencies). Exit criteria: each in-scope feature has enough detail to support PRD generation without guessing.',
    INTERVIEW_PHASE_ORDER_RULE,
    'Question Limit: Treat `max_initial_questions` as a hard upper bound, never a target. Ask only as many questions as are genuinely needed to remove meaningful ambiguity and gather enough detail for PRD generation. Returning well under `max_initial_questions` is fully acceptable when coverage is already strong. Do not add low-value or redundant questions just because budget remains.',
    'Single Response Completeness: Return one complete final `questions` list in this single response. Do not stop after only the `foundation` phase, do not emit a partial subset or phased draft, and do not split the list across multiple messages. Whatever number of questions you decide is necessary, include that entire final set in the one YAML artifact.',
    `Output Format: Output strict machine-readable YAML. The top-level key MUST be \`questions\` containing a list. Each entry MUST have exactly three fields: \`id\`, \`phase\`, and \`question\`.
    Example:
    \`\`\`yaml
    questions:
      - id: Q01
        phase: foundation
        question: "Your question here?"
          - id: Q02
        phase: structure
        question: "Another question?"
    \`\`\``,
    STRUCTURED_SELF_CHECK,
  ],
  outputFormat: 'YAML with top-level `questions` list. Each item: {id, phase, question}. No other fields.',
  contextInputs: ['relevant_files', 'ticket_details'],
  toolPolicy: 'disabled',
}

export const PROM2: PromptTemplate = {
  id: 'PROM2',
  description: 'Interview Council Voting Prompt',
  systemRole: 'You are an impartial judge on an AI Council. Your role is to evaluate multiple sets of proposed interview questions objectively.',
  task: 'Read all provided interview question drafts. Evaluate how well each draft will extract the necessary requirements from the user without being overwhelming. Rate each draft from 0 to 100.',
  instructions: [
    'Impartiality: Rate impartially as if all drafts are anonymous. Do not favor any draft based on its origin or style.',
    'Anti-anchoring: Drafts are presented in randomized order per evaluator. Do not assume the first draft is the baseline or best.',
    'Scoring Rubric (minimum 0, maximum 20 points per category, total maximum 100): 1) Coverage of requirements. 2) Correctness / feasibility. 3) Testability. 4) Minimal complexity / good decomposition. 5) Risks / edge cases addressed.',
    buildStrictVoteOutputInstruction(VOTING_RUBRIC_INTERVIEW.map(item => item.category)),
    STRUCTURED_SELF_CHECK,
  ],
  outputFormat: STRICT_VOTE_OUTPUT_FORMAT,
  contextInputs: ['relevant_files', 'ticket_details', 'drafts'],
  toolPolicy: 'disabled',
}

export const PROM3: PromptTemplate = {
  id: 'PROM3',
  description: 'Interview Winner Refinement Prompt',
  systemRole: "You are the Lead Product Manager and the winner of the AI Council's interview drafting phase.",
  task: 'Create the final, definitive version of your interview questions by reviewing the alternative (losing) drafts for useful inspiration. Keep the winning draft as the primary foundation, but feel free to improve it wherever the alternatives clearly produce a stronger final draft.',
  instructions: [
    'Anchor on the winning draft. It won because its structure, sequencing, and core decisions are the best starting point. Preserve its strengths, but do not treat its exact wording or every individual question as untouchable.',
    'Use the alternative drafts as inspiration, not as equal-weight sources to merge blindly. They may surface missed topics, sharper phrasing, stronger sequencing, or better edge-case coverage, and you may adopt those improvements whenever they make the final draft meaningfully better.',
    'Gap Scan: Read through the alternative drafts and note only high-value candidates: topics you truly skipped, edge cases you clearly missed, or questions that are materially clearer or more precise than yours. These are optional candidates — not automatic additions.',
    'Selective Upgrade: For each candidate, ask whether it creates a clear net improvement over the winning draft. If it fills a real gap or add value to the project, add it. If it meaningfully improves one of your existing questions, adapt, replace, or combine questions while keeping the winning draft’s overall voice and quality bar. Otherwise, discard it.',
    'Measured Refinement: Do not rewrite from scratch or blend drafts together just for balance. But it is acceptable to improve several questions, adjust local sequencing, or rework wording across the draft if that produces a clearly stronger final result.',
    'Question Limit: Treat `max_initial_questions` as a hard upper bound, never a target. Keep only the questions that are necessary for strong coverage. Returning well under `max_initial_questions` is fully acceptable when the winning draft already covers the space well. Do not add low-value questions just because capacity remains.',
    'Restraint: Avoid appending near-duplicate questions that merely rephrase something you already cover. Prefer meaningful improvements over cosmetic churn. But if genuine gaps exist — topics missed, edge cases overlooked — fill them, as long as you stay within `max_initial_questions`.',
    'ID Stability: Preserve the winning draft\'s existing `id` for every question that still exists in the final draft, even if its wording improves or its position moves. Do not renumber surviving questions for neatness. Assign fresh IDs only to genuinely new questions, using new numeric IDs above the current maximum winner-draft ID.',
    'Single Artifact Contract: Return one YAML artifact that contains both the final refined `questions` list and a top-level `changes` list. Do not split the refined questions and change metadata across multiple outputs, wrappers, or separate artifacts.',
    'Changes Coverage: The top-level `changes` list must fully account for the differences between the winning draft and the final refined draft. Use `type` values `modified`, `replaced`, `added`, or `removed`. For each entry, include `before` and `after` question records (or `null` when appropriate for added/removed changes).',
    'Optional Inspiration Attribution: When a change was directly inspired by an alternative draft, include `inspiration` with `alternative_draft` and the inspiring `question`. If a change was not directly inspired by a losing draft, omit `inspiration` or set it to null.',
    INTERVIEW_PHASE_ORDER_RULE,
    'Formatting: Output the final refined draft and the top-level `changes` list using the exact structural format required for this phase. Output only this single artifact.',
    STRUCTURED_SELF_CHECK,
  ],
  outputFormat: 'YAML with top-level `questions` list and top-level `changes` list. Each `questions` item: {id, phase, question}. Each `changes` item: {type, before, after, inspiration?}. `type` must be one of {modified, replaced, added, removed}. `before` and `after` use the same question shape or null when appropriate. Optional `inspiration` uses {alternative_draft, question}. No extra wrapper object.',
  contextInputs: ['relevant_files', 'ticket_details', 'drafts'],
  toolPolicy: 'disabled',
}

export const PROM4_FINAL_INTERVIEW_SCHEMA = [
  'Final Interview YAML Schema:',
  'schema_version: 1',
  'ticket_id: "<ticket-id>"',
  'artifact: interview',
  'status: draft',
  'generated_by:',
  '  winner_model: "<winner-model-id>"',
  '  generated_at: "<ISO-8601 timestamp>"',
  '  canonicalization: server_normalized',
  'questions:',
  '  - id: "Q01"',
  '    phase: "Foundation"',
  '    prompt: "What problem are we solving?"',
  '    source: compiled | prompt_follow_up | coverage_follow_up | final_free_form',
  '    follow_up_round: null',
  '    answer_type: free_text | single_choice | multiple_choice',
  '    options:',
  '      - id: opt1',
  '        label: "Option label"',
  '    answer:',
  '      skipped: false',
  '      selected_option_ids: []',
  '      free_text: "User answer or empty string"',
  '      answered_by: user | ai_skip',
  '      answered_at: "<ISO-8601 timestamp or empty string>"',
  'follow_up_rounds:',
  '  - round_number: 1',
  '    source: prom4 | coverage',
  '    question_ids: ["FU1"]',
  'summary:',
  '  goals: []',
  '  constraints: []',
  '  non_goals: []',
  '  final_free_form_answer: ""',
  'approval:',
  '  approved_by: ""',
  '  approved_at: ""',
].join('\n')

export const PROM4: PromptTemplate = {
  id: 'PROM4',
  description: 'Interview Batch Question Prompt',
  systemRole: 'You are an expert product manager conducting an interview with a user.',
  task: "Review the user's answers to questions and adjust the upcoming ones to improve coherence and extract missing details.",
  instructions: [
    'Batching and Progress: Present batches of 1-3 questions. You MUST vary the batch size — do NOT always use 3. Choose batch size dynamically: use 1 for complex/open-ended/high-priority questions that need focused attention; use 2 for moderately related questions or when the user gave brief/unclear previous answers; use 3 only for simple/clear-cut/factual questions that are tightly related. If in doubt, prefer smaller batches. Show progress (e.g., question 12 of the current planned set, where the total may change), and wait for the user to answer all questions in that batch.',
    'Compiled Checklist: Treat the compiled questions supplied in context as the primary interview checklist, not as background reference. Use them as the default plan for the interview and keep them actively in mind throughout the conversation.',
    'Checklist Fidelity: Try to work through the compiled question set faithfully before ending the interview. You may adapt sequencing and wording for coherence, and if a user answer fully resolves one or more future compiled questions, you may skip those future questions instead of asking them redundantly. Stay anchored to the compiled agenda rather than drifting to a much smaller custom subset just because coverage feels strong.',
    'Adaptation and IDs: You may reorder, rephrase, merge, or lightly split compiled questions when it improves coherence, but keep them tied to the original compiled agenda. When adapting a compiled question, preserve its original compiled question ID whenever possible; use new follow-up IDs only for genuinely new follow-up questions you introduce.',
    'Auto-Skipping: Do not silently drop compiled questions just because earlier answers seem broadly sufficient. Auto-skip a compiled question only when the user has already answered it implicitly, when a prior answer fully resolves that question, or when it has become clearly redundant or no longer useful to ask, and keep that question accounted for in the final interview results under its compiled ID.',
    'Adaptive Iteration: After each batch, analyze answers and adjust only upcoming questions when needed. Treat `max_follow_ups` as a hard cap derived from the configured coverage follow-up budget percent. Add follow-up questions only when they are necessary to resolve meaningful ambiguities, update/delete now-redundant questions, and accept skipped answers without re-asking unless the missing answer is critical. Follow-up questions may interleave with compiled questions when they materially improve coherence or unblock later compiled questions. Do not use the follow-up budget unless it materially improves coverage.',
    "Final Free-Form Question: Do not move to the final free-form question just because coverage feels good enough. First work through or explicitly account for the remaining compiled questions, including future compiled questions made unnecessary by earlier answers, and only after the compiled checklist has been answered, skipped, or rendered redundant and no major ambiguity remains, present one final free-form question. Keep the question anchored to 'Anything else to add before PRD generation?' but explicitly tell the user that the next step is interview coverage check, that coverage check may still create targeted follow-up questions if gaps are found, and that there is still an interview approval step before PRD drafting begins.",
    'Final Output: After the final free-form question is answered or skipped, output the final interview results file in a strict machine-readable format.',
    `Structured Batch Output: Wrap each intermediate batch response in <INTERVIEW_BATCH> tags containing YAML with these fields:
  batch_number: (integer, starting at 1)
  progress:
    current: (same as batch_number — the sequential batch index, starting at 1)
    total: (estimated total number of batches planned, may change as you adapt)
  is_final_free_form: (boolean, true only for the final free-form question)
  ai_commentary: (brief text explaining why you chose these questions or how you adapted)
  questions:
    - id: (string, e.g. "Q12" or "FU3")
      question: (the question text)
      phase: (Foundation | Structure | Assembly)
      priority: (critical | high | medium | low)
      rationale: (why this question matters)
      answer_type: (REQUIRED — evaluate every question and choose the best type. Default to structured answer types; use free_text only as a last resort:
        - "yes_no" for simple boolean/binary questions (e.g., "Do you need authentication?", "Should there be an admin panel?") — do NOT include options, the system generates Yes/No automatically
        - "single_choice" for mutually-exclusive choices from a finite set (e.g., "Which database engine?", "What deployment target?") — provide 2-10 options
        - "multiple_choice" for "select all that apply" from a finite set (e.g., "Which platforms to support?", "Which authentication methods?") — provide 2-15 options
        - "free_text" ONLY for genuinely open-ended questions where the answer space cannot be reasonably enumerated into choices (e.g., "Describe the problem you're solving", "What are your performance requirements?")
        IMPORTANT: Prefer structured types (yes_no, single_choice, multiple_choice) as the default. At least 60-70% of questions should use structured types. Most product and technical questions CAN be expressed as choices — think about what the realistic options are and offer them. Use free_text ONLY when the answer is truly creative, narrative, or unbounded. The user always has a free-form text field below the options to add notes or write their own answer, so structured types never limit the user. Do NOT include an "Other" option yourself.)
      options: (required when answer_type is single_choice or multiple_choice; omit for free_text and yes_no — list of choices with id and label, e.g.:)
        - id: opt1
          label: "PostgreSQL"
        - id: opt2
          label: "MySQL"`,
    'Final Complete Output: When the interview is fully complete (after the final free-form answer), wrap the final output in <INTERVIEW_COMPLETE> tags containing YAML that matches this exact interview-results schema.',
    PROM4_FINAL_INTERVIEW_SCHEMA,
    'Output Discipline: For intermediate turns, return exactly one <INTERVIEW_BATCH> block and nothing else outside it. For the final turn, return exactly one <INTERVIEW_COMPLETE> block and nothing else outside it.',
    'Formatting Discipline: Do not place markdown fences inside either tag block. Keep YAML indentation valid so every question field stays nested under its list item.',
    STRUCTURED_SELF_CHECK,
  ],
  outputFormat: 'YAML — complete interview results file with schema_version, ticket_id, artifact, status, generated_by, questions, follow_up_rounds, summary, approval',
  contextInputs: ['relevant_files', 'ticket_details', 'interview', 'user_answers'],
  toolPolicy: 'disabled',
}

export const PROM5: PromptTemplate = {
  id: 'PROM5',
  description: 'Interview Coverage Verification Prompt',
  systemRole: 'You are a meticulous Quality Assurance Lead.',
  task: 'Re-read the original ticket description and all collected user answers, then compare them against the final Interview Results file to ensure complete coverage.',
  instructions: [
    'Coverage Check: Detect unresolved ambiguity, missing constraints, missing edge cases, missing non-goals, and inconsistent answers.',
    'Identify Gaps: List any specific gaps or discrepancies found between the source material and the Interview Results.',
    'Coverage Limits: Treat `coverage_run_number` and `max_coverage_passes` from the context as hard limits. Coverage can run once or at most `max_coverage_passes` times in total. If `is_final_coverage_run` is true, report any unresolved gaps clearly without assuming another retry exists.',
    'Follow-up Budget: Treat `coverage_follow_up_budget_percent`, `follow_up_budget_total`, `follow_up_budget_used`, and `follow_up_budget_remaining` from the context as hard limits. If gaps exist, generate only the targeted follow-up questions strictly necessary to resolve them and never exceed `follow_up_budget_remaining`. If `follow_up_budget_remaining` is `0`, you must return `follow_up_questions: []`.',
    'Coverage Follow-up ID Rule: Every generated follow-up question must use a new ID that does not reuse any existing canonical interview question ID or `QFF1`. When you need a new coverage-specific ID, prefer the `CFU<n>` form.',
    'If no gaps exist, confirm that the Interview Results are complete and ready for interview approval, and make clear that PRD generation begins only after that approval step.',
    'Output Envelope: return only YAML with top-level `status`, `gaps`, and `follow_up_questions`.',
    'YAML Validity: Every item in `gaps` must be a double-quoted YAML string, even when the text contains code identifiers, paths, flags, backticks, or punctuation.',
    `Gap Triggering: Use \`status: gaps\` only when at least one real unresolved gap remains. When \`status: gaps\`, \`follow_up_questions\` must be a YAML list of question objects with these fields: \`id\`, \`question\`, \`phase\`, \`priority\`, \`rationale\`, and \`answer_type\` (REQUIRED — choose the best type for each question: "free_text" for open-ended, "single_choice" for mutually-exclusive finite sets with 2-10 options, "multiple_choice" for select-all-that-apply with 2-15 options, "yes_no" for simple boolean questions without options). When answer_type is single_choice or multiple_choice, include an \`options\` list with \`id\` and \`label\` fields. Do not return plain strings in \`follow_up_questions\`.`,
    'Do not output rewritten interview results, summaries, or any extra keys.',
    STRUCTURED_SELF_CHECK,
  ],
  outputFormat: INTERVIEW_COVERAGE_OUTPUT_FORMAT,
  contextInputs: ['ticket_details', 'user_answers', 'interview'],
  toolPolicy: 'disabled',
}

// PRD Phase Prompts
export const PROM10a: PromptTemplate = {
  id: 'PROM10a',
  description: 'PRD Gap Resolution Prompt',
  systemRole: 'You are an expert Technical Product Manager and Software Architect.',
  task: 'Fill every skipped answer in the approved Interview Results and output one complete Full Answers interview artifact that preserves the original approved interview structure.',
  instructions: [
    'Source Of Truth: Treat the provided approved Interview Results as canonical for question order, IDs, prompts, phases, options, source metadata, and every non-skipped user answer.',
    'Provided Artifact Rule: The approved Interview Results artifact is already included in the prompt. Do not ask to search for it, read files, or fetch additional context before answering.',
    'Preservation Rule: Preserve every existing non-skipped answer exactly as-is. Do not rewrite, summarize, or improve user-provided answers.',
    'Allowed Edits Only: The only fields you may change are `questions[*].answer` for questions whose current answer is marked `skipped: true`.',
    'Forbidden Edits: Do not change question IDs, question order, prompts, phases, `answer_type`, `options`, `follow_up_rounds`, `summary`, approval fields, or any existing non-skipped answer.',
    'Artifact Shape Rule: `artifact` must be the scalar value `interview` on one line. Do not wrap the document under `artifact.interview` or any other envelope.',
    'Generated By Shape Rule: `generated_by` must be a mapping block with exactly these child keys: `winner_model`, `generated_at`, and `canonicalization`.',
    'Top-Level Placement Rule: `follow_up_rounds`, `summary`, and `approval` must each appear once at the top level after `questions`. Never nest them under a question, answer, or another wrapper object.',
    'Gap Resolution Rule: Fill only the questions whose current answer is marked `skipped: true`. Use the ticket details, relevant files, and the rest of the interview to infer the strongest concrete answer.',
    'Answer Encoding: For every filled skipped question, set `answer.skipped: false`, provide a concrete `free_text` and/or `selected_option_ids` consistent with the question `answer_type`, set `answered_by: ai_skip`, and set a non-empty ISO-8601 `answered_at` timestamp. When the answer type is choice-based, populate best-fit canonical `selected_option_ids` using the provided option IDs. For any `free_text` question with `skipped: false`, `free_text` must be non-empty.',
    'Question Copy Rule: Copy each canonical question block exactly as provided and change only the `answer` block for skipped questions.',
    'Choice Canonical ID Rule: For `single_choice` and `multiple_choice`, always set `selected_option_ids` using the canonical option IDs already present in that question block. Never invent option IDs or rewrite the `options` list.',
    'Choice Orientation Rule: Treat provided single-choice and multiple-choice options as orientation only, not as the full answer. Use the closest canonical `selected_option_ids` when they help anchor the answer, but if the better inferred answer goes beyond the listed options, capture that better answer in concise `free_text`.',
    'Choice Free Text Rule: For choice questions, `free_text` is optional when an existing option is an exact fit, but preferred when nuance, caveats, or a better suggestion matter. Do not use `free_text` only to restate the selected option label.',
    'Final Free-Form Rule: If the final free-form question truly has nothing else to add, still write a short explicit `free_text` response such as "Nothing else to add." instead of `""`.',
    'Conditional Follow-Up Rule: If an earlier answer makes a follow-up question not applicable, say that explicitly in `free_text`; never leave that follow-up answer blank.',
    'No Remaining Gaps: In the final artifact, no question may remain with `answer.skipped: true`.',
    'Artifact Status: Output the completed interview artifact as `status: draft` with empty approval fields, because these AI-filled answers are not user-approved.',
    'Self-Check: Before responding, verify that the output contains the exact same number of questions and the exact same canonical question IDs as the approved interview artifact.',
    'Completeness Rule: Return the entire interview artifact from `schema_version` through the final `approval` block. Do not stop early, emit only a prefix, or omit trailing question blocks. If space is tight, shorten answer text instead of omitting later question blocks.',
    'Clean Stop Rule: Stop immediately after the final `approval` block. Do not append status text, markdown fences, tool notes, stray terminal characters, or any note that says Do not read files, search for more context, propose an implementation plan.',
    'Prompt Echo Guard: Never repeat prompt scaffolding or placeholder schema lines from `## Expected Output Format`, `## Context`, or `# Ticket:`. Output only the final artifact.',
    'Output Discipline: Return exactly one complete interview artifact and nothing else. No prose, no PRD content, no wrappers, no markdown fences, and no extra keys.',
    STRUCTURED_SELF_CHECK,
  ],
  outputFormat: PROM4_FINAL_INTERVIEW_SCHEMA,
  contextInputs: ['relevant_files', 'ticket_details', 'interview'],
  toolPolicy: 'disabled',
}

export const PROM10b: PromptTemplate = {
  id: 'PROM10b',
  description: 'PRD Draft Specification Prompt',
  systemRole: 'You are an expert Technical Product Manager and Software Architect.',
  task: 'Generate a complete Product Requirements Document (PRD) based on the provided Full Answers interview artifact. The PRD must be detailed enough that an AI coding agent can implement the feature without ambiguity.',
  instructions: [
    'Complete Interview Input: Treat the provided Full Answers interview artifact as the complete requirement source, including any AI-resolved answers for questions the user originally skipped.',
    'Product Scope: Include epics, user stories, and acceptance criteria. Every in-scope feature from the Interview Results must map to at least one user story.',
    'Epic Completeness: Every epic must include at least one fully populated `user_stories` entry. Never emit an epic shell with `user_stories: []`, omit `user_stories`, or park requirements only at epic level.',
    'Implementation Steps: For each user story, include detailed technical implementation steps decomposed as far as possible — data flows, state changes, component interactions, and integration points.',
    'Technical Requirements: Define architecture constraints, data model, API/contracts, security/performance/reliability constraints, error-handling rules, tooling/environment assumptions, explicit non-goals.',
    'Schema Contract: Follow the exact PRD YAML schema in the Expected Output Format section, including all required top-level keys and nested fields.',
    'Output Format: Output a single, comprehensive PRD document covering all of the above in one artifact.',
    'Boundary Rule: Begin the artifact at `schema_version` and end at `approval.approved_at`. Do not prepend or append any prose.',
    'Length Safety: If output length is a concern, shorten field text instead of truncating later epics, user stories, risks, or the final approval block.',
    'Prompt Echo Guard: Never repeat prompt scaffolding or placeholder schema lines from `## Expected Output Format`, `## Context`, or `# Ticket:`. Output only the final artifact.',
    'No Prose Mode: Never output implementation plans, diffs, next steps, acknowledgements, commentary, or any text outside the PRD YAML artifact.',
    STRUCTURED_SELF_CHECK,
  ],
  outputFormat: PRD_OUTPUT_FORMAT,
  contextInputs: ['relevant_files', 'ticket_details', 'full_answers'],
  toolPolicy: 'disabled',
}

export const PROM11: PromptTemplate = {
  id: 'PROM11',
  description: 'PRD Council Voting Prompt',
  systemRole: 'You are an impartial judge on an AI Council. Your role is to evaluate multiple Product Requirements Document (PRD) drafts objectively.',
  task: 'Read all provided PRD drafts, compare each draft against the Interview Results, and evaluate them against each other. Rate each draft from 0 to 100.',
  instructions: [
    'Impartiality: Rate impartially as if all drafts are anonymous. Do not favor any draft based on its origin or style.',
    'Anti-anchoring: Drafts are presented in randomized order per evaluator. Do not assume the first draft is the baseline or best.',
    'Draft Provenance: Some PRD drafts may reflect model-specific AI-filled answers for questions the user originally skipped. Score the draft quality and requirement coverage as presented, not the identity of the model that filled those gaps.',
    'Scoring Rubric (minimum 0, maximum 20 points per category, total maximum 100): 1) Coverage of requirements. 2) Correctness / feasibility. 3) Testability. 4) Minimal complexity / good decomposition. 5) Risks / edge cases addressed.',
    buildStrictVoteOutputInstruction(VOTING_RUBRIC_PRD.map(item => item.category)),
    STRUCTURED_SELF_CHECK,
  ],
  outputFormat: STRICT_VOTE_OUTPUT_FORMAT,
  contextInputs: ['relevant_files', 'ticket_details', 'interview', 'drafts'],
  toolPolicy: 'disabled',
}

export const PROM12: PromptTemplate = {
  id: 'PROM12',
  description: 'PRD Winner Refinement Prompt',
  systemRole: "You are the Lead Architect and the winner of the AI Council's PRD drafting phase.",
  task: 'Create the final, definitive version of your PRD by reviewing the alternative (losing) drafts. Extract any superior ideas, missing edge cases, or better technical constraints they contain, and integrate them seamlessly into your winning foundation.',
  instructions: [
    'Anchor on the winning draft. It won because its structure, architecture decisions, and core requirements are the best starting point. Preserve its strengths, but do not treat its exact wording or every individual epic as untouchable.',
    'Full Answers Context: Each council member produced their own Full Answers artifact during PRD drafting — filling in skipped interview questions with their own model-specific answers. As a result, each PRD draft was built from a different set of underlying answers and assumptions. When reviewing alternative drafts, consider not just the PRD requirements themselves but also the Full Answers that informed them. Some models may have produced better answers for certain skipped questions, leading to requirements you should adopt.',
    'Gap Scan: Read through the alternative drafts and note anything they cover that your draft does not: requirements you missed, edge cases or error states you omitted, risks you underweighted, or constraints that are unambiguously more precise than yours. These are candidates — not automatic additions.',
    'Selective Upgrade: For each candidate, decide: does it add genuine value, or is it a rephrasing of something you already cover well? If it fills a real gap, add it. If it is a strictly better formulation of something you already have, replace yours with it. Otherwise, discard it.',
    'Measured Refinement: Do not rewrite from scratch or blend drafts together just for balance. But it is acceptable to improve multiple sections, adjust local structure, or rework content across the draft if that produces a clearly stronger final result.',
    'Restraint: Avoid adding content that merely restates what you already cover. But if genuine gaps exist — missing requirements, unaddressed risks, overlooked error states — add them; completeness matters more than brevity.',
    'Epic Completeness: Every epic in the final PRD must include at least one fully populated `user_stories` entry. Never leave an epic as a shell with `user_stories: []`, omit `user_stories`, or move story-level requirements only into epic-level fields.',
    'Single Artifact Contract: Return one YAML artifact that contains both the final refined PRD and a top-level `changes` list. Do not split the refined PRD and change metadata across multiple outputs, wrappers, or separate artifacts.',
    'Changes Coverage: The top-level `changes` list must fully account for the differences between the winning PRD and the final refined PRD. Use `type` values `modified`, `added`, or `removed`. Include `item_type` (`epic` or `user_story`) plus `before` and `after` item records (or `null` when appropriate).',
    'One-Entry-Per-Item Rule: Every changed epic or user story must appear exactly once in `changes`. Epic changes do not subsume changed user stories. If an existing item keeps the same ID but its content changes, emit exactly one `modified` entry for that item.',
    'Optional Inspiration Attribution: When a change was directly inspired by an alternative draft, include `inspiration` with `alternative_draft` and the inspiring `item`. Include `inspiration.item.detail` whenever the source item has useful supporting text (for example objective, description, acceptance, or implementation detail). If a change was not directly inspired by a losing draft, omit `inspiration` or set it to null.',
    'Formatting: Output only this single refined PRD artifact with its top-level `changes` list.',
    'Schema Preservation: keep the same PRD schema, required top-level sections, and nested field structure. Do not wrap the PRD in another object.',
    'ID Stability: Preserve existing epic IDs and user story IDs from the winning draft unless you are adding a genuinely new epic or story.',
    STRUCTURED_SELF_CHECK,
  ],
  outputFormat: `${PRD_OUTPUT_FORMAT}\nAlso include a top-level \`changes\` list. Each change item: {type, item_type, before, after, inspiration?}. \`type\` must be one of {modified, added, removed}. \`item_type\` must be \`epic\` or \`user_story\`. \`before\` and \`after\` use {id, label, detail?} or null when appropriate. Optional \`inspiration\` uses {alternative_draft, item}. Keep everything in one YAML artifact.`,
  contextInputs: ['relevant_files', 'ticket_details', 'full_answers', 'drafts'],
  toolPolicy: 'disabled',
}

export const PROM13: PromptTemplate = {
  id: 'PROM13',
  description: 'PRD Coverage Verification Prompt',
  systemRole: 'You are a meticulous Quality Assurance Lead.',
  task: 'Re-read the approved Interview Results and the winner Full Answers artifact, then compare them against the final PRD to ensure complete coverage.',
  instructions: [
    'Primary Truth: Treat the approved Interview Results as primary user truth. Use the winner Full Answers artifact as the adopted completion for questions the user skipped.',
    'Coverage Check: Detect unresolved ambiguity, missing requirements, missing edge cases, missing constraints, missing acceptance criteria, missing non-goals or out-of-scope items, and inconsistencies between the Interview Results and the PRD.',
    'Identify Gaps: List any specific gaps or discrepancies found between the Interview Results, the winner Full Answers artifact, and the PRD.',
    'Coverage Limits: Treat `coverage_run_number` and `max_coverage_passes` from the context as hard limits. Coverage can run once or at most `max_coverage_passes` times in total. If `is_final_coverage_run` is true, report unresolved gaps clearly without assuming another refinement pass exists.',
    'If no gaps exist, confirm that the PRD is complete and ready for PRD approval, and make clear that Beads breakdown begins only after that approval step.',
    'PRD Follow-Up Rule: `follow_up_questions` is always `[]` for PRD coverage. Do not invent new PRD questions; use `gaps` only.',
    'Audit-Only Contract: This prompt only audits the current PRD candidate. Do not rewrite the PRD, propose changes, or include resolution notes in this response.',
    'Output Envelope: return only YAML with top-level `status`, `gaps`, and `follow_up_questions`.',
    'YAML Validity: Every item in `gaps` must be a double-quoted YAML string, even when the text contains code identifiers, paths, flags, backticks, or punctuation.',
    'Gap Triggering: Use `status: gaps` only when at least one real unresolved gap remains. For PRD coverage, `follow_up_questions` should normally be an empty list. Use `status: gaps` plus concrete `gaps` entries to trigger another refinement pass.',
    'Do not output a rewritten PRD, PRD patch, or any extra keys.',
    STRUCTURED_SELF_CHECK,
  ],
  outputFormat: `${COVERAGE_OUTPUT_FORMAT} For PRD coverage, \`follow_up_questions\` must always be \`[]\`.`,
  contextInputs: ['interview', 'full_answers', 'prd'],
  toolPolicy: 'disabled',
}

export const PROM13b: PromptTemplate = {
  id: 'PROM13b',
  description: 'PRD Coverage Resolution Prompt',
  systemRole: 'You are a meticulous Technical Product Manager resolving concrete PRD coverage gaps.',
  task: 'Revise the current PRD candidate to address the provided coverage gaps while preserving the candidate as the baseline. Return one updated PRD artifact plus machine-readable change and gap-resolution metadata.',
  instructions: [
    'Primary Truth: Treat the approved Interview Results as primary user truth. Use the winner Full Answers artifact only as adopted context for skipped questions.',
    'Baseline Rule: Treat the provided current PRD candidate as the baseline. Do not rewrite from scratch.',
    'Gap Resolution Rule: Address only the concrete coverage gaps provided in the context. Do not make unrelated improvements.',
    'Preservation Rule: Keep existing epic IDs and user story IDs unless the revised candidate requires a genuinely new item.',
    'Epic Completeness: Every epic in the revised PRD must include at least one fully populated `user_stories` entry. Never leave an epic as a shell with `user_stories: []`, omit `user_stories`, or move story-level requirements only into epic-level fields.',
    'Change Accounting: Include a top-level `changes` list that fully and exactly accounts for the diff between the current PRD candidate and the revised PRD candidate.',
    'Gap Resolution Accounting: Include a top-level `gap_resolutions` list with exactly one entry per provided gap.',
    'Gap Resolution Actions: Each `gap_resolutions` entry must include `gap`, `action`, `rationale`, and `affected_items`. `action` must be one of `updated_prd`, `already_covered`, or `left_unresolved`.',
    'Affected Items: `affected_items` must be a YAML list of `{ item_type, id, label }` entries referencing epic or user_story items. Use an empty list when no epic/story reference applies.',
    'Output Discipline: Return only one PRD YAML artifact using the normal PRD schema, plus top-level `changes` and `gap_resolutions`. Do not add wrappers or prose.',
    STRUCTURED_SELF_CHECK,
  ],
  outputFormat: `${PRD_OUTPUT_FORMAT}\nAlso include top-level \`changes\` and \`gap_resolutions\` lists. \`changes\` uses the same shape as PROM12 refinement output. Each \`gap_resolutions\` item: {gap, action, rationale, affected_items}. \`action\` must be one of {updated_prd, already_covered, left_unresolved}. Each \`affected_items\` entry: {item_type, id, label}.`,
  contextInputs: ['interview', 'full_answers', 'prd', 'coverage_gaps'],
  toolPolicy: 'disabled',
}

// Beads Phase Prompts
export const PROM20: PromptTemplate = {
  id: 'PROM20',
  description: 'Beads Draft Specification Prompt',
  systemRole: 'You are an expert Software Architect.',
  task: 'Create a Beads breakdown (architecture/task graph) based on the final PRD.',
  instructions: [
    'Decomposition: Split each user story into one or more beads using phased modular decomposition appropriate to the feature domain (e.g., input capture → normalization/validation → core domain logic → integration/adapters → output/presentation) to keep flow logical and dependencies minimal.',
    'Granularity: Each bead must be the smallest independently-completable unit of work — small enough that a single AI agent call can implement it with its defined tests, but complete enough to be meaningful. If a bead requires touching too many files or concepts, split it further.',
    `Draft Bead Structure: Each bead in this draft phase must include only the following subset of fields (the remaining fields will be added in a later expansion step):
  - id — a concise, descriptive kebab-case identifier unique across all beads (e.g., "setup-db-schema", "user-auth-middleware"). These draft IDs will be replaced with hierarchical IDs in the expansion step.
  - title — short task name.
  - prdRefs — list of PRD epic and user-story IDs this bead maps to (e.g., EPIC-1, US-1-1). If there are multiple beads in a user story, each bead references the same story.
  - description — detailed technical implementation steps for this specific bead only.
  - contextGuidance — an object with two keys: \`patterns\` (specific patterns to follow copied from the PRD/Architecture, e.g., "Use the AppError class for exceptions", "Follow the Container/Presenter pattern defined in src/components") and \`anti_patterns\` (approaches to avoid for this task, e.g., "Do not use alert() for error display").
  - acceptanceCriteria — human-readable definitions of done for this bead.
  - tests — bead-scoped tests (targeted unit/integration tests for this bead only, not the full suite).
  - testCommands — exact commands to run the bead-scoped tests.`,
    'Context Guidance Contract: Write `contextGuidance` as an object with an explicit `patterns` list and an explicit `anti_patterns` list. Each must contain at least one entry. If the structure risks becoming too long, shorten the prose in those lists instead of dropping later beads.',
    'Dependency Ordering: List beads in dependency order — if bead B depends on bead A, A must appear before B. Do not create circular dependencies or self-references.',
    'PRD Coverage: Every in-scope PRD requirement must map to at least one bead. Each bead\'s `prdRefs` must reference valid PRD epic or user-story IDs (e.g., EPIC-1, US-1-1).',
    'Test Specificity: Each bead\'s `tests` must verify that bead alone — not the entire feature. Each bead must have at least one entry in `testCommands` with the exact command to run.',
    'Single Response Completeness: Return one complete final `beads` list in a single response. Do not stop mid-list or emit partial subsets.',
    'Length Safety: If total output risks being cut off, shorten description text instead of omitting later beads. Every planned bead must appear in the output.',
    'Strict Output: Do not add wrappers, markdown fences, prose, or trailing commentary. Begin at `beads:` and end after the final bead item.',
    'Boundary Rule: Begin output at the `beads:` key. End after the last bead item. No prose, markdown fences, or commentary before or after the YAML.',
    STRUCTURED_SELF_CHECK,
  ],
  outputFormat: BEAD_SUBSET_OUTPUT_FORMAT,
  contextInputs: ['relevant_files', 'ticket_details', 'prd'],
  toolPolicy: 'disabled',
}

export const PROM21: PromptTemplate = {
  id: 'PROM21',
  description: 'Beads Council Voting Prompt',
  systemRole: 'You are an impartial judge on an AI Council. Your role is to evaluate multiple Beads breakdown (architecture/task) drafts objectively.',
  task: 'Read all provided Beads drafts, compare each draft against the final PRD, and evaluate them against each other. Rate each draft from 0 to 100.',
  instructions: [
    'Impartiality: Rate impartially as if all drafts are anonymous. Do not favor any draft based on its origin or style.',
    'Anti-anchoring: Drafts are presented in randomized order per evaluator. Do not assume the first draft is the baseline or best.',
    'Decomposition Interpretation: Different architectural approaches to the same PRD may legitimately vary in granularity, dependency handling, and sequencing. Score the decomposition quality, coverage, and test isolation as presented, not the identity of the architect.',
    'Scoring Rubric (minimum 0, maximum 20 points per category, total maximum 100): 1) Coverage of PRD requirements. 2) Correctness / feasibility of technical approach. 3) Quality and isolation of bead-scoped tests. 4) Minimal complexity / good dependency management. 5) Risks / edge cases addressed.',
    buildStrictVoteOutputInstruction(VOTING_RUBRIC_BEADS.map(item => item.category)),
    STRUCTURED_SELF_CHECK,
  ],
  outputFormat: STRICT_VOTE_OUTPUT_FORMAT,
  contextInputs: ['relevant_files', 'ticket_details', 'prd', 'drafts'],
  toolPolicy: 'disabled',
}

export const PROM22: PromptTemplate = {
  id: 'PROM22',
  description: 'Beads Winner Refinement Prompt',
  systemRole: "You are the Lead Architect and the winner of the AI Council's Beads drafting phase.",
  task: 'Create the final, definitive version of your Beads breakdown by reviewing the alternative (losing) drafts.',
  instructions: [
    'Anchor on the winning draft. It won because its decomposition, dependency graph, and test coverage are the best starting point. Preserve its strengths, but do not treat its exact wording or every individual bead as untouchable.',
    'Gap Scan: Read through the alternative drafts and note anything they cover that your draft does not: work units you missed, edge cases or error paths you omitted, test scenarios that are more precise than yours, or dependency edges you overlooked. These are candidates — not automatic additions.',
    'Selective Upgrade: For each candidate, decide: does it add genuine value, or is it a variation of something you already cover well? If it fills a real gap, add the bead. If an alternative has a strictly better definition of one of your existing beads — tighter scope, better tests, cleaner dependencies — replace yours with it. Otherwise, discard it.',
    'Measured Refinement: Do not rewrite from scratch or blend drafts together just for balance. But it is acceptable to improve multiple beads, adjust dependency edges, or rework test strategies across the draft if that produces a clearly stronger final result.',
    'Restraint: Avoid adding beads that merely restate work already covered by an existing bead. But if genuine gaps exist — missing work units, uncovered error paths, overlooked dependencies — add them; a complete graph matters more than a short one.',
    'Single Artifact Contract: Return one YAML artifact that contains both the final refined Beads breakdown and a top-level `changes` list. Do not split the refined beads and change metadata across multiple outputs, wrappers, or separate artifacts.',
    'Changes Coverage: The top-level `changes` list must fully account for the differences between the winning bead subset and the final refined bead subset. Use `type` values `modified`, `added`, or `removed`. Include `item_type: bead` plus `before` and `after` bead item records (or `null` when appropriate).',
    'One-Entry-Per-Item Rule: Every changed bead must appear exactly once in `changes`. If an existing bead keeps the same ID but its content changes, emit exactly one `modified` entry for that bead. Do not split one changed bead across multiple change entries.',
    'Optional Inspiration Attribution: When a change was directly inspired by an alternative draft, include `inspiration` with `alternative_draft` and the inspiring `item`. Include `inspiration.item.detail` whenever the source item has useful supporting text (for example description, acceptance, tests, or dependency detail). If a change was not directly inspired by a losing draft, omit `inspiration` or set it to null.',
    'ID Stability: Preserve existing bead IDs from the winning draft unless you are adding a genuinely new bead. Do not renumber for neatness.',
    'Formatting: Output only this single refined Beads artifact with its top-level `changes` list.',
    'Schema Preservation: keep the same bead subset schema and output a single top-level `beads` list. Do not wrap it in prose or additional objects.',
    BEADS_ORDER_PRESERVATION_RULE,
    STRUCTURED_SELF_CHECK,
  ],
  outputFormat: `${BEAD_SUBSET_OUTPUT_FORMAT} Also include a top-level \`changes\` list. Each change item: {type, item_type, before, after, inspiration?}. \`type\` must be one of {modified, added, removed}. \`item_type\` must be \`bead\`. \`before\` and \`after\` use {id, label, detail?} or null when appropriate. Optional \`inspiration\` uses {alternative_draft, item}. Keep everything in one YAML artifact.`,
  contextInputs: ['relevant_files', 'ticket_details', 'prd', 'drafts', 'votes'],
  toolPolicy: 'disabled',
}

export const PROM23: PromptTemplate = {
  id: 'PROM23',
  description: 'Beads Coverage Verification Prompt',
  systemRole: 'You are a meticulous Quality Assurance Lead.',
  task: 'Re-read the final PRD as the source of truth and compare it against the current Beads blueprint to ensure complete coverage before execution planning is finalized.',
  instructions: [
    'Primary Truth: Treat the approved PRD as the sole source of truth for this audit. Every in-scope PRD requirement must be traceable to at least one bead.',
    'Coverage Check: Detect uncovered PRD requirements, oversized beads, vague work splits, missing verification steps, empty or insufficient acceptance criteria, missing test commands, and beads with no `prdRefs` mapping.',
    'Identify Gaps: List any specific gaps or discrepancies found between the PRD and the Beads breakdown.',
    'Coverage Limits: Treat `coverage_run_number` and `max_coverage_passes` from the context as hard limits. Coverage can run once or at most `max_coverage_passes` times in total. If `is_final_coverage_run` is true, report unresolved gaps clearly without assuming another refinement pass exists.',
    'If no gaps exist, confirm that the Beads blueprint is complete and ready for the final expansion step.',
    'Audit-Only Contract: This prompt only audits the current Beads blueprint. Do not rewrite beads, propose changes, or include resolution notes in this response.',
    'Output Envelope: return only YAML with top-level `status`, `gaps`, and `follow_up_questions`.',
    'Beads Follow-Up Rule: `follow_up_questions` is always `[]` for beads coverage. Beads coverage has no user interaction; use `gaps` only.',
    'YAML Validity: Every item in `gaps` must be a double-quoted YAML string, even when the text contains code identifiers, paths, flags, backticks, or punctuation.',
    'Gap Triggering: Use `status: gaps` only when at least one real unresolved gap remains. Use concrete `gaps` entries to trigger another refinement pass. Do not flag stylistic preferences or minor wording differences as gaps.',
    'Do not output a rewritten Beads blueprint, beads patch, or any extra keys.',
    STRUCTURED_SELF_CHECK,
  ],
  outputFormat: `${COVERAGE_OUTPUT_FORMAT} For beads coverage, \`follow_up_questions\` must always be \`[]\`.`,
  contextInputs: ['prd', 'beads'],
  toolPolicy: 'disabled',
}

export const PROM24: PromptTemplate = {
  id: 'PROM24',
  description: 'Beads Coverage Resolution Prompt',
  systemRole: 'You are a meticulous Technical Lead resolving concrete implementation-plan coverage gaps.',
  task: 'Revise the current Beads blueprint to address the provided coverage gaps while preserving the current blueprint as the baseline. Return one updated semantic Beads artifact plus machine-readable change and gap-resolution metadata.',
  instructions: [
    'Primary Truth: Treat the approved PRD as the source of truth.',
    'Baseline Rule: Treat the provided current implementation plan as the baseline. Do not rewrite from scratch.',
    'Gap Resolution Rule: Address only the concrete coverage gaps provided in the context. Do not make unrelated improvements.',
    'Preservation Rule: Keep the existing bead order, IDs, and unaffected fields unless a provided gap requires a concrete change. If you add a new bead, insert it at the minimal valid position that preserves dependency order.',
    'Bead Completeness: Every bead in the revised blueprint must include non-empty `acceptanceCriteria`, `tests`, and `testCommands`. Never leave a bead as a shell with empty verification fields.',
    'Semantic Blueprint Rule: Return semantic Part 1 bead records only. Each bead must include exactly the Beads blueprint fields: `id`, `title`, `prdRefs`, `description`, `contextGuidance`, `acceptanceCriteria`, `tests`, and `testCommands`.',
    'Change Accounting: Include a top-level `changes` list that fully and exactly accounts for the diff between the current Beads candidate and the revised Beads candidate. Each entry must include `type` (added|removed|modified), `id`, `title`, and `summary`.',
    'Gap Resolution Accounting: Include a top-level `gap_resolutions` list with exactly one entry per provided gap.',
    'Gap Resolution Actions: Each `gap_resolutions` entry must include `gap`, `action`, `rationale`, and `affected_items`. `action` must be one of `updated_beads`, `already_covered`, or `left_unresolved`.',
    'Affected Items: `affected_items` must be a YAML list of `{ item_type, id, label }` entries referencing bead items. Use an empty list when no bead mapping applies.',
    'Output Discipline: Return only one YAML artifact with a top-level `beads` list plus top-level `changes` and `gap_resolutions`. Do not add wrappers or prose.',
    STRUCTURED_SELF_CHECK,
  ],
  outputFormat: `${BEAD_SUBSET_OUTPUT_FORMAT} Also include a top-level \`changes\` list and a top-level \`gap_resolutions\` list. Each \`changes\` item: {type, id, title, summary}. \`type\` must be one of {added, removed, modified}. Each \`gap_resolutions\` item: {gap, action, rationale, affected_items}. \`action\` must be one of {updated_beads, already_covered, left_unresolved}. Each \`affected_items\` entry: {item_type, id, label}, where \`item_type\` must be \`bead\`.`,
  contextInputs: ['prd', 'beads', 'coverage_gaps'],
  toolPolicy: 'disabled',
}

export const PROM25: PromptTemplate = {
  id: 'PROM25',
  description: 'Beads Semantic Expansion Prompt',
  systemRole: "You are the Lead Architect and the winner of the AI Council's Beads phase.",
  task: 'Take the latest validated Beads blueprint and expand each bead into the final execution-ready Beads list by adding only the AI-owned fields.',
  instructions: [
    'Fresh Context Contract: This prompt includes only the approved final PRD, the latest validated blueprint, ticket details, and `relevant_files`. Use this refreshed context as your full working set; do not assume any prior conversation state.',
    'Expansion Only: Preserve these Part 1 fields exactly for every bead: `title`, `prdRefs`, `description`, `contextGuidance`, `acceptanceCriteria`, `tests`, and `testCommands`.',
    'Order Is Mandatory: Preserve bead list order exactly. The app executes beads sequentially in this order and derives `priority` from this order. Do not reorder, merge, split, add, or remove beads.',
    'AI-Owned Fields Only: Add only these fields per bead: `id`, `issueType`, `labels`, `dependencies.blocked_by`, and `targetFiles`.',
    'Mechanical Copy Rule: For each bead, start from the matching bead in `### beads_draft`, mechanically copy every preserved Part 1 field byte-for-byte, then replace only `id`, `issueType`, `labels`, `dependencies.blocked_by`, and `targetFiles`.',
    'LoopTroop-Owned Fields: Do not generate or rely on `priority`, `status`, `externalRef`, `dependencies.blocks`, `notes`, `iteration`, `createdAt`, `updatedAt`, `completedAt`, `startedAt`, or `beadStartCommit`. LoopTroop will create those.',
    'ID Contract: Generate a unique, stable, readable bead `id` for each bead. Hierarchical IDs are allowed when useful, but keep them concise and execution-friendly.',
    'Dependency Contract: `dependencies.blocked_by` may reference only earlier beads in the existing list order. No self-dependencies. No forward references. Keep the graph acyclic.',
    'Labels: Provide concise, useful labels grounded in the PRD and the refined blueprint. Include epic/story/ticket/domain labels when they are well supported by the provided context.',
    'Target Files: Use `relevant_files` first as hints for likely `targetFiles`. Prefer those hints when they are already sufficient. Use repository-inspection tools only when the hints are insufficient or need confirmation. Return only minimal project-relative file paths that the bead is most likely to touch.',
    'Tool Policy: Repository-inspection tools are allowed. You may read files and inspect the tree. Do not edit files, run mutating commands, or change the repository.',
    'Output Discipline: output JSONL only. No surrounding array. No markdown fences. No prose before or after the JSONL.',
    'Expansion Self-Check: Before responding, verify that every preserved Part 1 field is byte-for-byte identical to the matching bead in `### beads_draft`; only the five AI-owned fields may differ.',
    STRUCTURED_SELF_CHECK,
  ],
  outputFormat: BEADS_JSONL_OUTPUT_FORMAT,
  contextInputs: ['relevant_files', 'ticket_details', 'prd', 'beads_draft'],
  toolPolicy: 'default',
}

// Execution Prompts
export const PROM_CODING: PromptTemplate = {
  id: 'PROM_CODING',
  description: 'Bead Implementation Prompt — guides the AI implementer through executing a single bead',
  systemRole: 'You are an expert AI implementer executing a specific implementation task (bead) within a larger ticket. You have full tool access to read, write, and run commands in the worktree.',
  task: 'Implement the active bead requirements in the worktree, pass all quality gates (tests, lint, typecheck, qualitative review), and output a structured completion marker.',
  instructions: [
    'Read and Understand: Read the bead specification from the context — including description, acceptance criteria, target files, and test commands. The `bead_data` and `active_bead` context sections identify which bead you are implementing.',
    'Check Prior Notes: If bead notes exist from prior iteration failures, carefully read them and avoid repeating the same mistakes. These notes describe what went wrong previously and what to do differently.',
    'Implement Changes: Make the necessary code changes in the worktree to fulfill the bead requirements. Follow existing code patterns and conventions in the project.',
    'Run Tests: Execute the bead\'s test commands and fix any test failures before proceeding.',
    'Run Lint & Typecheck: Run the project\'s lint and typecheck commands. Fix any errors introduced by your changes.',
    'Self-Verify Quality: Review each acceptance criterion and confirm the implementation satisfies it qualitatively. Check edge cases and error handling.',
    `Completion Marker:\n${buildCompletionInstructions()}`,
    'Output Discipline: Return exactly one <BEAD_STATUS>...</BEAD_STATUS> block as the final output marker. Inside the marker, return only the machine-readable JSON object. No markdown fences, commentary, or wrapper keys.',
    STRUCTURED_SELF_CHECK,
  ],
  outputFormat: 'JSON inside <BEAD_STATUS>...</BEAD_STATUS> tags with bead_id, status, checks (tests, lint, typecheck, qualitative), and optional reason',
  contextInputs: ['bead_data', 'bead_notes'],
  toolPolicy: 'default',
}

export const PROM51: PromptTemplate = {
  id: 'PROM51',
  description: 'Context Wipe Note Summary Prompt',
  systemRole: 'You are a concise technical analyst summarizing a failed implementation attempt.',
  task: "Generate a short, actionable summary of what was attempted and what errors were encountered during this bead iteration, to be appended to the bead's Notes section for the next attempt.",
  instructions: [
    'Summarize Attempt: Describe what implementation approach was taken and what code changes were made during this iteration.',
    'Document Errors: List the specific errors encountered during linting, testing, or execution.',
    'Extract Lessons: Identify what should be avoided or done differently in the next attempt.',
    'Keep it Concise: Only include information that will help the next iteration succeed.',
  ],
  outputFormat: 'Plain text — append-only note for the bead Notes field',
  contextInputs: ['bead_data', 'error_context'],
  toolPolicy: 'default',
}

export const PROM52: PromptTemplate = {
  id: 'PROM52',
  description: 'Final Test Generation Prompt',
  systemRole: 'You are an expert QA Engineer and the main implementer who has just finished implementing a ticket from end to end.',
  task: 'Design and implement a comprehensive final test (or test suite) that validates the entire ticket was implemented correctly.',
  instructions: [
    'Review Scope: Re-read the ticket details, Interview Results, PRD, and Beads list to understand the full scope.',
    'Test Design: Design the minimal but sufficient set of tests that collectively prove the ticket requirements are met.',
    'Coverage Priorities: Focus on: (1) all acceptance criteria from PRD user stories; (2) critical user flows from Interview Results; (3) key edge cases and error states.',
    "Test Type: Prefer integration or end-to-end tests that exercise real code paths. Use the project's existing testing framework.",
    'Determinism: Tests must be deterministic and repeatable.',
    'Test Commands: Provide the exact commands to run the final test(s).',
    'Command Marker: End your response with `<FINAL_TEST_COMMANDS>{"commands":["<cmd1>","<cmd2>"],"summary":"short explanation"}</FINAL_TEST_COMMANDS>`.',
    'Output Discipline: Return exactly one `<FINAL_TEST_COMMANDS>...</FINAL_TEST_COMMANDS>` block and nothing else outside it. Inside the marker, return only the machine-readable object with a non-empty `commands` field.',
    'Do not claim the tests passed yourself. LoopTroop will execute the commands and determine pass/fail from the real exit codes.',
    'Failure Handling: If you added or updated tests, include only the commands needed to verify the final implementation state.',
    STRUCTURED_SELF_CHECK,
  ],
  outputFormat: 'Test file(s) + execution commands',
  contextInputs: ['ticket_details', 'interview', 'prd', 'beads'],
  toolPolicy: 'default',
}

// Helper to build full prompt from template
export function buildPromptFromTemplate(
  template: PromptTemplate,
  contextParts: PromptPart[],
): string {
  return [
    GLOBAL_RULES,
    '',
    `## System Role`,
    template.systemRole,
    '',
    `## Task`,
    template.task,
    '',
    `## Instructions`,
    ...template.instructions.map((step, i) => `${i + 1}. ${step}`),
    '',
    `## Expected Output Format`,
    template.outputFormat,
    '',
    `## Context`,
    ...contextParts.map((p) => `### ${p.source ?? p.type}\n${p.content}`),
  ].join('\n')
}

// Helper to build a conversational (multi-turn) prompt from template
export function buildConversationalPrompt(
  template: PromptTemplate,
  contextParts: PromptPart[],
): string {
  return [
    CONVERSATIONAL_RULES,
    '',
    `## System Role`,
    template.systemRole,
    '',
    `## Task`,
    template.task,
    '',
    `## Instructions`,
    ...template.instructions.map((step, i) => `${i + 1}. ${step}`),
    '',
    `## Expected Output Format`,
    template.outputFormat,
    '',
    `## Context`,
    ...contextParts.map((p) => `### ${p.source ?? p.type}\n${p.content}`),
  ].join('\n')
}

export const ALL_PROMPTS = {
  PROM0,
  PROM1,
  PROM2,
  PROM3,
  PROM4,
  PROM5,
  PROM10a,
  PROM10b,
  PROM11,
  PROM12,
  PROM13,
  PROM13b,
  PROM20,
  PROM21,
  PROM22,
  PROM23,
  PROM24,
  PROM25,
  PROM_CODING,
  PROM51,
  PROM52,
}
