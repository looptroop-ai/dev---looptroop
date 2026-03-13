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
    'Question Limit: Treat `max_initial_questions` as a hard upper bound, but endeavor to approach that limit when doing so is necessary to remove ambiguity and ensure comprehensive requirements gathering. Ask only as many questions as are needed to remove meaningful ambiguity and gather enough detail for PRD generation; stop once additional questions would be redundant or low-value.',
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
  ],
  outputFormat: 'YAML with top-level `questions` list. Each item: {id, phase, question}. No other fields.',
  contextInputs: ['codebase_map', 'ticket_details'],
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
  ],
  outputFormat: STRICT_VOTE_OUTPUT_FORMAT,
  contextInputs: ['codebase_map', 'ticket_details', 'drafts'],
}

export const PROM3: PromptTemplate = {
  id: 'PROM3',
  description: 'Interview Winner Refinement Prompt',
  systemRole: "You are the Lead Product Manager and the winner of the AI Council's interview drafting phase.",
  task: 'Create the final, definitive version of your interview questions by reviewing the alternative (losing) drafts. Extract any superior questions, missing edge cases, or better flow they contain, and integrate them seamlessly into your winning foundation.',
  instructions: [
    'Your winning draft earned its position — its structure and core decisions are sound. Now approach the alternatives with genuine curiosity: they may have caught things you missed.',
    'Gap Scan: Read through the alternative drafts and note anything they cover that your draft does not: topics you skipped, edge cases you missed, or questions that are unambiguously clearer or more precise than yours. These are candidates — not automatic additions.',
    'Selective Upgrade: For each candidate, decide: does it add genuine value, or is it a variation of something you already cover well? If it fills a real gap, add it. If it is a strictly better phrasing of one of your existing questions, replace yours with it. Otherwise, discard it.',
    'Restraint: Avoid appending near-duplicate questions that merely rephrase something you already cover. But if genuine gaps exist — topics missed, edge cases overlooked — fill them; `max_initial_questions` is a ceiling, not a target to stay away from, but never pass it',
    'Formatting: Output the final refined draft using the exact same structural format required for this phase. Output only the final artifact.',
  ],
  outputFormat: 'YAML — same question list format as PROM1 output, matching PROM5.output_file questions schema',
  contextInputs: ['codebase_map', 'ticket_details', 'drafts'],
}

export const PROM4: PromptTemplate = {
  id: 'PROM4',
  description: 'Interview Batch Question Prompt',
  systemRole: 'You are an expert product manager conducting an interview with a user.',
  task: "Review the user's answers to questions and adjust the upcoming ones to improve coherence and extract missing details.",
  instructions: [
    'Batching and Progress: Present the first batch of 1-3 questions (you choose batch size based on complexity/relatedness), show progress (e.g., question 12 of the current planned set, where the total may change), and wait for the user to answer all questions in that batch.',
    'Adaptive Iteration: After each batch, analyze answers and adjust only upcoming questions when needed. Add follow-up questions only when they are necessary to resolve meaningful ambiguities (max follow-ups in total: 20% of `max_initial_questions`), update/delete now-redundant questions, and accept skipped answers without re-asking unless the missing answer is critical. Do not use the follow-up budget unless it materially improves coverage.',
    "User Adaptation: Adapt question phrasing to the user's background and expertise level. Use plain language and real-world analogies for non-technical users; use precise technical terminology for experts.",
    "Final Free-Form Question: After all questions are answered or skipped and no major ambiguity remains, present one final free-form question: 'Anything else to add before PRD generation?'",
    'Final Output: After the final free-form question is answered or skipped, output the final interview results file in a strict machine-readable format.',
    `Structured Batch Output: Wrap each intermediate batch response in <INTERVIEW_BATCH> tags containing YAML with these fields:
  batch_number: (integer, starting at 1)
  progress:
    current: (number of questions presented so far including this batch)
    total: (estimated total remaining, may change as you adapt)
  is_final_free_form: (boolean, true only for the final free-form question)
  ai_commentary: (brief text explaining why you chose these questions or how you adapted)
  questions:
    - id: (string, e.g. "Q12" or "FU3")
      question: (the question text)
      phase: (Foundation | Structure | Assembly)
      priority: (critical | high | medium | low)
      rationale: (why this question matters)`,
    `Final Complete Output: When the interview is fully complete (after the final free-form answer), wrap the final output in <INTERVIEW_COMPLETE> tags containing the complete interview results YAML matching PROM5.output_file schema.`,
  ],
  outputFormat: 'YAML — complete interview results file matching PROM5.output_file schema',
  contextInputs: ['codebase_map', 'ticket_details', 'interview', 'user_answers'],
}

