import type { PromptPart } from '../opencode/types'
import { VOTING_RUBRIC_BEADS, VOTING_RUBRIC_INTERVIEW, VOTING_RUBRIC_PRD } from '../council/types'
import { GLOBAL_RULES, CONVERSATIONAL_RULES } from './globalRules'

interface PromptTemplate {
  id: string
  description: string
  systemRole: string
  task: string
  instructions: string[]
  outputFormat: string
  contextInputs: string[]
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
const BEAD_SUBSET_OUTPUT_FORMAT = 'YAML with top-level `beads` list. Each bead item must include exactly: `id`, `title`, `prdRefs`, `description`, `contextGuidance`, `acceptanceCriteria`, `tests`, `testCommands`.'
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
    'Change Tracking: Output a required top-level `changes` list alongside the final `questions` list. Each `changes` item MUST include exactly four fields: `type`, `before`, `after`, and `inspiration`.',
    'Change Semantics: Use `type: modified` when the same underlying question was kept but its wording or scope was improved. Use `type: replaced` when a previous question was discarded and a different question took its place. Use `type: added` when a new question has no predecessor. Use `type: removed` when a winning-draft question was dropped with no replacement.',
    'Change Records: `before` and `after` must each be either `null` or an object with exactly `id`, `phase`, and `question`. For `modified` and `replaced`, both `before` and `after` are required. For `added`, use `before: null`. For `removed`, use `after: null`. If there are no differences, output `changes: []`.',
    'Inspiration Tracking: For each change with type `modified`, `replaced`, or `added`, include an `inspiration` field with `{alternative_draft, question}` where `alternative_draft` is the 1-based index of the Alternative Draft that inspired the change and `question` is the exact `{id, phase, question}` object from that draft. If the change was purely editorial and not inspired by any alternative draft, use `inspiration: null`. For `removed` changes, always use `inspiration: null`.',
    'ID Stability: Preserve the winning draft\'s existing `id` for every question that still exists in the final draft, even if its wording improves or its position moves. Do not renumber surviving questions for neatness. Assign fresh IDs only to genuinely new questions, using new numeric IDs above the current maximum winner-draft ID.',
    'Diff Coverage: The `changes` list must fully account for the exact record-level diff between the winning `questions` list and the final `questions` list. Compare by exact `{id, phase, question}` records. Unchanged records must not appear in `changes`. Every winning-draft record missing from the final list must appear exactly once in `before`, and every final record not present in the winning draft must appear exactly once in `after`.',
    INTERVIEW_PHASE_ORDER_RULE,
    'Formatting: Output the final refined draft using the exact same structural format required for this phase. Output only the final artifact.',
    STRUCTURED_SELF_CHECK,
  ],
  outputFormat: 'YAML with exactly two top-level keys: `questions` and `changes`. `questions` must match the PROM1 question list schema. `changes` must be a list of `{type, before, after, inspiration}` where `type` is one of `modified`, `replaced`, `added`, `removed`; `before`/`after` are either null or `{id, phase, question}`; `inspiration` is either null or `{alternative_draft, question}` where `alternative_draft` is the 1-based integer index of the inspiring Alternative Draft and `question` is `{id, phase, question}`.',
  contextInputs: ['relevant_files', 'ticket_details', 'drafts'],
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
    "Final Free-Form Question: Do not move to the final free-form question just because coverage feels good enough. First work through or explicitly account for the remaining compiled questions, including future compiled questions made unnecessary by earlier answers, and only after the compiled checklist has been answered, skipped, or rendered redundant and no major ambiguity remains, present one final free-form question: 'Anything else to add before PRD generation?'",
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
    'If no gaps exist, confirm that the Interview Results are complete and ready for PRD generation.',
    'Output Envelope: return only YAML with top-level `status`, `gaps`, and `follow_up_questions`.',
    'YAML Validity: Every item in `gaps` must be a double-quoted YAML string, even when the text contains code identifiers, paths, flags, backticks, or punctuation.',
    `Gap Triggering: Use \`status: gaps\` only when at least one real unresolved gap remains. When \`status: gaps\`, \`follow_up_questions\` must be a YAML list of question objects with these fields: \`id\`, \`question\`, \`phase\`, \`priority\`, \`rationale\`, and \`answer_type\` (REQUIRED — choose the best type for each question: "free_text" for open-ended, "single_choice" for mutually-exclusive finite sets with 2-10 options, "multiple_choice" for select-all-that-apply with 2-15 options, "yes_no" for simple boolean questions without options). When answer_type is single_choice or multiple_choice, include an \`options\` list with \`id\` and \`label\` fields. Do not return plain strings in \`follow_up_questions\`.`,
    'Do not output rewritten interview results, summaries, or any extra keys.',
    STRUCTURED_SELF_CHECK,
  ],
  outputFormat: INTERVIEW_COVERAGE_OUTPUT_FORMAT,
  contextInputs: ['ticket_details', 'user_answers', 'interview'],
}

