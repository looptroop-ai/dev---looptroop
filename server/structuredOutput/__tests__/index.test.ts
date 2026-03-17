import { describe, expect, it } from 'vitest'
import {
  normalizeBeadCompletionMarkerOutput,
  normalizeBeadsJsonlOutput,
  normalizeBeadSubsetYamlOutput,
  normalizeCoverageResultOutput,
  normalizeFinalTestCommandsOutput,
  normalizeInterviewRefinementOutput,
  normalizeInterviewQuestionsOutput,
  normalizeInterviewTurnOutput,
  normalizePrdYamlOutput,
  normalizeVoteScorecardOutput,
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

  it('parses wrapped vote scorecards and rejects incorrect totals', () => {
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

    const invalid = normalizeVoteScorecardOutput(
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

    expect(invalid.ok).toBe(false)
    if (invalid.ok) return
    expect(invalid.error).toContain('total_score mismatch')
  })

  it('normalizes PRD YAML and fills deterministic metadata from runtime context', () => {
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
      interviewContent: 'interview',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.ticket_id).toBe('K8S-17')
    expect(result.value.artifact).toBe('prd')
    expect(result.value.epics).toHaveLength(1)
    expect(result.normalizedContent).toContain('schema_version: 1')
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
})