export const PROM5: PromptTemplate = {
  id: 'PROM5',
  description: 'Interview Coverage Verification Prompt',
  systemRole: 'You are a meticulous Quality Assurance Lead.',
  task: 'Re-read the original ticket description and all collected user answers, then compare them against the final Interview Results file to ensure complete coverage.',
  instructions: [
    'Coverage Check: Detect unresolved ambiguity, missing constraints, missing edge cases, missing non-goals, and inconsistent answers.',
    'Identify Gaps: List any specific gaps or discrepancies found between the source material and the Interview Results.',
    'Follow-up: If gaps exist, generate only the targeted follow-up questions strictly necessary to resolve them (no more than 20% of `max_initial_questions`). Do not generate follow-up questions merely because budget remains. If no gaps exist, confirm that the Interview Results are complete and ready for PRD generation.',
  ],
  outputFormat: 'YAML',
  contextInputs: ['ticket_details', 'user_answers', 'interview'],
}

// PRD Phase Prompts
export const PROM10: PromptTemplate = {
  id: 'PROM10',
  description: 'PRD Draft Specification Prompt',
  systemRole: 'You are an expert Technical Product Manager and Software Architect.',
  task: 'Generate a complete Product Requirements Document (PRD) based on the provided Interview Results. The PRD must be detailed enough that an AI coding agent can implement the feature without ambiguity.',
  instructions: [
    'Skipped Questions: For each question the user skipped during the interview, decide the best approach based on available context, codebase analysis, and best practices. Document your decision and reasoning in the PRD.',
    'Product Scope: Include epics, user stories, and acceptance criteria. Every in-scope feature from the Interview Results must map to at least one user story.',
    'Implementation Steps: For each user story, include detailed technical implementation steps decomposed as far as possible — data flows, state changes, component interactions, and integration points.',
    'Technical Requirements: Define architecture constraints, data model, API/contracts, security/performance/reliability constraints, error-handling rules, tooling/environment assumptions, explicit non-goals.',
    'Output Format: Output a single, comprehensive PRD document covering all of the above in one artifact.',
  ],
  outputFormat: 'YAML — complete PRD matching the schema defined in PROM13.output_file',
  contextInputs: ['codebase_map', 'ticket_details', 'interview'],
}

export const PROM11: PromptTemplate = {
  id: 'PROM11',
  description: 'PRD Council Voting Prompt',
  systemRole: 'You are an impartial judge on an AI Council. Your role is to evaluate multiple Product Requirements Document (PRD) drafts objectively.',
  task: 'Read all provided PRD drafts, compare each draft against the Interview Results, and evaluate them against each other. Rate each draft from 0 to 100.',
  instructions: [
    'Impartiality: Rate impartially as if all drafts are anonymous. Do not favor any draft based on its origin or style.',
    'Anti-anchoring: Drafts are presented in randomized order per evaluator. Do not assume the first draft is the baseline or best.',
    'Scoring Rubric (minimum 0, maximum 20 points per category, total maximum 100): 1) Coverage of requirements. 2) Correctness / feasibility. 3) Testability. 4) Minimal complexity / good decomposition. 5) Risks / edge cases addressed.',
    buildStrictVoteOutputInstruction(VOTING_RUBRIC_PRD.map(item => item.category)),
  ],
  outputFormat: STRICT_VOTE_OUTPUT_FORMAT,
  contextInputs: ['codebase_map', 'ticket_details', 'interview', 'drafts'],
}