// PRD Phase Prompts
export const PROM09D: PromptTemplate = {
  id: 'PROM09D',
  description: 'PRD Gap Resolution Prompt',
  systemRole: 'You are an expert Technical Product Manager and Software Architect.',
  task: 'Fill every skipped answer in the approved Interview Results and output one complete Full Answers interview artifact that preserves the original approved interview structure.',
  instructions: [
    'Source Of Truth: Treat the provided approved Interview Results as canonical for question order, IDs, prompts, phases, options, source metadata, and every non-skipped user answer.',
    'Preservation Rule: Preserve every existing non-skipped answer exactly as-is. Do not rewrite, summarize, or improve user-provided answers.',
    'Allowed Edits Only: The only fields you may change are `questions[*].answer` for questions whose current answer is marked `skipped: true`.',
    'Forbidden Edits: Do not change question IDs, question order, prompts, phases, `answer_type`, `options`, `follow_up_rounds`, `summary`, approval fields, or any existing non-skipped answer.',
    'Gap Resolution Rule: Fill only the questions whose current answer is marked `skipped: true`. Use the ticket details, relevant files, and the rest of the interview to infer the strongest concrete answer.',
    'Answer Encoding: For every filled skipped question, set `answer.skipped: false`, provide a concrete `free_text` and/or `selected_option_ids` consistent with the question `answer_type`, set `answered_by: ai_skip`, and set a non-empty ISO-8601 `answered_at` timestamp.',
    'Artifact Status: Output the completed interview artifact as `status: draft` with empty approval fields, because these AI-filled answers are not user-approved.',
    'Self-Check: Before responding, verify that the output contains the exact same number of questions and the exact same canonical question IDs as the approved interview artifact.',
    'Output Discipline: Return exactly one complete interview artifact and nothing else. No prose, no PRD content, no wrappers, no markdown fences, and no extra keys.',
    STRUCTURED_SELF_CHECK,
  ],
  outputFormat: PROM4_FINAL_INTERVIEW_SCHEMA,
  contextInputs: ['relevant_files', 'ticket_details', 'interview'],
}

