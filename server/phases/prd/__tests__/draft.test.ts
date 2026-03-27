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
import { buildPrdVotePrompt } from '../../../workflow/phases/prdPhase'

class TestOpenCodeAdapter implements OpenCodeAdapter {
  public sessions: Session[] = []
  public messages = new Map<string, Message[]>()
  private readonly queuedResponses: Array<string | { response: string; error?: string; messageContent?: string }>
  private sessionCounter = 0

  constructor(responses: Array<string | { response: string; error?: string; messageContent?: string }>) {
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
    const queued = this.queuedResponses.shift() ?? 'assistant response'
    const response = typeof queued === 'string' ? queued : queued.response
    const messageContent = typeof queued === 'string' ? response : (queued.messageContent ?? response)
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
      content: messageContent,
      timestamp: new Date().toISOString(),
      ...(typeof queued === 'string' || !queued.error
        ? {}
        : {
            info: {
              id: `msg-${sessionId}-${messages.length + 1}`,
              sessionID: sessionId,
              error: queued.error,
            },
          }),
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

class SlowTestOpenCodeAdapter extends TestOpenCodeAdapter {
  constructor(
    responses: string[],
    private readonly delayMs: number,
  ) {
    super(responses)
  }

  override async promptSession(
    sessionId: string,
    parts: PromptPart[],
    signal?: AbortSignal,
    options?: PromptSessionOptions,
  ): Promise<string> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs))
    return super.promptSession(sessionId, parts, signal, options)
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

function buildNearMissResolvedInterviewYaml(ticketId: string, memberId = 'model-a'): string {
  return [
    'schema_version: 1',
    `ticket_id: ${ticketId}`,
    'artifact: interview',
    'status: approved',
    'generated_by:',
    `  winner_model: ${memberId}`,
    '  generated_at: 2026-03-23T09:10:00.000Z',
    'questions:',
    '  - id: Q01',
    '    phase: Assembly',
    '    prompt: Rewritten prompt that should be ignored',
    '    source: compiled',
    '    follow_up_round: null',
    '    answer_type: free_text',
    '    options: []',
    '    answer:',
    '      skipped: false',
    '      selected_option_ids: []',
    '      free_text: Preserve council retry behavior and strict validation.',
    '      answered_by: user',
    '      answered_at: 2026-03-23T09:11:00.000Z',
    'follow_up_rounds: []',
    'summary:',
    '  goals: [Changed summary]',
    '  constraints: []',
    '  non_goals: []',
    '  final_free_form_answer: ""',
    'approval:',
    '  approved_by: user',
    '  approved_at: 2026-03-23T09:12:00.000Z',
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
  it('builds the PRD voting prompt with anonymized drafts and a strict scorecard reminder', () => {
    const prompt = buildPrdVotePrompt(
      {
        ticketId: 'PROJ-20',
        title: 'Vote on PRD drafts',
        description: 'Compare PRD candidates.',
        relevantFiles: 'files:\n  - path: src/main.ts',
        interview: [
          'schema_version: 1',
          'ticket_id: PROJ-20',
          'artifact: interview',
          'status: approved',
        ].join('\n'),
      },
      [
        { draftId: 'model-a', content: 'Draft 1:\nMock PRD alpha' },
        { draftId: 'model-b', content: 'Draft 2:\nMock PRD beta' },
      ],
    )

    const rendered = prompt.map((part) => part.content).join('\n')
    expect(rendered).toContain('You are an impartial judge on an AI Council.')
    expect(rendered).toContain('## Context')
    expect(rendered).toContain('### draft')
    expect(rendered).toContain('Draft 1:')
    expect(rendered).toContain('Draft 2:')
    expect(rendered).toContain('Use the exact PROM11 `draft_scores` YAML schema')
    expect(rendered).toContain('Coverage of requirements')
    expect(rendered).toContain('Correctness / feasibility')
  })

  it('salvages near-miss full answers without using a structured retry', async () => {
    const adapter = new TestOpenCodeAdapter([
      buildNearMissResolvedInterviewYaml('PROJ-12'),
      buildPrdYaml('PROJ-12'),
    ])

    const result = await draftPRD(
      adapter,
      [{ modelId: 'model-a', name: 'Model A' }],
      {
        ticketId: 'PROJ-12',
        title: 'Salvage near-miss full answers',
        description: 'Treat the approved interview as canonical structure for future tickets.',
        interview: buildInterviewYaml('PROJ-12'),
      },
      '/tmp/test',
      {
        draftTimeoutMs: 1_000,
        minQuorum: 1,
        ticketExternalId: 'PROJ-12',
      },
    )

    expect(result.fullAnswers[0]).toMatchObject({
      memberId: 'model-a',
      outcome: 'completed',
      structuredOutput: {
        autoRetryCount: 0,
        repairApplied: true,
      },
    })
    expect(result.fullAnswers[0]?.content).toContain('prompt: Which workflow guardrails are mandatory?')
    expect(result.fullAnswers[0]?.content).not.toContain('Rewritten prompt that should be ignored')
    expect(adapter.messages.get('mock-session-1')?.some((message) => typeof message.content === 'string' && message.content.includes('Structured Output Retry'))).toBe(false)
  })

  it('uses the complete latest assistant message when the immediate full-answers response is a truncated prefix', async () => {
    const fullAnswers = buildResolvedInterviewYaml('PROJ-18')
    const adapter = new TestOpenCodeAdapter([
      {
        response: fullAnswers.slice(0, fullAnswers.indexOf('follow_up_rounds:')),
        messageContent: fullAnswers,
      },
      buildPrdYaml('PROJ-18'),
    ])

    const result = await draftPRD(
      adapter,
      [{ modelId: 'model-a', name: 'Model A' }],
      {
        ticketId: 'PROJ-18',
        title: 'Prefer full assistant snapshot',
        description: 'Use the latest assistant artifact when the immediate response is only a prefix.',
        interview: buildInterviewYaml('PROJ-18'),
      },
      '/tmp/test',
      {
        draftTimeoutMs: 1_000,
        minQuorum: 1,
        ticketExternalId: 'PROJ-18',
      },
    )

    expect(result.fullAnswers[0]).toMatchObject({
      memberId: 'model-a',
      outcome: 'completed',
      structuredOutput: {
        autoRetryCount: 0,
      },
    })
    expect(result.fullAnswers[0]?.content).toContain('follow_up_rounds: []')
    expect(result.drafts[0]).toMatchObject({
      memberId: 'model-a',
      outcome: 'completed',
      draftMetrics: {
        epicCount: 1,
        userStoryCount: 1,
      },
    })
    expect(adapter.messages.get('mock-session-1')?.some((message) => typeof message.content === 'string' && message.content.includes('Structured Output Retry'))).toBe(false)
  })

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
    const fullAnswerRetryMessages = adapter.messages.get('mock-session-1')?.filter((message) => typeof message.content === 'string' && message.content.includes('Full Answers Structured Output Retry')) ?? []
    expect(fullAnswerRetryMessages).toHaveLength(1)
    expect(fullAnswerRetryMessages[0]?.content).toContain('Only these skipped question answers may change: Q01')
    expect(fullAnswerRetryMessages[0]?.content).toContain('Canonical approved interview artifact')
    expect(fullAnswerRetryMessages[0]?.content).toContain('Which workflow guardrails are mandatory?')
    expect(adapter.messages.get('mock-session-2')?.some((message) => typeof message.content === 'string' && message.content.includes('Structured Output Retry'))).toBe(false)
  })

