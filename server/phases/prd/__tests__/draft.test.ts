import { describe, expect, it } from 'vitest'
import type { InterviewDocument } from '@shared/interviewArtifact'
import { buildInterviewDocumentYaml } from '../../../structuredOutput'
import type { OpenCodeAdapter } from '../../../opencode/adapter'
import type {
  HealthStatus,
  Message,
  PromptPart,
  PromptSessionOptions,
  Session,
  StreamEvent,
} from '../../../opencode/types'
import { draftPRD } from '../draft'

class TestOpenCodeAdapter implements OpenCodeAdapter {
  public sessions: Session[] = []
  public messages = new Map<string, Message[]>()
  private readonly queuedResponses: string[]
  private sessionCounter = 0

  constructor(responses: string[]) {
    this.queuedResponses = [...responses]
  }

  async createSession(projectPath: string): Promise<Session> {
    const session: Session = {
      id: `mock-session-${++this.sessionCounter}`,
      projectPath,
      createdAt: new Date().toISOString(),
    }
    this.sessions.push(session)
    return session
  }

  async promptSession(
    sessionId: string,
    parts: PromptPart[],
    _signal?: AbortSignal,
    options?: PromptSessionOptions,
  ): Promise<string> {
    const response = this.queuedResponses.shift() ?? 'assistant response'
    const messages = this.messages.get(sessionId) ?? []

    for (const part of parts) {
      messages.push({
        id: `msg-${sessionId}-${messages.length + 1}`,
        role: 'user',
        content: part.content,
        timestamp: new Date().toISOString(),
      })
    }

    const assistantMessage: Message = {
      id: `msg-${sessionId}-${messages.length + 1}`,
      role: 'assistant',
      content: response,
      timestamp: new Date().toISOString(),
    }
    messages.push(assistantMessage)
    this.messages.set(sessionId, messages)

    options?.onEvent?.({
      type: 'text',
      sessionId,
      messageId: assistantMessage.id,
      partId: `part-${assistantMessage.id}`,
      text: response,
      streaming: false,
      complete: true,
    })
    options?.onEvent?.({
      type: 'done',
      sessionId,
    })

    return response
  }

  async listSessions(): Promise<Session[]> {
    return this.sessions
  }

  async getSessionMessages(sessionId: string): Promise<Message[]> {
    return this.messages.get(sessionId) ?? []
  }

  async *subscribeToEvents(sessionId: string, _signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    yield { type: 'done', sessionId }
  }

  async abortSession(_sessionId: string): Promise<boolean> {
    return true
  }

  async assembleBeadContext(_ticketId: string, _beadId: string): Promise<PromptPart[]> {
    return []
  }

  async assembleCouncilContext(_ticketId: string, _phase: string): Promise<PromptPart[]> {
    return []
  }

  async checkHealth(): Promise<HealthStatus> {
    return { available: true }
  }
}

function buildInterviewYaml(ticketId: string): string {
  const document: InterviewDocument = {
    schema_version: 1,
    ticket_id: ticketId,
    artifact: 'interview',
    status: 'approved',
    generated_by: {
      winner_model: 'openai/gpt-5',
      generated_at: '2026-03-23T09:00:00.000Z',
    },
    questions: [
      {
        id: 'Q01',
        phase: 'Foundation',
        prompt: 'Which workflow guardrails are mandatory?',
        source: 'compiled',
        follow_up_round: null,
        answer_type: 'free_text',
        options: [],
        answer: {
          skipped: true,
          selected_option_ids: [],
          free_text: '',
          answered_by: 'ai_skip',
          answered_at: '',
        },
      },
    ],
    follow_up_rounds: [],
    summary: {
      goals: ['Harden DRAFTING_PRD'],
      constraints: ['Preserve council mechanics'],
      non_goals: ['Touch PRD approval'],
      final_free_form_answer: '',
    },
    approval: {
      approved_by: '',
      approved_at: '',
    },
  }

  return buildInterviewDocumentYaml(document)
}

function buildInterviewYamlWithAnswer(
  ticketId: string,
  options: {
    skipped?: boolean
    freeText?: string
  } = {},
): string {
  const skipped = options.skipped ?? true
  const freeText = options.freeText ?? (skipped ? '' : 'Use explicit PRD session boundaries.')

  const document: InterviewDocument = {
    schema_version: 1,
    ticket_id: ticketId,
    artifact: 'interview',
    status: 'approved',
    generated_by: {
      winner_model: 'openai/gpt-5',
      generated_at: '2026-03-23T09:00:00.000Z',
    },
    questions: [
      {
        id: 'Q01',
        phase: 'Foundation',
        prompt: 'Which workflow guardrails are mandatory?',
        source: 'compiled',
        follow_up_round: null,
        answer_type: 'free_text',
        options: [],
        answer: {
          skipped,
          selected_option_ids: [],
          free_text: freeText,
          answered_by: skipped ? 'ai_skip' : 'user',
          answered_at: skipped ? '' : '2026-03-23T09:05:00.000Z',
        },
      },
    ],
    follow_up_rounds: [],
    summary: {
      goals: ['Harden DRAFTING_PRD'],
      constraints: ['Preserve council mechanics'],
      non_goals: ['Touch PRD approval'],
      final_free_form_answer: '',
    },
    approval: {
      approved_by: '',
      approved_at: '',
    },
  }

  return buildInterviewDocumentYaml(document)
}