export const PROM10: PromptTemplate = {
  id: 'PROM10',
  description: 'PRD Draft Specification Prompt',
  systemRole: 'You are an expert Technical Product Manager and Software Architect.',
  task: 'Generate a complete Product Requirements Document (PRD) based on the provided Full Answers interview artifact. The PRD must be detailed enough that an AI coding agent can implement the feature without ambiguity.',
  instructions: [
    'Complete Interview Input: Treat the provided Full Answers interview artifact as the complete requirement source, including any AI-resolved answers for questions the user originally skipped.',
    'Product Scope: Include epics, user stories, and acceptance criteria. Every in-scope feature from the Interview Results must map to at least one user story.',
    'Implementation Steps: For each user story, include detailed technical implementation steps decomposed as far as possible — data flows, state changes, component interactions, and integration points.',
    'Technical Requirements: Define architecture constraints, data model, API/contracts, security/performance/reliability constraints, error-handling rules, tooling/environment assumptions, explicit non-goals.',
    'Schema Contract: Follow the exact PRD YAML schema in the Expected Output Format section, including all required top-level keys and nested fields.',
    'Output Format: Output a single, comprehensive PRD document covering all of the above in one artifact.',
    STRUCTURED_SELF_CHECK,
  ],
  outputFormat: PRD_OUTPUT_FORMAT,
  contextInputs: ['relevant_files', 'ticket_details', 'full_answers'],
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
    'Formatting: Output the final refined PRD followed by the `changes` list. Output only the final artifact plus the changes.',
    'Schema Preservation: keep the same PRD schema, required top-level sections, and nested field structure. Do not wrap the PRD in another object. The `changes` key is the only addition to the top-level keys.',
    'ID Stability: Preserve existing epic IDs and user story IDs from the winning draft unless you are adding a genuinely new epic or story.',
    'Change Tracking: Output a required top-level `changes` list alongside the PRD document. Each entry MUST include: `type`, `item_type`, `before`, `after`, and `inspiration`.',
    'Change Semantics: Use `type: modified` when an existing epic or user story was improved. Use `type: added` when a new epic or user story was created. Use `type: removed` when an epic or user story was dropped.',
    'Change Records: `before` and `after` must each be either `null` or an object with `id` and `title`. For `modified`, both are required. For `added`, use `before: null`. For `removed`, use `after: null`. `item_type` is `epic` or `user_story`. If there are no differences, output `changes: []`.',
    'Inspiration Tracking: For each `modified` or `added` change, include `inspiration: {alternative_draft, item}` where `alternative_draft` is the 1-based index of the Alternative Draft and `item` is `{id, title}` from that draft. Use `inspiration: null` for purely editorial changes and `removed` changes.',
    'Diff Coverage: The `changes` list must fully account for the exact record-level diff between the winning draft and the final output. Compare by `{id, title}` records for epics and user stories. Unchanged records must not appear in `changes`. Every winning-draft record missing from the final list must appear exactly once in `before`, and every final record not present in the winning draft must appear exactly once in `after`.',
    STRUCTURED_SELF_CHECK,
  ],
  outputFormat: PRD_OUTPUT_FORMAT + ' Additionally, include a top-level `changes` list: `{type, item_type, before, after, inspiration}` where `type` is `modified`/`added`/`removed`; `item_type` is `epic` or `user_story`; `before`/`after` are null or `{id, title}`; `inspiration` is null or `{alternative_draft, item}` where `alternative_draft` is a 1-based integer and `item` is `{id, title}`.',
  contextInputs: ['relevant_files', 'ticket_details', 'full_answers', 'drafts'],
}

export const PROM13: PromptTemplate = {
  id: 'PROM13',
  description: 'PRD Coverage Verification Prompt',
  systemRole: 'You are a meticulous Quality Assurance Lead.',
  task: 'Re-read the approved Interview Results and the winner Full Answers artifact, then compare them against the final PRD to ensure complete coverage.',
  instructions: [
    'Primary Truth: Treat the approved Interview Results as primary user truth. Use the winner Full Answers artifact as the adopted completion for questions the user skipped.',
    'Coverage Check: Detect missing requirements, edge cases, constraints, and acceptance criteria.',
    'Identify Gaps: List any specific gaps or discrepancies found between the Interview Results, the winner Full Answers artifact, and the PRD.',
    'Coverage Limits: Treat `coverage_run_number` and `max_coverage_passes` from the context as hard limits. Coverage can run once or at most `max_coverage_passes` times in total. If `is_final_coverage_run` is true, report unresolved gaps clearly without assuming another refinement pass exists.',
    'Output Envelope: return only YAML with top-level `status`, `gaps`, and `follow_up_questions`.',
    'YAML Validity: Every item in `gaps` must be a double-quoted YAML string, even when the text contains code identifiers, paths, flags, backticks, or punctuation.',
    'Gap Triggering: For PRD coverage, `follow_up_questions` should normally be an empty list. Use `status: gaps` plus concrete `gaps` entries to trigger another refinement pass.',
    'Do not output a rewritten PRD, PRD patch, or any extra keys.',
    STRUCTURED_SELF_CHECK,
  ],
  outputFormat: COVERAGE_OUTPUT_FORMAT,
  contextInputs: ['interview', 'full_answers', 'prd'],
}