  it('continues to fail when the full-answers retry devolves into prose planning', async () => {
    const adapter = new TestOpenCodeAdapter([
      'This is not valid interview YAML.',
      [
        '1. Introduce shard support.',
        '2. Add parser repairs.',
        '3. Update tests.',
      ].join('\n'),
    ])

    const result = await draftPRD(
      adapter,
      [{ modelId: 'model-a', name: 'Model A' }],
      {
        ticketId: 'PROJ-13',
        title: 'Keep prose retries invalid',
        description: 'Pure prose should not be salvageable.',
        interview: buildInterviewYaml('PROJ-13'),
      },
      '/tmp/test',
      {
        draftTimeoutMs: 1_000,
        minQuorum: 1,
        ticketExternalId: 'PROJ-13',
      },
    )

    expect(result.fullAnswers[0]).toMatchObject({
      memberId: 'model-a',
      outcome: 'invalid_output',
      structuredOutput: {
        autoRetryCount: 1,
      },
    })
    expect(result.drafts[0]?.outcome).toBe('invalid_output')
    expect(adapter.sessions.map((session) => session.id)).toEqual(['mock-session-1'])
  })

  it('continues to fail when the full-answers retry is only a status message', async () => {
    const adapter = new TestOpenCodeAdapter([
      'This is not valid interview YAML.',
      'The complete interview artifact has been written to `.ticket/interview.yaml`.',
    ])

    const result = await draftPRD(
      adapter,
      [{ modelId: 'model-a', name: 'Model A' }],
      {
        ticketId: 'PROJ-14',
        title: 'Keep status-message retries invalid',
        description: 'Status text is not a structured artifact.',
        interview: buildInterviewYaml('PROJ-14'),
      },
      '/tmp/test',
      {
        draftTimeoutMs: 1_000,
        minQuorum: 1,
        ticketExternalId: 'PROJ-14',
      },
    )

    expect(result.fullAnswers[0]).toMatchObject({
      memberId: 'model-a',
      outcome: 'invalid_output',
      structuredOutput: {
        autoRetryCount: 1,
      },
    })
    expect(result.drafts[0]?.outcome).toBe('invalid_output')
    expect(adapter.sessions.map((session) => session.id)).toEqual(['mock-session-1'])
  })

