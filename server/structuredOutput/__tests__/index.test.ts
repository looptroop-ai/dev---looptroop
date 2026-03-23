import { describe, expect, it } from 'vitest'
import {
  buildApprovedInterviewDocument,
  normalizeBeadCompletionMarkerOutput,
  normalizeBeadsJsonlOutput,
  normalizeBeadSubsetYamlOutput,
  normalizeCoverageResultOutput,
  normalizeFinalTestCommandsOutput,
  normalizeInterviewDocumentOutput,
  normalizeInterviewRefinementOutput,
  normalizeInterviewQuestionsOutput,
  normalizeInterviewTurnOutput,
  normalizePrdYamlOutput,
  normalizeRelevantFilesOutput,
  normalizeVoteScorecardOutput,
  updateInterviewDocumentAnswers,
} from '../index'

describe('structured output normalization', () => {
  it('repairs interview phase ordering without changing within-phase order', () => {
    const result = normalizeInterviewQuestionsOutput([
      'questions:',
      '  - id: Q01',
      '    phase: foundation',
      '    question: "What are we building?"',
      '  - id: Q03',
      '    phase: structure',
      '    question: "What are the main flows?"',
      '  - id: Q02',
      '    phase: foundation',
      '    question: "Who is the user?"',
    ].join('\n'), 10)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.repairApplied).toBe(true)
    expect(result.value.questions.map((question) => question.id)).toEqual(['Q01', 'Q02', 'Q03'])
  })

  it('repairs interview questions with inconsistent sequence entry indentation (LOO-19)', () => {
    const result = normalizeInterviewQuestionsOutput([
      'questions:',
      '- id: Q01',
      '    phase: foundation',
      '    question: >-',
      '        Who are the primary users or stakeholders',
      '        of this feature?',
      '  - id: Q02',
      '    phase: foundation',
      '    question: >-',
      '        What is the core problem this feature solves?',
      '  - id: Q03',
      '    phase: structure',
      '    question: "What are the main user flows?"',
    ].join('\n'), 10)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.questions).toHaveLength(3)
    expect(result.value.questions[0]!.id).toBe('Q01')
    expect(result.value.questions[1]!.id).toBe('Q02')
    expect(result.value.questions[2]!.id).toBe('Q03')
  })

  it('normalizes refinement output wrapped in ```yaml code fences', () => {
    const winnerDraft = [
      'questions:',
      '  - id: Q01',
      '    phase: foundation',
      '    question: "What problem are we solving?"',
      '  - id: Q02',
      '    phase: structure',
      '    question: "What are the main workflows?"',
    ].join('\n')

    const result = normalizeInterviewRefinementOutput([
      '```yaml',
      'questions:',
      '  - id: Q01',
      '    phase: foundation',
      '    question: "What user problem are we solving?"',
      '  - id: Q02',
      '    phase: structure',
      '    question: "What are the main workflows?"',
      'changes:',
      '  - type: modified',
      '    before:',
      '      id: Q01',
      '      phase: foundation',
      '      question: "What problem are we solving?"',
      '    after:',
      '      id: Q01',
      '      phase: foundation',
      '      question: "What user problem are we solving?"',
      '```',
    ].join('\n'), winnerDraft, 10)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.questionCount).toBe(2)
    expect(result.value.changes).toHaveLength(1)
    expect(result.value.changes[0]!.type).toBe('modified')
  })

  it('normalizes PROM3 refinement output with explicit changes', () => {
    const winnerDraft = [
      'questions:',
      '  - id: Q01',
      '    phase: foundation',
      '    question: "What problem are we solving?"',
      '  - id: Q02',
      '    phase: structure',
      '    question: "What are the main workflows?"',
    ].join('\n')

    const result = normalizeInterviewRefinementOutput([
      'questions:',
      '  - id: Q01',
      '    phase: foundation',
      '    question: "What user problem are we solving?"',
      '  - id: Q03',
      '    phase: assembly',
      '    question: "How should success be verified?"',
      'changes:',
      '  - type: modified',
      '    before:',
      '      id: Q01',
      '      phase: foundation',
      '      question: "What problem are we solving?"',
      '    after:',
      '      id: Q01',
      '      phase: foundation',
      '      question: "What user problem are we solving?"',
      '  - type: removed',
      '    before:',
      '      id: Q02',
      '      phase: structure',
      '      question: "What are the main workflows?"',
      '    after: null',
      '  - type: added',
      '    before: null',
      '    after:',
      '      id: Q03',
      '      phase: assembly',
      '      question: "How should success be verified?"',
    ].join('\n'), winnerDraft, 10)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.questionCount).toBe(2)
    expect(result.value.changes.map((change) => change.type)).toEqual(['modified', 'removed', 'added'])
    expect(result.normalizedContent).toContain('changes:')
  })

  it('preserves folded refinement questions instead of corrupting them during YAML repair', () => {
    const winnerDraft = [
      'questions:',
      '  - id: Q22',
      '    phase: assembly',
      '    question: >-',
      '      What deterministic ordering rules should govern XML output: path sort',
      '      only, directories before files, case sensitivity rules, and any stable',
      '      normalization required for cross-platform consistency?',
    ].join('\n')

    const result = normalizeInterviewRefinementOutput([
      'questions:',
      '  - id: Q22',
      '    phase: assembly',
      '    question: >-',
      '      What deterministic ordering and normalization rules should govern XML',
      '      output: path sort only, directories before files, case sensitivity,',
      '      locale neutrality, symlink handling, and any stable normalization needed',
      '      for cross-platform consistency?',
      'changes:',
      '  - type: modified',
      '    before:',
      '      id: Q22',
      '      phase: assembly',
      '      question: >-',
      '        What deterministic ordering rules should govern XML output: path sort',
      '        only, directories before files, case sensitivity rules, and any stable',
      '        normalization required for cross-platform consistency?',
      '    after:',
      '      id: Q22',
      '      phase: assembly',
      '      question: >-',
      '        What deterministic ordering and normalization rules should govern XML',
      '        output: path sort only, directories before files, case sensitivity,',
      '        locale neutrality, symlink handling, and any stable normalization needed',
      '        for cross-platform consistency?',
    ].join('\n'), winnerDraft, 50)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.questionCount).toBe(1)
    expect(result.value.changes).toHaveLength(1)
    expect(result.value.questions[0]?.id).toBe('Q22')
    expect(result.value.questions[0]?.question).toContain('locale neutrality')
  })

  it('drops no-op modified interview refinement changes instead of retrying or failing', () => {
    const winnerDraft = [
      'questions:',
      '  - id: Q01',
      '    phase: foundation',
      '    question: "What problem are we solving?"',
    ].join('\n')

    const result = normalizeInterviewRefinementOutput([
      'questions:',
      '  - id: Q01',
      '    phase: foundation',
      '    question: "What problem are we solving?"',
      'changes:',
      '  - type: modified',
      '    before:',
      '      id: Q01',
      '      phase: foundation',
      '      question: "What problem are we solving?"',
      '    after:',
      '      id: Q01',
      '      phase: foundation',
      '      question: "What problem are we solving?"',
    ].join('\n'), winnerDraft, 10)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.repairApplied).toBe(true)
    expect(result.repairWarnings.join('\n')).toContain('Dropped no-op interview refinement modified')
    expect(result.value.changes).toEqual([])
  })

  it('canonicalizes slight interview refinement text drift when id and phase uniquely match', () => {
    const winnerDraft = [
      'questions:',
      '  - id: Q01',
      '    phase: foundation',
      '    question: "What problem are we solving?"',
    ].join('\n')

    const result = normalizeInterviewRefinementOutput([
      'questions:',
      '  - id: Q01',
      '    phase: foundation',
      '    question: "What user problem are we solving?"',
      'changes:',
      '  - type: modified',
      '    before:',
      '      id: Q01',
      '      phase: foundation',
      '      question: "What problem are we solving today?"',
      '    after:',
      '      id: Q01',
      '      phase: foundation',
      '      question: "What user problem are we solving today?"',
    ].join('\n'), winnerDraft, 10)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.repairApplied).toBe(true)
    expect(result.value.changes).toEqual([
      {
        type: 'modified',
        before: {
          id: 'Q01',
          phase: 'foundation',
          question: 'What problem are we solving?',
        },
        after: {
          id: 'Q01',
          phase: 'foundation',
          question: 'What user problem are we solving?',
        },
      },
    ])
  })

  it('rejects refinement changes that reference a non-winner question', () => {
    const winnerDraft = [
      'questions:',
      '  - id: Q01',
      '    phase: foundation',
      '    question: "What problem are we solving?"',
    ].join('\n')

    const result = normalizeInterviewRefinementOutput([
      'questions:',
      '  - id: Q02',
      '    phase: foundation',
      '    question: "What user problem are we solving?"',
      'changes:',
      '  - type: replaced',
      '    before:',
      '      id: Q09',
      '      phase: foundation',
      '      question: "Unknown question?"',
      '    after:',
      '      id: Q02',
      '      phase: foundation',
      '      question: "What user problem are we solving?"',
    ].join('\n'), winnerDraft, 10)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('winning draft')
  })

  it('rejects duplicate reuse of the same question record across changes', () => {
    const winnerDraft = [
      'questions:',
      '  - id: Q01',
      '    phase: foundation',
      '    question: "What problem are we solving?"',
      '  - id: Q02',
      '    phase: structure',
      '    question: "What are the main workflows?"',
    ].join('\n')

    const result = normalizeInterviewRefinementOutput([
      'questions:',
      '  - id: Q03',
      '    phase: foundation',
      '    question: "What user problem are we solving?"',
      '  - id: Q04',
      '    phase: structure',
      '    question: "What flow matters most?"',
      'changes:',
      '  - type: replaced',
      '    before:',
      '      id: Q01',
      '      phase: foundation',
      '      question: "What problem are we solving?"',
      '    after:',
      '      id: Q03',
      '      phase: foundation',
      '      question: "What user problem are we solving?"',
      '  - type: replaced',
      '    before:',
      '      id: Q01',
      '      phase: foundation',
      '      question: "What problem are we solving?"',
      '    after:',
      '      id: Q04',
      '      phase: structure',
      '      question: "What flow matters most?"',
    ].join('\n'), winnerDraft, 10)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('reuses a winning-draft question')
  })

  it('repairs added → replaced when the model reuses a winner-draft question ID with different content', () => {
    const winnerDraft = [
      'questions:',
      '  - id: Q01',
      '    phase: foundation',
      '    question: "What problem are we solving?"',
      '  - id: Q02',
      '    phase: foundation',
      '    question: "Who is the target user?"',
      '  - id: Q03',
      '    phase: structure',
      '    question: "What are the main workflows?"',
    ].join('\n')

    const result = normalizeInterviewRefinementOutput([
      'questions:',
      '  - id: Q01',
      '    phase: foundation',
      '    question: "What problem are we solving?"',
      '  - id: Q02',
      '    phase: structure',
      '    question: "What components need to interact?"',
      '  - id: Q03',
      '    phase: structure',
      '    question: "How should data flow between modules?"',
      'changes:',
      '  - type: added',
      '    before: null',
      '    after:',
      '      id: Q02',
      '      phase: structure',
      '      question: "What components need to interact?"',
      '  - type: added',
      '    before: null',
      '    after:',
      '      id: Q03',
      '      phase: structure',
      '      question: "How should data flow between modules?"',
    ].join('\n'), winnerDraft, 10)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.repairApplied).toBe(true)
    expect(result.repairWarnings.join('\n')).toContain('Converted interview refinement change at index 0 from "added" to "replaced"')
    expect(result.repairWarnings.join('\n')).toContain('Converted interview refinement change at index 1 from "added" to "replaced"')
    expect(result.value.changes).toEqual([
      {
        type: 'replaced',
        before: {
          id: 'Q02',
          phase: 'foundation',
          question: 'Who is the target user?',
        },
        after: {
          id: 'Q02',
          phase: 'structure',
          question: 'What components need to interact?',
        },
      },
      {
        type: 'replaced',
        before: {
          id: 'Q03',
          phase: 'structure',
          question: 'What are the main workflows?',
        },
        after: {
          id: 'Q03',
          phase: 'structure',
          question: 'How should data flow between modules?',
        },
      },
    ])
  })

  it('parses wrapped vote scorecards and repairs incorrect totals', () => {
    const wrapped = [
      '```yaml',
      'draft_scores:',
      '  Draft 1:',
      '    Coverage of requirements: 18',
      '    Correctness / feasibility: 17',
      '    Testability: 16',
      '    Minimal complexity / good decomposition: 15',
      '    Risks / edge cases addressed: 18',
      '    total_score: 84',
      '  Draft 2:',
      '    Coverage of requirements: 14',
      '    Correctness / feasibility: 15',
      '    Testability: 14',
      '    Minimal complexity / good decomposition: 16',
      '    Risks / edge cases addressed: 13',
      '    total_score: 72',
      '```',
    ].join('\n')

    const parsed = normalizeVoteScorecardOutput(
      wrapped,
      ['Draft 1', 'Draft 2'],
      [
        'Coverage of requirements',
        'Correctness / feasibility',
        'Testability',
        'Minimal complexity / good decomposition',
        'Risks / edge cases addressed',
      ],
    )

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.draftScores['Draft 1']?.total_score).toBe(84)

    const repaired = normalizeVoteScorecardOutput(
      parsed.normalizedContent.replace('total_score: 84', 'total_score: 80'),
      ['Draft 1', 'Draft 2'],
      [
        'Coverage of requirements',
        'Correctness / feasibility',
        'Testability',
        'Minimal complexity / good decomposition',
        'Risks / edge cases addressed',
      ],
    )

    expect(repaired.ok).toBe(true)
    if (!repaired.ok) return
    expect(repaired.repairApplied).toBe(true)
    expect(repaired.value.draftScores['Draft 1']?.total_score).toBe(84)
    expect(repaired.repairWarnings.join('\n')).toContain('Recomputed total_score for Draft 1')
  })

  it('repairs missing vote total_score values but keeps invalid category scores strict', () => {
    const repaired = normalizeVoteScorecardOutput(
      [
        'draft_scores:',
        '  Draft 1:',
        '    Coverage of requirements: 18',
        '    Correctness / feasibility: 17',
        '    Testability: 16',
        '    Minimal complexity / good decomposition: 15',
        '    Risks / edge cases addressed: 18',
      ].join('\n'),
      ['Draft 1'],
      [
        'Coverage of requirements',
        'Correctness / feasibility',
        'Testability',
        'Minimal complexity / good decomposition',
        'Risks / edge cases addressed',
      ],
    )

    expect(repaired.ok).toBe(true)
    if (!repaired.ok) return
    expect(repaired.repairApplied).toBe(true)
    expect(repaired.value.draftScores['Draft 1']?.total_score).toBe(84)

    const invalid = normalizeVoteScorecardOutput(
      [
        'draft_scores:',
        '  Draft 1:',
        '    Coverage of requirements: 18',
        '    Correctness / feasibility: 17',
        '    Testability: nope',
        '    Minimal complexity / good decomposition: 15',
        '    Risks / edge cases addressed: 18',
        '    total_score: 84',
      ].join('\n'),
      ['Draft 1'],
      [
        'Coverage of requirements',
        'Correctness / feasibility',
        'Testability',
        'Minimal complexity / good decomposition',
        'Risks / edge cases addressed',
      ],
    )

    expect(invalid.ok).toBe(false)
    if (invalid.ok) return
    expect(invalid.error).toContain('Invalid score for Draft 1 / Testability')
  })

  it('repairs malformed wrapped vote indentation from council retries', () => {
    const repaired = normalizeVoteScorecardOutput(
      [
        'draft_scores:',
        'Draft 1:',
        '    Coverage of requirements: 18',
        '    Correctness / feasibility: 18',
        '    Testability: 18',
        '    Minimal complexity / good decomposition: 16',
        '    Risks / edge cases addressed: 19',
        '    total_score: 89',
        '  Draft 2:',
        '    Coverage of requirements: 20',
        '    Correctness / feasibility: 19',
        '    Testability: 20',
        '    Minimal complexity / good decomposition: 10',
        '    Risks / edge cases addressed: 19',
        '    total_score: 88',
        '  Draft 3:',
        '    Coverage of requirements: 18',
        '    Correctness / feasibility: 19',
        '    Testability: 18',
        '    Minimal complexity / good decomposition: 18',
        '    Risks / edge cases addressed: 18',
        '    total_score: 91',
        '  Draft 4:',
        '    Coverage of requirements: 12',
        '    Correctness / feasibility: 17',
        '    Testability: 11',
        '    Minimal complexity / good decomposition: 9',
        '    Risks / edge cases addressed: 12',
        '    total_score: 61',
      ].join('\n'),
      ['Draft 1', 'Draft 2', 'Draft 3', 'Draft 4'],
      [
        'Coverage of requirements',
        'Correctness / feasibility',
        'Testability',
        'Minimal complexity / good decomposition',
        'Risks / edge cases addressed',
      ],
    )

    expect(repaired.ok).toBe(true)
    if (!repaired.ok) return
    expect(repaired.repairApplied).toBe(true)
    expect(repaired.repairWarnings.join('\n')).toContain('Normalized vote scorecard indentation')
    expect(repaired.value.draftScores['Draft 1']?.total_score).toBe(89)
    expect(repaired.value.draftScores['Draft 4']?.total_score).toBe(61)
  })

  it('keeps unknown vote scorecards strict', () => {
    const result = normalizeVoteScorecardOutput(
      [
        'draft_scores:',
        '  Draft 1:',
        '    Coverage of requirements: 18',
        '    Correctness / feasibility: 17',
        '    Testability: 16',
        '    Minimal complexity / good decomposition: 15',
        '    Risks / edge cases addressed: 18',
        '    total_score: 84',
        '  Draft 3:',
        '    Coverage of requirements: 10',
        '    Correctness / feasibility: 10',
        '    Testability: 10',
        '    Minimal complexity / good decomposition: 10',
        '    Risks / edge cases addressed: 10',
        '    total_score: 50',
      ].join('\n'),
      ['Draft 1'],
      [
        'Coverage of requirements',
        'Correctness / feasibility',
        'Testability',
        'Minimal complexity / good decomposition',
        'Risks / edge cases addressed',
      ],
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('Unknown scorecard for Draft 3')
  })

  it('normalizes PRD YAML and fills deterministic metadata from runtime context', () => {
    const interviewContent = [
      'schema_version: 1',
      'ticket_id: "K8S-17"',
      'artifact: "interview"',
      'status: "approved"',
      'generated_by:',
      '  winner_model: "openai/gpt-5"',
      '  generated_at: "2026-03-20T10:00:00.000Z"',
      'questions:',
      '  - id: "Q01"',
      '    phase: "Foundation"',
      '    prompt: "Which fallback path should we use?"',
      '    source: "compiled"',
      '    follow_up_round: null',
      '    answer_type: "free_text"',
      '    options: []',
      '    answer:',
      '      skipped: true',
      '      selected_option_ids: []',
      '      free_text: ""',
      '      answered_by: "ai_skip"',
      '      answered_at: ""',
      'summary:',
      '  goals: []',
      '  constraints: []',
      '  non_goals: []',
      '  final_free_form_answer: ""',
      'follow_up_rounds: []',
      'approval:',
      '  approved_by: "user"',
      '  approved_at: "2026-03-20T10:10:00.000Z"',
    ].join('\n')
    const result = normalizePrdYamlOutput([
      'prd:',
      '  product:',
      '    problemStatement: Ship a deterministic planning pipeline.',
      '    targetUsers:',
      '      - Maintainers',
      '  scope:',
      '    inScope:',
      '      - Prompt hardening',
      '    outOfScope:',
      '      - Execution changes',
      '  technicalRequirements:',
      '    architectureConstraints:',
      '      - Shared validator layer',
      '  interviewGapResolutions:',
      '    - questionId: Q01',
      '      prompt: Which fallback path should we use?',
      '      resolution: Default to the existing retry strategy for v1.',
      '      rationale: This matches current production behavior.',
      '  epics:',
      '    - id: EPIC-1',
      '      title: Harden structured output',
      '      objective: Prevent format-only model mistakes from blocking tickets.',
      '      implementationSteps:',
      '        - Add validators',
      '      userStories:',
      '        - id: US-1',
      '          title: Validate interview/PRD/beads artifacts',
      '          acceptanceCriteria:',
      '            - Structured artifacts are normalized before save',
      '          implementationSteps:',
      '            - Reuse shared repair helpers',
      '          verification:',
      '            requiredCommands:',
      '              - npm run test:server',
      '  risks:',
      '    - Retry loop could hide semantic mistakes if too permissive',
    ].join('\n'), {
      ticketId: 'K8S-17',
      interviewContent,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.ticket_id).toBe('K8S-17')
    expect(result.value.artifact).toBe('prd')
    expect(result.value.epics).toHaveLength(1)
    expect(result.value.interview_gap_resolutions).toEqual([
      {
        question_id: 'Q01',
        prompt: 'Which fallback path should we use?',
        resolution: 'Default to the existing retry strategy for v1.',
        rationale: 'This matches current production behavior.',
      },
    ])
    expect(result.normalizedContent).toContain('schema_version: 1')
  })

  it('accepts a top-level PRD document with artifact field instead of unwrapping it', () => {
    const interviewContent = [
      'schema_version: 1',
      'ticket_id: "LOOTR-1"',
      'artifact: "interview"',
      'status: "approved"',
      'generated_by:',
      '  winner_model: "openai/gpt-5"',
      '  generated_at: "2026-03-20T10:00:00.000Z"',
      'questions:',
      '  - id: "Q01"',
      '    phase: "Foundation"',
      '    prompt: "What problem are we solving?"',
      '    source: "compiled"',
      '    follow_up_round: null',
      '    answer_type: "free_text"',
      '    options: []',
      '    answer:',
      '      skipped: false',
      '      selected_option_ids: []',
      '      free_text: "Ship a deterministic planning pipeline."',
      '      answered_by: "user"',
      '      answered_at: "2026-03-20T10:05:00.000Z"',
      'summary:',
      '  goals: []',
      '  constraints: []',
      '  non_goals: []',
      '  final_free_form_answer: ""',
      'follow_up_rounds: []',
      'approval:',
      '  approved_by: "user"',
      '  approved_at: "2026-03-20T10:10:00.000Z"',
    ].join('\n')
    const result = normalizePrdYamlOutput([
      'schema_version: 1',
      'ticket_id: "LOOTR-1"',
      'artifact: "prd"',
      'status: "draft"',
      'source_interview:',
      '  content_sha256: "abc123"',
      'product:',
      '  problem_statement: "Ship a deterministic planning pipeline."',
      '  target_users:',
      '    - "Maintainers"',
      'scope:',
      '  in_scope:',
      '    - "Prompt hardening"',
      '  out_of_scope:',
      '    - "Execution changes"',
      'technical_requirements:',
      '  architecture_constraints:',
      '    - "Shared validator layer"',
      '  data_model: []',
      '  api_contracts: []',
      '  security_constraints: []',
      '  performance_constraints: []',
      '  reliability_constraints: []',
      '  error_handling_rules: []',
      '  tooling_assumptions: []',
      'interview_gap_resolutions: []',
      'epics:',
      '  - id: EPIC-1',
      '    title: Harden structured output',
      '    objective: Prevent format-only model mistakes from blocking tickets.',
      '    implementation_steps:',
      '      - Add validators',
      '    user_stories:',
      '      - id: US-1',
      '        title: Validate interview/PRD/beads artifacts',
      '        acceptance_criteria:',
      '          - Structured artifacts are normalized before save',
      '        implementation_steps:',
      '          - Reuse shared repair helpers',
      '        verification:',
      '          required_commands:',
      '            - npm run test:server',
      'risks:',
      '  - "Retry loop could hide semantic mistakes if too permissive"',
      'approval:',
      '  approved_by: ""',
      '  approved_at: ""',
    ].join('\n'), {
      ticketId: 'LOOTR-1',
      interviewContent,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.ticket_id).toBe('LOOTR-1')
    expect(result.value.artifact).toBe('prd')
    expect(result.value.epics).toHaveLength(1)
    expect(result.value.interview_gap_resolutions).toEqual([])
  })

  it('rejects non-object PRD payloads', () => {
    const result = normalizePrdYamlOutput('"prd"', {
      ticketId: 'K8S-17',
      interviewContent: [
        'schema_version: 1',
        'ticket_id: "K8S-17"',
        'artifact: "interview"',
        'status: "approved"',
        'generated_by:',
        '  winner_model: "openai/gpt-5"',
        '  generated_at: "2026-03-20T10:00:00.000Z"',
        'questions:',
        '  - id: "Q01"',
        '    phase: "Foundation"',
        '    prompt: "Which workflow guardrails are mandatory?"',
        '    source: "compiled"',
        '    follow_up_round: null',
        '    answer_type: "free_text"',
        '    options: []',
        '    answer:',
        '      skipped: false',
        '      selected_option_ids: []',
        '      free_text: "Keep the council flow intact."',
        '      answered_by: "user"',
        '      answered_at: "2026-03-20T10:05:00.000Z"',
        'follow_up_rounds: []',
        'summary:',
        '  goals: []',
        '  constraints: []',
        '  non_goals: []',
        '  final_free_form_answer: ""',
        'approval:',
        '  approved_by: "user"',
        '  approved_at: "2026-03-20T10:10:00.000Z"',
      ].join('\n'),
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('YAML/JSON object')
  })

  it('keeps rejecting PRD payloads that are missing epics', () => {
    const result = normalizePrdYamlOutput([
      'schema_version: 1',
      'artifact: "prd"',
      'product:',
      '  problem_statement: "Ship a deterministic planning pipeline."',
      'scope:',
      '  in_scope:',
      '    - "Prompt hardening"',
      'technical_requirements:',
      '  architecture_constraints:',
      '    - "Shared validator layer"',
      'interview_gap_resolutions: []',
      'risks:',
      '  - "Incomplete plans can block delivery"',
    ].join('\n'), {
      ticketId: 'K8S-17',
      interviewContent: [
        'schema_version: 1',
        'ticket_id: "K8S-17"',
        'artifact: "interview"',
        'status: "approved"',
        'generated_by:',
        '  winner_model: "openai/gpt-5"',
        '  generated_at: "2026-03-20T10:00:00.000Z"',
        'questions:',
        '  - id: "Q01"',
        '    phase: "Foundation"',
        '    prompt: "Which workflow guardrails are mandatory?"',
        '    source: "compiled"',
        '    answer_type: "free_text"',
        '    options: []',
        '    answer:',
        '      skipped: false',
        '      selected_option_ids: []',
        '      free_text: "Keep the council flow intact."',
        '      answered_by: "user"',
        '      answered_at: "2026-03-20T10:05:00.000Z"',
        'follow_up_rounds: []',
        'summary:',
        '  goals: []',
        '  constraints: []',
        '  non_goals: []',
        '  final_free_form_answer: ""',
        'approval:',
        '  approved_by: "user"',
        '  approved_at: "2026-03-20T10:10:00.000Z"',
      ].join('\n'),
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('missing epics')
  })

  it('repairs duplicate and missing PRD ids deterministically', () => {
    const result = normalizePrdYamlOutput([
      '```yaml',
      'schema_version: 1',
      'artifact: "prd"',
      'status: "draft"',
      'product:',
      '  problem_statement: "Ship a deterministic planning pipeline."',
      '  target_users:',
      '    - "Maintainers"',
      'scope:',
      '  in_scope:',
      '    - "Prompt hardening"',
      '  out_of_scope: []',
      'technical_requirements:',
      '  architecture_constraints:',
      '    - "Shared validator layer"',
      '  data_model: []',
      '  api_contracts: []',
      '  security_constraints: []',
      '  performance_constraints: []',
      '  reliability_constraints: []',
      '  error_handling_rules: []',
      '  tooling_assumptions: []',
      'interview_gap_resolutions: []',
      'epics:',
      '  - id: "EPIC-1"',
      '    title: "First epic"',
      '    objective: "Cover the first slice."',
      '    implementation_steps: []',
      '    user_stories:',
      '      - id: "US-1"',
      '        title: "First story"',
      '        acceptance_criteria: []',
      '        implementation_steps: []',
      '        verification:',
      '          required_commands: []',
      '  - title: "Second epic"',
      '    objective: "Cover the second slice."',
      '    implementation_steps: []',
      '    user_stories:',
      '      - id: "US-1"',
      '        title: "Second story"',
      '        acceptance_criteria: []',
      '        implementation_steps: []',
      '        verification:',
      '          required_commands: []',
      '```',
    ].join('\n'), {
      ticketId: 'K8S-17',
      interviewContent: [
        'schema_version: 1',
        'ticket_id: "K8S-17"',
        'artifact: "interview"',
        'status: "approved"',
        'generated_by:',
        '  winner_model: "openai/gpt-5"',
        '  generated_at: "2026-03-20T10:00:00.000Z"',
        'questions:',
        '  - id: "Q01"',
        '    phase: "Foundation"',
        '    prompt: "Which workflow guardrails are mandatory?"',
        '    source: "compiled"',
        '    follow_up_round: null',
        '    answer_type: "free_text"',
        '    options: []',
        '    answer:',
        '      skipped: false',
        '      selected_option_ids: []',
        '      free_text: "Keep the council flow intact."',
        '      answered_by: "user"',
        '      answered_at: "2026-03-20T10:05:00.000Z"',
        'follow_up_rounds: []',
        'summary:',
        '  goals: []',
        '  constraints: []',
        '  non_goals: []',
        '  final_free_form_answer: ""',
        'approval:',
        '  approved_by: "user"',
        '  approved_at: "2026-03-20T10:10:00.000Z"',
      ].join('\n'),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.repairApplied).toBe(true)
    expect(result.value.epics.map((epic) => epic.id)).toEqual(['EPIC-1', 'EPIC-2'])
    expect(result.value.epics.flatMap((epic) => epic.user_stories.map((story) => story.id))).toEqual(['US-1', 'US-2-1'])
    expect(result.repairWarnings.join('\n')).toContain('Epic at index 1 was missing id')
    expect(result.repairWarnings.join('\n')).toContain('duplicate user story id US-1')
  })

  it('requires interview_gap_resolutions to match the skipped interview questions exactly', () => {
    const result = normalizePrdYamlOutput([
      'schema_version: 1',
      'artifact: "prd"',
      'status: "draft"',
      'product:',
      '  problem_statement: "Ship a deterministic planning pipeline."',
      '  target_users:',
      '    - "Maintainers"',
      'scope:',
      '  in_scope:',
      '    - "Prompt hardening"',
      '  out_of_scope: []',
      'technical_requirements:',
      '  architecture_constraints:',
      '    - "Shared validator layer"',
      '  data_model: []',
      '  api_contracts: []',
      '  security_constraints: []',
      '  performance_constraints: []',
      '  reliability_constraints: []',
      '  error_handling_rules: []',
      '  tooling_assumptions: []',
      'interview_gap_resolutions: []',
      'epics:',
      '  - id: "EPIC-1"',
      '    title: "First epic"',
      '    objective: "Cover the first slice."',
      '    implementation_steps: []',
      '    user_stories:',
      '      - id: "US-1"',
      '        title: "First story"',
      '        acceptance_criteria: []',
      '        implementation_steps: []',
      '        verification:',
      '          required_commands: []',
    ].join('\n'), {
      ticketId: 'K8S-17',
      interviewContent: [
        'schema_version: 1',
        'ticket_id: "K8S-17"',
        'artifact: "interview"',
        'status: "approved"',
        'generated_by:',
        '  winner_model: "openai/gpt-5"',
        '  generated_at: "2026-03-20T10:00:00.000Z"',
        'questions:',
        '  - id: "Q01"',
        '    phase: "Foundation"',
        '    prompt: "Which fallback path should we use?"',
        '    source: "compiled"',
        '    follow_up_round: null',
        '    answer_type: "free_text"',
        '    options: []',
        '    answer:',
        '      skipped: true',
        '      selected_option_ids: []',
        '      free_text: ""',
        '      answered_by: "ai_skip"',
        '      answered_at: ""',
        'follow_up_rounds: []',
        'summary:',
        '  goals: []',
        '  constraints: []',
        '  non_goals: []',
        '  final_free_form_answer: ""',
        'approval:',
        '  approved_by: "user"',
        '  approved_at: "2026-03-20T10:10:00.000Z"',
      ].join('\n'),
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('missing interview_gap_resolutions')
  })

  it('normalizes bead subset YAML and generates fallback ids when needed', () => {
    const result = normalizeBeadSubsetYamlOutput([
      'beads:',
      '  - title: Build shared repair layer',
      '    prdRefs: [EPIC-1 / US-1]',
      '    description: Normalize structured model output before validation.',
      '    contextGuidance: Keep repairs deterministic.',
      '    acceptanceCriteria:',
      '      - Repair only formatting issues',
      '    tests:',
      '      - Shared validator tests cover fences and wrappers',
      '    testCommands:',
      '      - npm run test:server',
    ].join('\n'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value[0]?.id).toBe('bead-1')
    expect(result.normalizedContent).toContain('beads:')
  })

  it('accepts bead JSON arrays and rejects invalid dependencies', () => {
    const valid = normalizeBeadsJsonlOutput(JSON.stringify([
      {
        id: 'bead-1',
        title: 'First bead',
        prdRefs: ['EPIC-1 / US-1'],
        description: 'Do the first step.',
        contextGuidance: '',
        acceptanceCriteria: ['done'],
        tests: ['test'],
        testCommands: ['npm run test'],
        priority: 1,
        status: 'pending',
        labels: [],
        dependencies: [],
        targetFiles: [],
        notes: [],
        iteration: 1,
        createdAt: '',
        updatedAt: '',
        beadStartCommit: null,
        estimatedComplexity: 'moderate',
        epicId: 'EPIC-1',
        storyId: 'US-1',
      },
    ]))

    expect(valid.ok).toBe(true)

    const invalid = normalizeBeadsJsonlOutput(JSON.stringify([
      {
        id: 'bead-1',
        title: 'Broken bead',
        prdRefs: ['EPIC-1 / US-1'],
        description: 'Bad dependencies.',
        contextGuidance: '',
        acceptanceCriteria: ['done'],
        tests: ['test'],
        testCommands: ['npm run test'],
        priority: 1,
        status: 'pending',
        labels: [],
        dependencies: ['bead-1'],
        targetFiles: [],
        notes: [],
        iteration: 1,
        createdAt: '',
        updatedAt: '',
        beadStartCommit: null,
        estimatedComplexity: 'moderate',
        epicId: 'EPIC-1',
        storyId: 'US-1',
      },
    ]))

    expect(invalid.ok).toBe(false)
    if (invalid.ok) return
    expect(invalid.error).toContain('self-dependency')
  })

  it('parses the shared coverage result envelope', () => {
    const result = normalizeCoverageResultOutput([
      'status: gaps',
      'gaps:',
      '  - Missing rollback behavior',
      'follow_up_questions:',
      '  - id: FU1',
      '    question: What should happen when validation fails?',
      '    phase: Assembly',
      '    priority: high',
    ].join('\n'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.status).toBe('gaps')
    expect(result.value.followUpQuestions[0]?.id).toBe('FU1')
  })

  it('normalizes string-based coverage follow-up questions', () => {
    const result = normalizeCoverageResultOutput([
      'status: gaps',
      'gaps:',
      '  - Missing rollback behavior',
      'follow_up_questions:',
      '  - What should happen when validation fails?',
      '  - Which fallback path should we use?',
    ].join('\n'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.followUpQuestions).toEqual([
      {
        id: 'FU1',
        question: 'What should happen when validation fails?',
      },
      {
        id: 'FU2',
        question: 'Which fallback path should we use?',
      },
    ])
  })

  it('normalizes mixed coverage follow-up question shapes', () => {
    const result = normalizeCoverageResultOutput([
      'status: gaps',
      'gaps:',
      '  - Missing rollback behavior',
      'follow_up_questions:',
      '  - id: FU9',
      '    question: What should happen when validation fails?',
      '    phase: Assembly',
      '  - Which fallback path should we use?',
    ].join('\n'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.followUpQuestions).toEqual([
      {
        id: 'FU9',
        question: 'What should happen when validation fails?',
        phase: 'Assembly',
      },
      {
        id: 'FU2',
        question: 'Which fallback path should we use?',
      },
    ])
  })

  it('repairs malformed coverage gap scalars that begin with backticks', () => {
    const result = normalizeCoverageResultOutput([
      'status: gaps',
      'gaps:',
      '  - Missing rollback behavior',
      '  - `repo_git_mutex` behavior is undefined, including exact serialized operations, timeout thresholds, retry policy, workspace preservation on timeout, and required manual recovery surface.',
      'follow_up_questions: []',
    ].join('\n'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.repairApplied).toBe(true)
    expect(result.repairWarnings).toEqual([
      'Quoted coverage gap strings to recover malformed YAML scalars.',
    ])
    expect(result.value.gaps).toEqual([
      'Missing rollback behavior',
      '`repo_git_mutex` behavior is undefined, including exact serialized operations, timeout thresholds, retry policy, workspace preservation on timeout, and required manual recovery surface.',
    ])
    expect(result.value.followUpQuestions).toEqual([])
  })

  it('repairs malformed coverage gap scalars without changing structured follow-up question objects', () => {
    const result = normalizeCoverageResultOutput([
      'status: gaps',
      'gaps:',
      '  - `repo_git_mutex` behavior is undefined and must be clarified.',
      'follow_up_questions:',
      '  - id: FU1',
      '    question: Which operations must the mutex serialize?',
      '    phase: Assembly',
      '    priority: high',
      '    rationale: Lock the mutex scope before PRD generation.',
    ].join('\n'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.repairApplied).toBe(true)
    expect(result.value.gaps).toEqual([
      '`repo_git_mutex` behavior is undefined and must be clarified.',
    ])
    expect(result.value.followUpQuestions).toEqual([
      {
        id: 'FU1',
        question: 'Which operations must the mutex serialize?',
        phase: 'Assembly',
        priority: 'high',
        rationale: 'Lock the mutex scope before PRD generation.',
      },
    ])
  })

  it('recovers interview questions with backtick scalars via loose parser fallback', () => {
    const result = normalizeInterviewQuestionsOutput([
      'questions:',
      '  - id: Q01',
      '    phase: foundation',
      '    question: `repo_git_mutex` behavior?',
    ].join('\n'), 5)

    // YAML rejects backtick scalars, but the loose parser recovers the question
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.questions).toHaveLength(1)
    expect(result.value.questions[0]!.question).toContain('repo_git_mutex')
  })

  it('auto-repairs duplicate question ids by renumbering above the max', () => {
    const result = normalizeInterviewQuestionsOutput([
      'questions:',
      '  - id: Q01',
      '    phase: foundation',
      '    question: "What problem?"',
      '  - id: Q02',
      '    phase: foundation',
      '    question: "Who is the user?"',
      '  - id: Q01',
      '    phase: structure',
      '    question: "What features?"',
      '  - id: Q02',
      '    phase: assembly',
      '    question: "Edge cases?"',
    ].join('\n'), 10)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.repairApplied).toBe(true)
    expect(result.repairWarnings.some(w => w.includes('Renumbered duplicate question id'))).toBe(true)
    // First occurrences keep their IDs, duplicates get Q03 and Q04
    const ids = result.value.questions.map(q => q.id)
    expect(ids).toContain('Q01')
    expect(ids).toContain('Q02')
    expect(ids).toContain('Q03')
    expect(ids).toContain('Q04')
    expect(result.value.questionCount).toBe(4)
  })

  it('keeps original ids when no duplicates exist', () => {
    const result = normalizeInterviewQuestionsOutput([
      'questions:',
      '  - id: Q01',
      '    phase: foundation',
      '    question: "What problem?"',
      '  - id: Q02',
      '    phase: structure',
      '    question: "What features?"',
    ].join('\n'), 10)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.repairWarnings.filter(w => w.includes('Renumbered'))).toHaveLength(0)
    expect(result.value.questions.map(q => q.id)).toEqual(['Q01', 'Q02'])
  })

  it('normalizes PROM4 batch envelopes with wrapper noise and indentation repair', () => {
    const result = normalizeInterviewTurnOutput([
      '[assistant] <INTERVIEW_BATCH>',
      '```yaml',
      'payload:',
      '  batchNumber: "2"',
      '  progress:',
      '   current: "4"',
      '   total: "6"',
      '  isFinalFreeForm: false',
      '  aiCommentary: Ask the missing edge-case questions now.',
      '  questions:',
      '   - id: Q04',
      '     prompt: What happens when the cluster restarts?',
      '     category: structure',
      '     priority: HIGH',
      '     rationale: Capture resilience expectations.',
      '```',
      '</INTERVIEW_BATCH>',
    ].join('\n'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.kind).toBe('batch')
    if (result.value.kind !== 'batch') return
    expect(result.value.batch.batchNumber).toBe(2)
    expect(result.value.batch.questions[0]).toMatchObject({
      id: 'Q04',
      question: 'What happens when the cluster restarts?',
      phase: 'Structure',
      priority: 'high',
    })
  })

  it('truncates interview batches with more than 3 questions to first 3', () => {
    const result = normalizeInterviewTurnOutput([
      '<INTERVIEW_BATCH>',
      'batch_number: 1',
      'progress:',
      '  current: 0',
      '  total: 5',
      'questions:',
      '  - id: Q01',
      '    question: "Question one?"',
      '  - id: Q02',
      '    question: "Question two?"',
      '  - id: Q03',
      '    question: "Question three?"',
      '  - id: Q04',
      '    question: "Question four?"',
      '  - id: Q05',
      '    question: "Question five?"',
      '</INTERVIEW_BATCH>',
    ].join('\n'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.kind).toBe('batch')
    if (result.value.kind !== 'batch') return
    expect(result.value.batch.questions).toHaveLength(3)
    expect(result.value.batch.questions.map((q) => q.id)).toEqual(['Q01', 'Q02', 'Q03'])
  })

  it('normalizes PROM4 complete envelopes with transcript prefixes', () => {
    const result = normalizeInterviewTurnOutput([
      '[assistant] <INTERVIEW_COMPLETE>',
      '```yaml',
      'interview:',
      '  schema_version: 1',
      '  artifact: interview',
      '  questions:',
      '    - id: Q01',
      '      prompt: What is the goal?',
      '  approval:',
      '    approved_by: ""',
      '    approved_at: ""',
      '```',
      '</INTERVIEW_COMPLETE>',
    ].join('\n'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.kind).toBe('complete')
    if (result.value.kind !== 'complete') return
    expect(result.value.finalYaml).toContain('schema_version: 1')
    expect(result.value.finalYaml).toContain('artifact: interview')
  })

  it('normalizes PROM4 complete envelopes that use answer audit entries', () => {
    const result = normalizeInterviewTurnOutput([
      '<INTERVIEW_COMPLETE>',
      '---',
      'ticket_id: "LOOTR-5"',
      'status: "complete"',
      'answers:',
      '  - id: "Q01"',
      '    phase: "Foundation"',
      '    question: "What is the goal?"',
      '    answer: "Accuracy"',
      '    status: "answered"',
      'derived_findings:',
      '  primary_consumer: "interview"',
      '</INTERVIEW_COMPLETE>',
    ].join('\n'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.kind).toBe('complete')
    if (result.value.kind !== 'complete') return
    expect(result.value.finalYaml).toContain('ticket_id: LOOTR-5')
    expect(result.value.finalYaml).toContain('answers:')
    expect(result.value.finalYaml).toContain('derived_findings:')
  })

  it('normalizes BEAD_STATUS markers with YAML payloads and gate aliases', () => {
    const result = normalizeBeadCompletionMarkerOutput([
      'work done',
      '<BEAD_STATUS>',
      '```yaml',
      'beadStatus:',
      '  beadId: bead-1',
      '  status: done',
      '  gates:',
      '    test: passed',
      '    lint: ok',
      '    type_check: success',
      '    qualitative_review: true',
      '```',
      '</BEAD_STATUS>',
    ].join('\n'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual({
      beadId: 'bead-1',
      status: 'completed',
      checks: {
        tests: 'pass',
        lint: 'pass',
        typecheck: 'pass',
        qualitative: 'pass',
      },
    })
  })

  it('normalizes FINAL_TEST_COMMANDS markers and single-string commands', () => {
    const result = normalizeFinalTestCommandsOutput([
      '[assistant] <FINAL_TEST_COMMANDS>',
      '```yaml',
      'command_plan:',
      '  commands: npm run test:server',
      '  summary: verify the whole workflow',
      '```',
      '</FINAL_TEST_COMMANDS>',
    ].join('\n'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual({
      commands: ['npm run test:server'],
      summary: 'verify the whole workflow',
    })
  })

  it('normalizes tagged relevant-files payloads', () => {
    const result = normalizeRelevantFilesOutput([
      '<RELEVANT_FILES_RESULT>',
      'file_count: 1',
      'files:',
      '  - path: src/app.ts',
      '    rationale: Entry point for the app.',
      '    relevance: high',
      '    likely_action: modify',
      '    content: |',
      '      export const app = true',
      '</RELEVANT_FILES_RESULT>',
    ].join('\n'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.file_count).toBe(1)
    expect(result.value.files[0]).toMatchObject({
      path: 'src/app.ts',
      rationale: 'Entry point for the app.',
      relevance: 'high',
      likely_action: 'modify',
    })
  })

  it('repairs relevant-files payloads with transcript noise, fenced YAML, wrapper keys, aliases, and indentation drift', () => {
    const result = normalizeRelevantFilesOutput([
      '[assistant] <RELEVANT_FILES_RESULT>',
      '```yaml',
      'payload:',
      '  file_count: 1',
      '  files:',
      '    - filepath: src/routes.ts',
      '     reason: Central routing surface for the ticket.',
      '      relevance: HIGH',
      '     action: MODIFY',
      '     source: |',
      '       export const routes = []',
      '```',
      '</RELEVANT_FILES_RESULT>',
    ].join('\n'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.repairApplied).toBe(true)
    expect(result.value.file_count).toBe(1)
    expect(result.value.files).toHaveLength(1)
    expect(result.value.files[0]).toMatchObject({
      path: 'src/routes.ts',
      rationale: 'Central routing surface for the ticket.',
      relevance: 'high',
      likely_action: 'modify',
    })
    expect(result.value.files[0]?.content).toContain('export const routes = []')
  })

  it('rejects relevant-files prompt echoes with a clear validation error', () => {
    const result = normalizeRelevantFilesOutput([
      'CRITICAL OUTPUT RULE:',
      'Return strict machine-readable output.',
      '',
      'CONTEXT REFRESH:',
      'Use the latest ticket context.',
      '',
      '## System Role',
      'You are an expert software architect.',
      '',
      '## Instructions',
      '1. Read the relevant files.',
    ].join('\n'))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('echoed the prompt')
  })

  it('recovers complete file entries from a truncated response with no close tag', () => {
    // The last entry is cut off mid-key (no colon), causing YAML parse failure.
    // Truncation recovery removes the incomplete entry.
    const result = normalizeRelevantFilesOutput([
      '<RELEVANT_FILES_RESULT>',
      'file_count: 3',
      'files:',
      '  - path: src/app.ts',
      '    rationale: Entry point.',
      '    relevance: high',
      '    likely_action: modify',
      '    content: |',
      '      export const app = true',
      '  - path: src/utils.ts',
      '    rationale: Helper utilities.',
      '    relevance: medium',
      '    likely_action: read',
      '    content: |',
      '      export function help() {}',
      '  - path: src/broken.ts',
      '    rationale: This entry gets cut off.',
      '    relevance: high',
      '    likely_action: modify',
      '    content: |',
      '      import { foo } from "./foo"',
      '      export function broken() {',
      '    relev',
      // No closing tag — truncated mid-key, breaking YAML parsing
    ].join('\n'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.files).toHaveLength(2)
    expect(result.value.file_count).toBe(2)
    expect(result.value.files[0]?.path).toBe('src/app.ts')
    expect(result.value.files[1]?.path).toBe('src/utils.ts')
  })

  it('strips spurious </files> XML tag inside YAML and parses successfully', () => {
    const result = normalizeRelevantFilesOutput([
      '<RELEVANT_FILES_RESULT>',
      'file_count: 1',
      'files:',
      '  - path: src/app.ts',
      '    rationale: Entry point.',
      '    relevance: high',
      '    likely_action: modify',
      '    content: |',
      '      export const app = true',
      '</files>',
      '</RELEVANT_FILES_RESULT>',
    ].join('\n'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.files).toHaveLength(1)
    expect(result.value.files[0]?.path).toBe('src/app.ts')
  })

  it('strips both <files> and </files> wrappers inside YAML', () => {
    const result = normalizeRelevantFilesOutput([
      '<RELEVANT_FILES_RESULT>',
      'file_count: 1',
      '<files>',
      'files:',
      '  - path: src/app.ts',
      '    rationale: Entry point.',
      '    relevance: high',
      '    likely_action: modify',
      '    content: |',
      '      export const app = true',
      '</files>',
      '</RELEVANT_FILES_RESULT>',
    ].join('\n'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.files).toHaveLength(1)
    expect(result.value.files[0]?.path).toBe('src/app.ts')
  })

  it('preserves angle brackets in YAML string values and block scalars', () => {
    const result = normalizeRelevantFilesOutput([
      '<RELEVANT_FILES_RESULT>',
      'file_count: 1',
      'files:',
      '  - path: src/component.tsx',
      '    rationale: "Contains <div>Hello</div> JSX"',
      '    relevance: high',
      '    likely_action: modify',
      '    content: |',
      '      export default function App() {',
      '        return <div>Hello</div>',
      '      }',
      '</RELEVANT_FILES_RESULT>',
    ].join('\n'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.files[0]?.rationale).toContain('<div>Hello</div>')
    expect(result.value.files[0]?.content).toContain('<div>Hello</div>')
  })

  it('handles combined truncated output with spurious XML tags', () => {
    const result = normalizeRelevantFilesOutput([
      '<RELEVANT_FILES_RESULT>',
      'file_count: 3',
      '<files>',
      'files:',
      '  - path: src/app.ts',
      '    rationale: Entry point.',
      '    relevance: high',
      '    likely_action: modify',
      '    content: |',
      '      export const app = true',
      '  - path: src/utils.ts',
      '    rationale: Helpers.',
      '    relevance: medium',
      '    likely_action: read',
      '    content: |',
      '      export function help() {}',
      '  - path: src/broken.ts',
      '    rationale: Truncated entry.',
      '    relevance: high',
      '    likely_action: modify',
      '    content: |',
      '      import { x } from "./x"',
      '    relev',
      // No closing tags — truncated mid-key with spurious <files> tag
    ].join('\n'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.files).toHaveLength(2)
    expect(result.value.files[0]?.path).toBe('src/app.ts')
    expect(result.value.files[1]?.path).toBe('src/utils.ts')
  })

  it('repairs plain scalar rationale containing colon-space', () => {
    const result = normalizeRelevantFilesOutput([
      '<RELEVANT_FILES_RESULT>',
      'file_count: 2',
      'files:',
      '  - path: server/sse/broadcaster.ts',
      '    relevance: high',
      '    likely_action: modify',
      '    rationale: This is the live-stream backbone.',
      '    content_preview: |',
      '      class SSEBroadcaster {}',
      '  - path: server/machines/ticketMachine.ts',
      '    relevance: high',
      '    likely_action: modify',
      "    rationale: Many of the ticket's correctness rules are state-machine rules: completion truth gates, non-completion for idle/paused/interrupted, stop reasons, and authoritative transition sources.",
      '    content_preview: |',
      '      export const ticketMachine = setup({})',
      '</RELEVANT_FILES_RESULT>',
    ].join('\n'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.repairApplied).toBe(true)
    expect(result.value.files).toHaveLength(2)
    expect(result.value.files[0]?.path).toBe('server/sse/broadcaster.ts')
    expect(result.value.files[1]?.path).toBe('server/machines/ticketMachine.ts')
    expect(result.value.files[1]?.rationale).toContain('state-machine rules: completion truth gates')
  })

  it('repairs multiple entries with colons in rationale values', () => {
    const result = normalizeRelevantFilesOutput([
      '<RELEVANT_FILES_RESULT>',
      'file_count: 3',
      'files:',
      '  - path: a.ts',
      '    rationale: Simple rationale.',
      '    relevance: high',
      '    likely_action: modify',
      '  - path: b.ts',
      '    rationale: Has colons: in the middle and again: here.',
      '    relevance: medium',
      '    likely_action: read',
      '  - path: c.ts',
      '    rationale: Also has key: value patterns and more: stuff here.',
      '    relevance: low',
      '    likely_action: read',
      '</RELEVANT_FILES_RESULT>',
    ].join('\n'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.files).toHaveLength(3)
    expect(result.value.files[1]?.rationale).toContain('Has colons: in the middle')
    expect(result.value.files[2]?.rationale).toContain('Also has key: value patterns')
  })

  it('repairs interview questions with missing space after list dash', () => {
    const result = normalizeInterviewQuestionsOutput([
      'questions:',
      '  -id: Q1',
      '    phase: foundation',
      '    question: "What is the primary business goal?"',
      '  - id: Q2',
      '    phase: foundation',
      '    question: "Who are the primary users?"',
      '  -id: Q3',
      '    phase: structure',
      '    question: "What features are required?"',
    ].join('\n'), 10)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.questions).toHaveLength(3)
    expect(result.value.questions[0]!.id).toBe('Q01')
    expect(result.value.questions[1]!.id).toBe('Q02')
    expect(result.value.questions[2]!.id).toBe('Q03')
  })

  it('repairs interview questions where all items have missing dash space', () => {
    const result = normalizeInterviewQuestionsOutput([
      'questions:',
      '  -id: Q1',
      '    phase: foundation',
      '    question: "What problem are we solving?"',
      '  -id: Q2',
      '    phase: structure',
      '    question: "What features are needed?"',
    ].join('\n'), 10)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.questions).toHaveLength(2)
    expect(result.value.questions[0]!.question).toBe('What problem are we solving?')
    expect(result.value.questions[1]!.question).toBe('What features are needed?')
  })

  it('normalizes yes_no answer_type to single_choice with Yes/No options in batch questions', () => {
    const result = normalizeInterviewTurnOutput([
      '<INTERVIEW_BATCH>',
      'batch_number: 1',
      'progress:',
      '  current: 1',
      '  total: 3',
      'is_final_free_form: false',
      'ai_commentary: "Testing yes_no type"',
      'questions:',
      '  - id: Q01',
      '    question: "Do you need authentication?"',
      '    phase: Foundation',
      '    priority: high',
      '    rationale: "Determines auth requirements"',
      '    answer_type: yes_no',
      '</INTERVIEW_BATCH>',
    ].join('\n'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.kind).toBe('batch')
    if (result.value.kind !== 'batch') return
    const q = result.value.batch.questions[0]!
    expect(q.answerType).toBe('single_choice')
    expect(q.options).toEqual([
      { id: 'yes', label: 'Yes' },
      { id: 'no', label: 'No' },
    ])
  })

  it('truncates single_choice options exceeding the maximum of 10', () => {
    const options = Array.from({ length: 12 }, (_, i) => `    - id: opt${i + 1}\n      label: "Option ${i + 1}"`)
    const result = normalizeInterviewTurnOutput([
      '<INTERVIEW_BATCH>',
      'batch_number: 1',
      'progress:',
      '  current: 1',
      '  total: 3',
      'is_final_free_form: false',
      'ai_commentary: "Testing option limits"',
      'questions:',
      '  - id: Q01',
      '    question: "Which database?"',
      '    phase: Foundation',
      '    priority: high',
      '    rationale: "DB choice"',
      '    answer_type: single_choice',
      '    options:',
      ...options,
      '</INTERVIEW_BATCH>',
    ].join('\n'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.kind).toBe('batch')
    if (result.value.kind !== 'batch') return
    expect(result.value.batch.questions[0]!.options).toHaveLength(10)
  })

  it('truncates multiple_choice options exceeding the maximum of 15', () => {
    const options = Array.from({ length: 18 }, (_, i) => `    - id: opt${i + 1}\n      label: "Option ${i + 1}"`)
    const result = normalizeInterviewTurnOutput([
      '<INTERVIEW_BATCH>',
      'batch_number: 1',
      'progress:',
      '  current: 1',
      '  total: 3',
      'is_final_free_form: false',
      'ai_commentary: "Testing option limits"',
      'questions:',
      '  - id: Q01',
      '    question: "Which platforms?"',
      '    phase: Foundation',
      '    priority: high',
      '    rationale: "Platform choice"',
      '    answer_type: multiple_choice',
      '    options:',
      ...options,
      '</INTERVIEW_BATCH>',
    ].join('\n'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.kind).toBe('batch')
    if (result.value.kind !== 'batch') return
    expect(result.value.batch.questions[0]!.options).toHaveLength(15)
  })

  it('downgrades single_choice to free_text when no options are provided', () => {
    const result = normalizeInterviewTurnOutput([
      '<INTERVIEW_BATCH>',
      'batch_number: 1',
      'progress:',
      '  current: 1',
      '  total: 3',
      'is_final_free_form: false',
      'ai_commentary: "Testing downgrade"',
      'questions:',
      '  - id: Q01',
      '    question: "Which database?"',
      '    phase: Foundation',
      '    priority: high',
      '    rationale: "DB choice"',
      '    answer_type: single_choice',
      '</INTERVIEW_BATCH>',
    ].join('\n'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.kind).toBe('batch')
    if (result.value.kind !== 'batch') return
    expect(result.value.batch.questions[0]!.answerType).toBeUndefined()
    expect(result.value.batch.questions[0]!.options).toBeUndefined()
  })

  it('keeps only the first duplicated options block in interview batches', () => {
    const result = normalizeInterviewTurnOutput([
      '<INTERVIEW_BATCH>',
      'batch_number: 12',
      'progress:',
      '  current: 12',
      '  total: 23',
      'is_final_free_form: false',
      'ai_commentary: "Testing duplicated options block"',
      'questions:',
      '  - id: Q25',
      '    question: "For obvious secret leak detection, what policy should apply at launch?"',
      '    phase: Assembly',
      '    priority: high',
      '    rationale: "This determines detector aggressiveness and whether teams can suppress known-safe matches."',
      '    answer_type: single_choice',
      '    options:',
      '      - id: opt1',
      '        label: "Strict signatures, no allowlist"',
      '      - id: opt2',
      '        label: "Strict signatures with allowlist"',
      '      - id: opt3',
      '        label: "Conservative low-false-positive only"',
      '      - id: opt4',
      '        label: "Warn only, never block"',
      '    options:',
      '      - id: opt1',
      '        label: "Strict signatures, no allowlist"',
      '      - id: opt2',
      '        label: "Strict signatures with allowlist"',
      '      - id: opt3',
      '        label: "Conservative low-false-positive only"',
      '      - id: opt4',
      '        label: "Warn only, never block"',
      '</INTERVIEW_BATCH>',
    ].join('\n'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.kind).toBe('batch')
    if (result.value.kind !== 'batch') return

    expect(result.value.batch.questions[0]!.options).toEqual([
      { id: 'opt1', label: 'Strict signatures, no allowlist' },
      { id: 'opt2', label: 'Strict signatures with allowlist' },
      { id: 'opt3', label: 'Conservative low-false-positive only' },
      { id: 'opt4', label: 'Warn only, never block' },
    ])
  })

  it('dedupes interview batch options by id and surfaces repair warnings', () => {
    const result = normalizeInterviewTurnOutput([
      '<INTERVIEW_BATCH>',
      'batch_number: 1',
      'progress:',
      '  current: 1',
      '  total: 3',
      'is_final_free_form: false',
      'ai_commentary: "Testing option dedupe"',
      'questions:',
      '  - id: Q01',
      '    question: "Which policy should apply?"',
      '    phase: Assembly',
      '    priority: high',
      '    rationale: "Dedupes duplicate ids."',
      '    answer_type: single_choice',
      '    options:',
      '      - id: opt1',
      '        label: "First"',
      '      - id: opt1',
      '        label: "Duplicate first"',
      '      - id: opt2',
      '        label: "Second"',
      '</INTERVIEW_BATCH>',
    ].join('\n'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.kind).toBe('batch')
    if (result.value.kind !== 'batch') return

    expect(result.value.batch.questions[0]!.options).toEqual([
      { id: 'opt1', label: 'First' },
      { id: 'opt2', label: 'Second' },
    ])
    expect(result.repairApplied).toBe(true)
    expect(result.repairWarnings.join('\n')).toContain('Interview batch question Q01: removed duplicate option ids opt1')
  })

  it('normalizes coverage follow-up questions with answer types', () => {
    const result = normalizeCoverageResultOutput([
      'status: gaps',
      'gaps:',
      '  - "Missing auth details"',
      'follow_up_questions:',
      '  - id: FU1',
      '    question: "Do you need OAuth?"',
      '    phase: Foundation',
      '    priority: high',
      '    rationale: "Auth gap"',
      '    answer_type: yes_no',
      '  - id: FU2',
      '    question: "Which platforms to support?"',
      '    phase: Structure',
      '    priority: medium',
      '    rationale: "Platform gap"',
      '    answer_type: multiple_choice',
      '    options:',
      '      - id: web',
      '        label: "Web"',
      '      - id: ios',
      '        label: "iOS"',
      '      - id: android',
      '        label: "Android"',
    ].join('\n'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.followUpQuestions).toHaveLength(2)
    expect(result.value.followUpQuestions[0]).toMatchObject({
      id: 'FU1',
      question: 'Do you need OAuth?',
      answerType: 'single_choice',
      options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }],
    })
    expect(result.value.followUpQuestions[1]).toMatchObject({
      id: 'FU2',
      question: 'Which platforms to support?',
      answerType: 'multiple_choice',
      options: [
        { id: 'web', label: 'Web' },
        { id: 'ios', label: 'iOS' },
        { id: 'android', label: 'Android' },
      ],
    })
  })

  it('keeps only the first duplicated options block in coverage follow-up questions', () => {
    const result = normalizeCoverageResultOutput([
      'status: gaps',
      'gaps:',
      '  - "Missing secret detection policy"',
      'follow_up_questions:',
      '  - id: FU1',
      '    question: "What policy should apply at launch?"',
      '    phase: Assembly',
      '    priority: high',
      '    rationale: "Fix malformed duplicate options blocks."',
      '    answer_type: single_choice',
      '    options:',
      '      - id: opt1',
      '        label: "Strict signatures, no allowlist"',
      '      - id: opt2',
      '        label: "Strict signatures with allowlist"',
      '      - id: opt3',
      '        label: "Conservative low-false-positive only"',
      '      - id: opt4',
      '        label: "Warn only, never block"',
      '    options:',
      '      - id: opt1',
      '        label: "Strict signatures, no allowlist"',
      '      - id: opt2',
      '        label: "Strict signatures with allowlist"',
      '      - id: opt3',
      '        label: "Conservative low-false-positive only"',
      '      - id: opt4',
      '        label: "Warn only, never block"',
    ].join('\n'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.followUpQuestions[0]!.options).toEqual([
      { id: 'opt1', label: 'Strict signatures, no allowlist' },
      { id: 'opt2', label: 'Strict signatures with allowlist' },
      { id: 'opt3', label: 'Conservative low-false-positive only' },
      { id: 'opt4', label: 'Warn only, never block' },
    ])
  })

  it('dedupes coverage follow-up options by id and surfaces repair warnings', () => {
    const result = normalizeCoverageResultOutput([
      'status: gaps',
      'gaps:',
      '  - "Missing selection policy"',
      'follow_up_questions:',
      '  - id: FU1',
      '    question: "Which policy should apply?"',
      '    phase: Assembly',
      '    priority: high',
      '    rationale: "Dedupes duplicate ids."',
      '    answer_type: single_choice',
      '    options:',
      '      - id: opt1',
      '        label: "First"',
      '      - id: opt1',
      '        label: "Duplicate first"',
      '      - id: opt2',
      '        label: "Second"',
    ].join('\n'))

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.followUpQuestions[0]!.options).toEqual([
      { id: 'opt1', label: 'First' },
      { id: 'opt2', label: 'Second' },
    ])
    expect(result.repairApplied).toBe(true)
    expect(result.repairWarnings.join('\n')).toContain('Coverage follow-up question FU1: removed duplicate option ids opt1')
  })

  it('normalizes interview documents, repairs yes/no answers, and syncs the final free-form summary', () => {
    const result = normalizeInterviewDocumentOutput([
      'schema_version: 1',
      'artifact: interview_results',
      'generated_by:',
      '  winner_model: openai/gpt-5',
      '  generated_at: 2026-03-20T10:00:00.000Z',
      'questions:',
      '  - id: Q01',
      '    phase: foundation',
      '    prompt: Should retries be visible?',
      '    source: compiled',
      '    answer_type: yes_no',
      '    answer:',
      '      skipped: false',
      '      selected_option_ids: [yes]',
      '      free_text: ""',
      '  - id: FINAL',
      '    phase: assembly',
      '    prompt: Anything else the team should know?',
      '    source: final_free_form',
      '    answer_type: free_text',
      '    answer:',
      '      skipped: false',
      '      selected_option_ids: []',
      '      free_text: Keep retries reviewable.',
      'summary:',
      '  goals: [Protect imports]',
      '  constraints: [No duplicate records]',
      '  non_goals: [Bulk reprocessing]',
      '  final_free_form_answer: stale summary text',
      'approval:',
      '  approved_by: ""',
      '  approved_at: ""',
    ].join('\n'), {
      ticketId: 'PROJ-42',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.ticket_id).toBe('PROJ-42')
    expect(result.value.artifact).toBe('interview')
    expect(result.value.questions[0]?.answer_type).toBe('single_choice')
    expect(result.value.questions[0]?.options).toEqual([
      { id: 'yes', label: 'Yes' },
      { id: 'no', label: 'No' },
    ])
    expect(result.value.summary.final_free_form_answer).toBe('Keep retries reviewable.')
    expect(result.repairApplied).toBe(true)
  })

  it('updates interview answers as draft edits and stamps approval separately', () => {
    const normalized = normalizeInterviewDocumentOutput([
      'schema_version: 1',
      'ticket_id: PROJ-42',
      'artifact: interview',
      'status: approved',
      'generated_by:',
      '  winner_model: openai/gpt-5',
      '  generated_at: 2026-03-20T10:00:00.000Z',
      'questions:',
      '  - id: Q01',
      '    phase: Foundation',
      '    prompt: Which constraints are fixed?',
      '    source: compiled',
      '    answer_type: free_text',
      '    answer:',
      '      skipped: false',
      '      selected_option_ids: []',
      '      free_text: Keep imports stable.',
      '      answered_at: 2026-03-20T10:05:00.000Z',
      '  - id: FINAL',
      '    phase: Assembly',
      '    prompt: Anything else the team should know?',
      '    source: final_free_form',
      '    answer_type: free_text',
      '    answer:',
      '      skipped: false',
      '      selected_option_ids: []',
      '      free_text: Watch retries closely.',
      '      answered_at: 2026-03-20T10:06:00.000Z',
      'follow_up_rounds: []',
      'summary:',
      '  goals: [Protect imports]',
      '  constraints: [No duplicate records]',
      '  non_goals: [Bulk reprocessing]',
      '  final_free_form_answer: Watch retries closely.',
      'approval:',
      '  approved_by: user',
      '  approved_at: 2026-03-20T10:10:00.000Z',
    ].join('\n'))

    expect(normalized.ok).toBe(true)
    if (!normalized.ok) return

    const drafted = updateInterviewDocumentAnswers(normalized.value, [
      {
        id: 'FINAL',
        answer: {
          skipped: false,
          selected_option_ids: [],
          free_text: 'Review retries and alerts together.',
        },
      },
    ], '2026-03-20T10:20:00.000Z')

    expect(drafted.status).toBe('draft')
    expect(drafted.approval).toEqual({
      approved_by: '',
      approved_at: '',
    })
    expect(drafted.summary.final_free_form_answer).toBe('Review retries and alerts together.')

    const approved = buildApprovedInterviewDocument(drafted, '2026-03-20T10:25:00.000Z')
    expect(approved.status).toBe('approved')
    expect(approved.approval).toEqual({
      approved_by: 'user',
      approved_at: '2026-03-20T10:25:00.000Z',
    })
  })
})