// Beads Phase Prompts
export const PROM20: PromptTemplate = {
  id: 'PROM20',
  description: 'Beads Draft Specification Prompt',
  systemRole: 'You are an expert Software Architect.',
  task: 'Create a Beads breakdown (architecture/task graph) based on the final PRD.',
  instructions: [
    'Decomposition: Split each user story into one or more beads using phased modular decomposition appropriate to the feature domain to keep flow logical and dependencies minimal.',
    'Granularity: Each bead must be the smallest independently-completable unit of work — small enough that a single AI agent call can implement it with its defined tests, but complete enough to be meaningful.',
    'Draft Bead Structure: Each bead in this draft phase must include only: id, Title, PRD references, Description, Context & Architectural Guidance (patterns + anti_patterns), Acceptance criteria, Bead-scoped tests, Test commands.',
    'Output Format: Output a structured Beads workspace definition containing all beads in dependency order.',
    STRUCTURED_SELF_CHECK,
  ],
  outputFormat: BEAD_SUBSET_OUTPUT_FORMAT,
  contextInputs: ['relevant_files', 'ticket_details', 'prd'],
}

export const PROM21: PromptTemplate = {
  id: 'PROM21',
  description: 'Beads Council Voting Prompt',
  systemRole: 'You are an impartial judge on an AI Council. Your role is to evaluate multiple Beads breakdown (architecture/task) drafts objectively.',
  task: 'Read all provided Beads drafts, compare each draft against the final PRD, and evaluate them against each other. Rate each draft from 0 to 100.',
  instructions: [
    'Impartiality: Rate impartially as if all drafts are anonymous.',
    'Anti-anchoring: Drafts are presented in randomized order per evaluator.',
    'Scoring Rubric (minimum 0, maximum 20 points per category, total maximum 100): 1) Coverage of PRD requirements. 2) Correctness / feasibility of technical approach. 3) Quality and isolation of bead-scoped tests. 4) Minimal complexity / good dependency management. 5) Risks / edge cases addressed.',
    buildStrictVoteOutputInstruction(VOTING_RUBRIC_BEADS.map(item => item.category)),
    STRUCTURED_SELF_CHECK,
  ],
  outputFormat: STRICT_VOTE_OUTPUT_FORMAT,
  contextInputs: ['relevant_files', 'ticket_details', 'prd', 'drafts'],
}

export const PROM22: PromptTemplate = {
  id: 'PROM22',
  description: 'Beads Winner Refinement Prompt',
  systemRole: "You are the Lead Architect and the winner of the AI Council's Beads drafting phase.",
  task: 'Create the final, definitive version of your Beads breakdown by reviewing the alternative (losing) drafts.',
  instructions: [
    'Your winning draft earned its position — its decomposition and dependency graph are sound. Now approach the alternatives with genuine curiosity: they may have caught things you missed.',
    'Gap Scan: Read through the alternative drafts and note anything they cover that your draft does not: work units you missed, edge cases or error paths you omitted, test scenarios that are more precise than yours, or dependency edges you overlooked. These are candidates — not automatic additions.',
    'Selective Upgrade: For each candidate, decide: does it add genuine value, or is it a variation of something you already cover well? If it fills a real gap, add the bead. If an alternative has a strictly better definition of one of your existing beads — tighter scope, better tests, cleaner dependencies — replace yours with it. Otherwise, discard it.',
    'Restraint: Avoid adding beads that merely restate work already covered by an existing bead. But if genuine gaps exist — missing work units, uncovered error paths, overlooked dependencies — add them; a complete graph matters more than a short one.',
    'Formatting: Output the final refined Beads breakdown followed by the `changes` list. Output only the final artifact plus the changes.',
    'Schema Preservation: keep the same bead subset schema and output two top-level keys: `beads` and `changes`. Do not wrap it in prose or additional objects.',
    'Change Tracking: Output a required top-level `changes` list alongside the `beads` list. Each entry MUST include: `type`, `before`, `after`, and `inspiration`.',
    'Change Semantics: Use `type: modified` when an existing bead was improved. Use `type: added` when a new bead was created. Use `type: removed` when a bead was dropped.',
    'Change Records: `before` and `after` must each be either `null` or an object with `id` and `title`. For `modified`, both are required. For `added`, use `before: null`. For `removed`, use `after: null`. If there are no differences, output `changes: []`.',
    'Inspiration Tracking: For each `modified` or `added` change, include `inspiration: {alternative_draft, bead}` where `alternative_draft` is the 1-based index of the Alternative Draft and `bead` is `{id, title}` from that draft. Use `inspiration: null` for purely editorial changes and `removed` changes.',
    STRUCTURED_SELF_CHECK,
  ],
  outputFormat: BEAD_SUBSET_OUTPUT_FORMAT + ' Additionally, include a top-level `changes` list: `{type, before, after, inspiration}` where `type` is `modified`/`added`/`removed`; `before`/`after` are null or `{id, title}`; `inspiration` is null or `{alternative_draft, bead}` where `alternative_draft` is a 1-based integer and `bead` is `{id, title}`.',
  contextInputs: ['relevant_files', 'ticket_details', 'prd', 'drafts', 'votes'],
}