export const PROM12: PromptTemplate = {
  id: 'PROM12',
  description: 'PRD Winner Refinement Prompt',
  systemRole: "You are the Lead Architect and the winner of the AI Council's PRD drafting phase.",
  task: 'Create the final, definitive version of your PRD by reviewing the alternative (losing) drafts. Extract any superior ideas, missing edge cases, or better technical constraints they contain, and integrate them seamlessly into your winning foundation.',
  instructions: [
    'Your winning draft earned its position — its structure and architecture decisions are sound. Now approach the alternatives with genuine curiosity: they may have caught things you missed.',
    'Gap Scan: Read through the alternative drafts and note anything they cover that your draft does not: requirements you missed, edge cases or error states you omitted, risks you underweighted, or constraints that are unambiguously more precise than yours. These are candidates — not automatic additions.',
    'Selective Upgrade: For each candidate, decide: does it add genuine value, or is it a rephrasing of something you already cover well? If it fills a real gap, add it. If it is a strictly better formulation of something you already have, replace yours with it. Otherwise, discard it.',
    'Restraint: Avoid adding content that merely restates what you already cover. But if genuine gaps exist — missing requirements, unaddressed risks, overlooked error states — add them; completeness matters more than brevity.',
    'Formatting: Output the final refined PRD. Output only the final artifact.',
  ],
  outputFormat: 'YAML — same PRD format as PROM10 output, matching PROM13.output_file schema',
  contextInputs: ['codebase_map', 'ticket_details', 'interview', 'drafts', 'votes'],
}

export const PROM13: PromptTemplate = {
  id: 'PROM13',
  description: 'PRD Coverage Verification Prompt',
  systemRole: 'You are a meticulous Quality Assurance Lead.',
  task: 'Re-read the Interview Results as the source of truth and compare them against the final PRD to ensure complete coverage.',
  instructions: [
    'Coverage Check: Detect and patch missing requirements, edge cases, constraints, and acceptance criteria.',
    'Identify Gaps: List any specific gaps or discrepancies found between the Interview Results and the PRD.',
    'Resolution: Provide the necessary additions or modifications to the PRD to resolve any identified gaps. If no gaps exist, confirm that the PRD is complete and ready for the Beads phase.',
  ],
  outputFormat: 'YAML',
  contextInputs: ['interview', 'prd'],
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
    'Draft Bead Structure: Each bead in this draft phase must include only: Title, PRD references, Description, Context & Architectural Guidance (patterns + anti_patterns), Acceptance criteria, Bead-scoped tests, Test commands.',
    'Output Format: Output a structured Beads workspace definition containing all beads in dependency order.',
  ],
  outputFormat: 'YAML — structured bead list with subset fields',
  contextInputs: ['codebase_map', 'ticket_details', 'prd'],
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
  ],
  outputFormat: STRICT_VOTE_OUTPUT_FORMAT,
  contextInputs: ['codebase_map', 'ticket_details', 'prd', 'drafts'],
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
    'Formatting: Output the final refined Beads breakdown. Output only the final artifact.',
  ],
  outputFormat: 'YAML — same bead list format as PROM20 output',
  contextInputs: ['codebase_map', 'ticket_details', 'prd', 'drafts', 'votes'],
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
  ],
  outputFormat: 'JSONL — one JSON object per line per bead',
  contextInputs: ['codebase_map', 'ticket_details', 'prd', 'beads_draft'],
}

export const PROM24: PromptTemplate = {
  id: 'PROM24',
  description: 'Beads Coverage Verification Prompt',
  systemRole: 'You are a meticulous Quality Assurance Lead.',
  task: 'Re-read the final PRD as the source of truth and compare it against the Beads graph and tests to ensure complete coverage.',
  instructions: [
    'Coverage Check: Detect uncovered PRD requirements, missing dependency edges, oversized beads, and missing verification steps.',
    'Identify Gaps: List any specific gaps or discrepancies found between the PRD and the Beads breakdown.',
    'Resolution: Provide necessary additions or modifications. Ensure each in-scope PRD requirement maps to at least one bead with explicit verification. If no gaps exist, confirm ready for Execution.',
  ],
  outputFormat: 'JSONL',
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
    'Do not claim the tests passed yourself. LoopTroop will execute the commands and determine pass/fail from the real exit codes.',
    'Failure Handling: If you added or updated tests, include only the commands needed to verify the final implementation state.',
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
  PROM1,
  PROM2,
  PROM3,
  PROM4,
  PROM5,
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