function buildResolvedInterviewYaml(ticketId: string, memberId = 'model-a'): string {
  return [
    'schema_version: 1',
    `ticket_id: ${ticketId}`,
    'artifact: interview',
    'status: draft',
    'generated_by:',
    `  winner_model: ${memberId}`,
    '  generated_at: 2026-03-23T09:10:00.000Z',
    'questions:',
    '  - id: Q01',
    '    phase: Foundation',
    '    prompt: Which workflow guardrails are mandatory?',
    '    source: compiled',
    '    follow_up_round: null',
    '    answer_type: free_text',
    '    options: []',
    '    answer:',
    '      skipped: false',
    '      selected_option_ids: []',
    '      free_text: Preserve council retry behavior and strict validation.',
    '      answered_by: ai_skip',
    '      answered_at: 2026-03-23T09:11:00.000Z',
    'follow_up_rounds: []',
    'summary:',
    '  goals: [Harden DRAFTING_PRD]',
    '  constraints: [Preserve council mechanics]',
    '  non_goals: [Touch PRD approval]',
    '  final_free_form_answer: ""',
    'approval:',
    '  approved_by: ""',
    '  approved_at: ""',
  ].join('\n')
}

function buildPrdYaml(ticketId: string): string {
  return [
    'schema_version: 1',
    `ticket_id: ${ticketId}`,
    'artifact: prd',
    'status: draft',
    'source_interview:',
    '  content_sha256: stale',
    'product:',
    '  problem_statement: Keep PRD drafting resilient.',
    '  target_users: [LoopTroop maintainers]',
    'scope:',
    '  in_scope: [Normalize council PRD drafts]',
    '  out_of_scope: [PRD approval workflow]',
    'technical_requirements:',
    '  architecture_constraints: [Reuse council retry behavior]',
    '  data_model: []',
    '  api_contracts: []',
    '  security_constraints: []',
    '  performance_constraints: []',
    '  reliability_constraints: [Fail fast without canonical interview]',
    '  error_handling_rules: [Persist only normalized YAML]',
    '  tooling_assumptions: [Vitest remains the test runner]',
    'epics:',
    '  - id: EPIC-1',
    '    title: Draft parsing parity',
    '    objective: Match interview council draft rigor.',
    '    implementation_steps: [Normalize PRD drafts before persistence]',
    '    user_stories:',
    '      - id: US-1',
    '        title: Repair ids deterministically',
    '        acceptance_criteria: [Missing ids are repaired deterministically]',
    '        implementation_steps: [Fill stable fallback ids]',
    '        verification:',
    '          required_commands: [npm run test:server]',
    'risks: []',
    'approval:',
    '  approved_by: ""',
    '  approved_at: ""',
  ].join('\n')
}