  it('restarts full answers in a fresh session after an empty response instead of sending a structured retry prompt', async () => {
    const adapter = new TestOpenCodeAdapter([
      '',
      buildResolvedInterviewYaml('PROJ-16'),
      buildPrdYaml('PROJ-16'),
    ])

    const result = await draftPRD(
      adapter,
      [{ modelId: 'model-a', name: 'Model A' }],
      {
        ticketId: 'PROJ-16',
        title: 'Restart empty full answers',
        description: 'Blank structured output should restart the session.',
        interview: buildInterviewYaml('PROJ-16'),
      },
      '/tmp/test',
      {
        draftTimeoutMs: 1_000,
        minQuorum: 1,
        ticketExternalId: 'PROJ-16',
      },
    )

    expect(result.fullAnswers[0]).toMatchObject({
      memberId: 'model-a',
      outcome: 'completed',
      structuredOutput: {
        autoRetryCount: 1,
      },
    })
    expect(result.drafts[0]?.outcome).toBe('completed')
    expect(adapter.sessions.map((session) => session.id)).toEqual(['mock-session-1', 'mock-session-2', 'mock-session-3'])
    expect(adapter.messages.get('mock-session-1')?.some((message) => typeof message.content === 'string' && message.content.includes('Structured Output Retry'))).toBe(false)
  })

  it('classifies repeated provider/session errors during prd_draft as failed instead of invalid_output', async () => {
    const adapter = new TestOpenCodeAdapter([
      buildResolvedInterviewYaml('PROJ-17'),
      { response: '', error: "Provider returned error: The last message cannot have role 'assistant'" },
      { response: '', error: "Provider returned error: The last message cannot have role 'assistant'" },
    ])

    const result = await draftPRD(
      adapter,
      [{ modelId: 'model-a', name: 'Model A' }],
      {
        ticketId: 'PROJ-17',
        title: 'Classify provider failures',
        description: 'Provider/session protocol failures should not be treated as invalid YAML.',
        interview: buildInterviewYaml('PROJ-17'),
      },
      '/tmp/test',
      {
        draftTimeoutMs: 1_000,
        minQuorum: 1,
        ticketExternalId: 'PROJ-17',
      },
    )

    expect(result.fullAnswers[0]?.outcome).toBe('completed')
    expect(result.drafts[0]).toMatchObject({
      memberId: 'model-a',
      outcome: 'failed',
      structuredOutput: {
        autoRetryCount: 1,
        failureClass: 'session_protocol_error',
      },
    })
    expect(adapter.sessions.map((session) => session.id)).toEqual(['mock-session-1', 'mock-session-2', 'mock-session-3'])
    expect(adapter.messages.get('mock-session-2')?.some((message) => typeof message.content === 'string' && message.content.includes('Structured Output Retry'))).toBe(false)
    expect(adapter.messages.get('mock-session-3')?.some((message) => typeof message.content === 'string' && message.content.includes('Structured Output Retry'))).toBe(false)
  })

  it('continues to time out when the model misses the full-answers deadline', async () => {
    const adapter = new SlowTestOpenCodeAdapter([
      buildResolvedInterviewYaml('PROJ-15'),
    ], 50)

    const result = await draftPRD(
      adapter,
      [{ modelId: 'model-a', name: 'Model A' }],
      {
        ticketId: 'PROJ-15',
        title: 'Keep full-answers timeouts unchanged',
        description: 'Timeout policy is out of scope for this hardening pass.',
        interview: buildInterviewYaml('PROJ-15'),
      },
      '/tmp/test',
      {
        draftTimeoutMs: 10,
        minQuorum: 1,
        ticketExternalId: 'PROJ-15',
      },
    )

    expect(result.fullAnswers[0]).toMatchObject({
      memberId: 'model-a',
      outcome: 'timed_out',
      error: 'AI response timeout reached after 10ms',
    })
    expect(result.drafts[0]?.outcome).toBe('timed_out')
    expect(adapter.sessions.map((session) => session.id)).toEqual(['mock-session-1'])
  })
})