export const PROM23: PromptTemplate = {
  id: 'PROM23',
  description: 'Beads Full Fields Expansion Prompt',
  systemRole: "You are the Lead Architect and the winner of the AI Council's Beads phase.",
  task: 'Take the refined Beads draft (subset fields) and create the final Beads breakdown by adding all remaining required fields per bead.',
  instructions: [
    'Expansion Fields: For each bead, add: ID (hierarchical + 4-char suffix hash), Priority (sequential order), Status (pending), Issue type, External reference, Labels, Dependencies (blocked_by + blocks arrays), Target files, Notes (empty), Iteration (1), Created at, Updated at, Completed at (empty), Started at (empty), Bead start commit (empty).',
    'Dependency Graph: Ensure all dependency edges are valid — no dangling references, no self-dependencies, no circular dependencies. Priority order should respect dependency ordering.',
    'Output Format: Output the complete final Beads breakdown with all 22 fields per bead, in dependency order. Output as JSONL.',
    'Output Discipline: output JSONL only. No surrounding array. No markdown fences. No prose before or after the JSONL.',
    STRUCTURED_SELF_CHECK,
  ],
  outputFormat: BEADS_JSONL_OUTPUT_FORMAT,
  contextInputs: ['relevant_files', 'ticket_details', 'prd', 'beads_draft'],
}

export const PROM24: PromptTemplate = {
  id: 'PROM24',
  description: 'Beads Coverage Verification Prompt',
  systemRole: 'You are a meticulous Quality Assurance Lead.',
  task: 'Re-read the final PRD as the source of truth and compare it against the Beads graph and tests to ensure complete coverage.',
  instructions: [
    'Coverage Check: Detect uncovered PRD requirements, missing dependency edges, oversized beads, and missing verification steps.',
    'Identify Gaps: List any specific gaps or discrepancies found between the PRD and the Beads breakdown.',
    'Coverage Limits: Treat `coverage_run_number` and `max_coverage_passes` from the context as hard limits. Coverage can run once or at most `max_coverage_passes` times in total. If `is_final_coverage_run` is true, report unresolved gaps clearly without assuming another refinement pass exists.',
    'Resolution: Use concrete gap strings to describe the additions or modifications still needed. Ensure each in-scope PRD requirement maps to at least one bead with explicit verification. If no gaps exist, confirm ready for Execution.',
    'Output Envelope: return YAML with `status`, `gaps`, and `follow_up_questions`. For beads coverage, `follow_up_questions` should usually be an empty list; use `status: gaps` plus concrete gap strings to trigger another refinement pass.',
    'YAML Validity: Every item in `gaps` must be a double-quoted YAML string, even when the text contains code identifiers, paths, flags, backticks, or punctuation.',
    STRUCTURED_SELF_CHECK,
  ],
  outputFormat: COVERAGE_OUTPUT_FORMAT,
  contextInputs: ['prd', 'beads', 'tests'],
}

// Execution Prompts
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
  PROM09D,
  PROM10,
  PROM11,
  PROM12,
  PROM13,
  PROM20,
  PROM21,
  PROM22,
  PROM23,
  PROM24,
  PROM51,
  PROM52,
}