describe('draftPRD', () => {
  it('skips full answers and creates only one PRD session when no interview questions are skipped', async () => {
    const adapter = new TestOpenCodeAdapter([
      buildPrdYaml('PROJ-10'),
    ])
    const fullAnswerProgress: Array<{ status: string; sessionId?: string }> = []
    const draftProgress: Array<{ status: string; sessionId?: string }> = []
    const stepEvents: Array<{ step: string; status: string }> = []

    const result = await draftPRD(
      adapter,
      [{ modelId: 'model-a', name: 'Model A' }],
      {
        ticketId: 'PROJ-10',
        title: 'Keep PRD sessions isolated',
        description: 'Skip gap resolution when the approved interview is complete.',
        interview: buildInterviewYamlWithAnswer('PROJ-10', { skipped: false }),
      },
      '/tmp/test',
      {
        draftTimeoutMs: 1_000,
        minQuorum: 1,
        ticketExternalId: 'PROJ-10',
      },
      undefined,
      undefined,
      undefined,
      undefined,
      (entry) => {
        draftProgress.push({ status: entry.status, sessionId: entry.sessionId })
      },
      (entry) => {
        fullAnswerProgress.push({ status: entry.status, sessionId: entry.sessionId })
      },
      (entry) => {
        stepEvents.push({ step: entry.step, status: entry.status })
      },
    )

    expect(result.fullAnswers[0]).toMatchObject({
      memberId: 'model-a',
      outcome: 'completed',
      questionCount: 1,
    })
    expect(result.fullAnswers[0]?.content).toContain('answered_by: user')
    expect(result.drafts[0]).toMatchObject({
      memberId: 'model-a',
      outcome: 'completed',
      draftMetrics: {
        epicCount: 1,
        userStoryCount: 1,
      },
    })
    expect(adapter.sessions.map((session) => session.id)).toEqual(['mock-session-1'])
    expect(fullAnswerProgress).toEqual([{ status: 'finished', sessionId: undefined }])
    expect(draftProgress).toEqual([
      { status: 'session_created', sessionId: 'mock-session-1' },
      { status: 'finished', sessionId: 'mock-session-1' },
    ])
    expect(stepEvents).toEqual([
      { step: 'full_answers', status: 'skipped' },
      { step: 'prd_draft', status: 'started' },
      { step: 'prd_draft', status: 'completed' },
    ])
  })

  it('retries invalid structured PRD output and keeps normalized metrics', async () => {
    const adapter = new TestOpenCodeAdapter([
      buildResolvedInterviewYaml('PROJ-9'),
      'I would draft a PRD with a few epics and stories.',
      [
        '```yaml',
        'schema_version: 1',
        'ticket_id: WRONG-ID',
        'artifact: prd',
        'status: draft',
        'source_interview:',
        '  content_sha256: stale',
        'product:',
        '  problem_statement: Keep PRD drafting resilient.',
        '  target_users: [LoopTroop maintainers]',
        'scope:',
        '  in_scope: [Normalize council PRD drafts]',
        '  out_of_scope: [PRD approval workflow]',
        'technical_requirements:',
        '  architecture_constraints: [Reuse council retry behavior]',
        '  data_model: []',
        '  api_contracts: []',
        '  security_constraints: []',
        '  performance_constraints: []',
        '  reliability_constraints: [Fail fast without canonical interview]',
        '  error_handling_rules: [Persist only normalized YAML]',
        '  tooling_assumptions: [Vitest remains the test runner]',
        'epics:',
        '  - title: Draft parsing parity',
        '    objective: Match interview council draft rigor.',
        '    implementation_steps: [Normalize PRD drafts before persistence]',
        '    user_stories:',
        '      - title: Repair ids deterministically',
        '        acceptance_criteria: [Missing ids are repaired deterministically]',
        '        implementation_steps: [Fill stable fallback ids]',
        '        verification:',
        '          required_commands: [npm run test:server]',
        'risks: []',
        'approval:',
        '  approved_by: ""',
        '  approved_at: ""',
        '```',
      ].join('\n'),
      [
        'schema_version: 1',
        'ticket_id: PROJ-9',
        'artifact: prd',
        'status: draft',
        'source_interview:',
        '  content_sha256: stale',
        'product:',
        '  problem_statement: Keep PRD drafting resilient.',
        '  target_users: [LoopTroop maintainers]',
        'scope:',
        '  in_scope: [Normalize council PRD drafts]',
        '  out_of_scope: [PRD approval workflow]',
        'technical_requirements:',
        '  architecture_constraints: [Reuse council retry behavior]',
        '  data_model: []',
        '  api_contracts: []',
        '  security_constraints: []',
        '  performance_constraints: []',
        '  reliability_constraints: [Fail fast without canonical interview]',
        '  error_handling_rules: [Persist only normalized YAML]',
        '  tooling_assumptions: [Vitest remains the test runner]',
        'epics:',
        '  - title: Draft parsing parity',
        '    objective: Match interview council draft rigor.',
        '    implementation_steps: [Normalize PRD drafts before persistence]',
        '    user_stories:',
        '      - title: Repair ids deterministically',
        '        acceptance_criteria: [Missing ids are repaired deterministically]',
        '        implementation_steps: [Fill stable fallback ids]',
        '        verification:',
        '          required_commands: [npm run test:server]',
        'approval:',
        '  approved_by: ""',
        '  approved_at: ""',
      ].join('\n'),
    ])
    const fullAnswerProgress: Array<{ status: string; sessionId?: string }> = []
    const draftProgress: Array<{ status: string; sessionId?: string }> = []

    const result = await draftPRD(
      adapter,
      [{ modelId: 'model-a', name: 'Model A' }],
      {
        ticketId: 'PROJ-9',
        title: 'Harden PRD drafting output',
        description: 'Keep the PRD drafting phase strict and restart-safe.',
        interview: buildInterviewYaml('PROJ-9'),
      },
      '/tmp/test',
      {
        draftTimeoutMs: 1_000,
        minQuorum: 1,
        ticketExternalId: 'PROJ-9',
      },
      undefined,
      undefined,
      undefined,
      undefined,
      (entry) => {
        draftProgress.push({ status: entry.status, sessionId: entry.sessionId })
      },
      (entry) => {
        fullAnswerProgress.push({ status: entry.status, sessionId: entry.sessionId })
      },
    )

    expect(result.drafts).toHaveLength(1)
    expect(result.drafts[0]).toMatchObject({
      memberId: 'model-a',
      outcome: 'completed',
      draftMetrics: {
        epicCount: 1,
        userStoryCount: 1,
      },
      structuredOutput: {
        autoRetryCount: 1,
        repairApplied: true,
      },
    })
    expect(result.fullAnswers[0]).toMatchObject({
      memberId: 'model-a',
      outcome: 'completed',
      questionCount: 1,
    })
    expect(result.fullAnswers[0]?.content).toContain('answered_by: ai_skip')
    expect(result.drafts[0]?.content).toContain('ticket_id: PROJ-9')
    expect(result.drafts[0]?.content).toContain('id: EPIC-1')
    expect(result.drafts[0]?.structuredOutput?.validationError).toBeTruthy()
    expect(adapter.sessions.map((session) => session.id)).toEqual(['mock-session-1', 'mock-session-2'])
    expect(fullAnswerProgress).toEqual([
      { status: 'session_created', sessionId: 'mock-session-1' },
      { status: 'finished', sessionId: 'mock-session-1' },
    ])
    expect(draftProgress).toEqual([
      { status: 'session_created', sessionId: 'mock-session-2' },
      { status: 'finished', sessionId: 'mock-session-2' },
    ])

    const messages = Array.from(adapter.messages.values()).flat()
    expect(messages.some((message) => typeof message.content === 'string' && message.content.includes('Structured Output Retry'))).toBe(true)
    expect(adapter.messages.get('mock-session-1')?.some((message) => typeof message.content === 'string' && message.content.includes('Structured Output Retry'))).toBe(false)
    expect(adapter.messages.get('mock-session-2')?.some((message) => typeof message.content === 'string' && message.content.includes('Structured Output Retry'))).toBe(true)
  })

  it('keeps full answers structured retries inside the same session while starting PRD drafting in a fresh one', async () => {
    const adapter = new TestOpenCodeAdapter([
      'This is not valid interview YAML.',
      buildResolvedInterviewYaml('PROJ-11'),
      buildPrdYaml('PROJ-11'),
    ])
    const fullAnswerProgress: Array<{ status: string; sessionId?: string }> = []
    const draftProgress: Array<{ status: string; sessionId?: string }> = []

    const result = await draftPRD(
      adapter,
      [{ modelId: 'model-a', name: 'Model A' }],
      {
        ticketId: 'PROJ-11',
        title: 'Retry full answers in place',
        description: 'Keep retries in-step but isolate PRD drafting into a new session.',
        interview: buildInterviewYaml('PROJ-11'),
      },
      '/tmp/test',
      {
        draftTimeoutMs: 1_000,
        minQuorum: 1,
        ticketExternalId: 'PROJ-11',
      },
      undefined,
      undefined,
      undefined,
      undefined,
      (entry) => {
        draftProgress.push({ status: entry.status, sessionId: entry.sessionId })
      },
      (entry) => {
        fullAnswerProgress.push({ status: entry.status, sessionId: entry.sessionId })
      },
    )

    expect(result.fullAnswers[0]).toMatchObject({
      memberId: 'model-a',
      outcome: 'completed',
      structuredOutput: {
        autoRetryCount: 1,
      },
    })
    expect(result.drafts[0]).toMatchObject({
      memberId: 'model-a',
      outcome: 'completed',
      draftMetrics: {
        epicCount: 1,
        userStoryCount: 1,
      },
    })
    expect(adapter.sessions.map((session) => session.id)).toEqual(['mock-session-1', 'mock-session-2'])
    expect(fullAnswerProgress).toEqual([
      { status: 'session_created', sessionId: 'mock-session-1' },
      { status: 'finished', sessionId: 'mock-session-1' },
    ])
    expect(draftProgress).toEqual([
      { status: 'session_created', sessionId: 'mock-session-2' },
      { status: 'finished', sessionId: 'mock-session-2' },
    ])
    expect(adapter.messages.get('mock-session-1')?.some((message) => typeof message.content === 'string' && message.content.includes('Structured Output Retry'))).toBe(true)
    expect(adapter.messages.get('mock-session-2')?.some((message) => typeof message.content === 'string' && message.content.includes('Structured Output Retry'))).toBe(false)
  })
})
