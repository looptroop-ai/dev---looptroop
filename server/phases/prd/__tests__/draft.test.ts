import { describe, expect, it } from 'vitest'
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
import { TEST, makeInterviewYaml, makeInterviewQuestion, makePrdYaml } from '../../../test/factories'

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
    options?.onEvent?.({ type: 'done', sessionId })

    return response
  }

  async listSessions(): Promise<Session[]> { return this.sessions }
  async getSessionMessages(sessionId: string): Promise<Message[]> { return this.messages.get(sessionId) ?? [] }
  async *subscribeToEvents(sessionId: string, _signal?: AbortSignal): AsyncGenerator<StreamEvent> { yield { type: 'done', sessionId } }
  async abortSession(_sessionId: string): Promise<boolean> { return true }
  async assembleBeadContext(_ticketId: string, _beadId: string): Promise<PromptPart[]> { return [] }
  async assembleCouncilContext(_ticketId: string, _phase: string): Promise<PromptPart[]> { return [] }
  async checkHealth(): Promise<HealthStatus> { return { available: true } }
}

class SlowTestOpenCodeAdapter extends TestOpenCodeAdapter {
  constructor(responses: string[], private readonly delayMs: number) { super(responses) }

  override async promptSession(
    sessionId: string, parts: PromptPart[], signal?: AbortSignal, options?: PromptSessionOptions,
  ): Promise<string> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs))
    return super.promptSession(sessionId, parts, signal, options)
  }
}

const COUNCIL = [{ modelId: 'model-a', name: 'Model A' }]
const DRAFT_OPTS = { draftTimeoutMs: 1_000, minQuorum: 1, ticketExternalId: TEST.externalId }
const GENERATED_BY = { winner_model: 'model-a', generated_at: TEST.timestamp }
const ANSWERED = {
  skipped: false, selected_option_ids: [] as string[], free_text: 'Preserve council retry behavior and strict validation.',
  answered_by: 'ai_skip', answered_at: TEST.timestamp,
} as const

function resolvedYaml() {
  return makeInterviewYaml({
    status: 'draft', generated_by: GENERATED_BY,
    questions: [makeInterviewQuestion({ answer: { ...ANSWERED } })],
  })
}

function ticket(title: string, description: string, interview = makeInterviewYaml()) {
  return { ticketId: TEST.externalId, title, description, interview }
}

describe.concurrent('draftPRD', () => {
  it('builds the PRD voting prompt with anonymized drafts and a strict scorecard reminder', () => {
    const prompt = buildPrdVotePrompt(
      {
        ticketId: TEST.externalId, title: 'Vote on PRD drafts',
        description: 'Compare PRD candidates.', relevantFiles: 'files:\n  - path: src/main.ts',
        interview: `schema_version: 1\nticket_id: ${TEST.externalId}\nartifact: interview\nstatus: approved`,
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
      makeInterviewYaml({
        generated_by: GENERATED_BY,
        questions: [makeInterviewQuestion({
          phase: 'Assembly', prompt: 'Rewritten prompt that should be ignored',
          answer: { ...ANSWERED, answered_by: 'user' },
        })],
        summary: { goals: ['Changed summary'], constraints: [], non_goals: [], final_free_form_answer: '' },
        approval: { approved_by: 'user', approved_at: TEST.timestamp },
      }),
      makePrdYaml(),
    ])

    const result = await draftPRD(adapter, COUNCIL,
      ticket('Salvage near-miss full answers', 'Treat the approved interview as canonical structure for future tickets.'),
      '/tmp/test', DRAFT_OPTS,
    )

    expect(result.fullAnswers[0]).toMatchObject({
      memberId: 'model-a', outcome: 'completed',
      structuredOutput: { autoRetryCount: 0, repairApplied: true },
    })
    expect(result.fullAnswers[0]?.content).toContain('prompt: What are the key requirements?')
    expect(result.fullAnswers[0]?.content).not.toContain('Rewritten prompt that should be ignored')
    expect(adapter.messages.get('mock-session-1')?.some((message) => typeof message.content === 'string' && message.content.includes('Structured Output Retry'))).toBe(false)
  })

  it('uses the complete latest assistant message when the immediate full-answers response is a truncated prefix', async () => {
    const fullAnswers = resolvedYaml()
    const adapter = new TestOpenCodeAdapter([
      { response: fullAnswers.slice(0, fullAnswers.indexOf('follow_up_rounds:')), messageContent: fullAnswers },
      makePrdYaml(),
    ])

    const result = await draftPRD(adapter, COUNCIL,
      ticket('Prefer full assistant snapshot', 'Use the latest assistant artifact when the immediate response is only a prefix.'),
      '/tmp/test', DRAFT_OPTS,
    )

    expect(result.fullAnswers[0]).toMatchObject({ memberId: 'model-a', outcome: 'completed', structuredOutput: { autoRetryCount: 0 } })
    expect(result.fullAnswers[0]?.content).toContain('follow_up_rounds: []')
    expect(result.drafts[0]).toMatchObject({ memberId: 'model-a', outcome: 'completed', draftMetrics: { epicCount: 1, userStoryCount: 1 } })
    expect(adapter.messages.get('mock-session-1')?.some((message) => typeof message.content === 'string' && message.content.includes('Structured Output Retry'))).toBe(false)
  })

  it('skips full answers and creates only one PRD session when no interview questions are skipped', async () => {
    const adapter = new TestOpenCodeAdapter([makePrdYaml()])
    const fullAnswerProgress: Array<{ status: string; sessionId?: string }> = []
    const draftProgress: Array<{ status: string; sessionId?: string }> = []
    const stepEvents: Array<{ step: string; status: string }> = []

    const result = await draftPRD(adapter, COUNCIL,
      ticket('Keep PRD sessions isolated', 'Skip gap resolution when the approved interview is complete.',
        makeInterviewYaml({
          questions: [makeInterviewQuestion({
            answer: { skipped: false, selected_option_ids: [], free_text: 'Use explicit PRD session boundaries.', answered_by: 'user', answered_at: TEST.timestamp },
          })],
        }),
      ),
      '/tmp/test', DRAFT_OPTS, undefined, undefined, undefined, undefined,
      (entry) => { draftProgress.push({ status: entry.status, sessionId: entry.sessionId }) },
      (entry) => { fullAnswerProgress.push({ status: entry.status, sessionId: entry.sessionId }) },
      (entry) => { stepEvents.push({ step: entry.step, status: entry.status }) },
    )

    expect(result.fullAnswers[0]).toMatchObject({ memberId: 'model-a', outcome: 'completed', questionCount: 1 })
    expect(result.fullAnswers[0]?.content).toContain('answered_by: user')
    expect(result.drafts[0]).toMatchObject({ memberId: 'model-a', outcome: 'completed', draftMetrics: { epicCount: 1, userStoryCount: 1 } })
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
      resolvedYaml(),
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
        `ticket_id: ${TEST.externalId}`,
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

    const result = await draftPRD(adapter, COUNCIL,
      ticket('Harden PRD drafting output', 'Keep the PRD drafting phase strict and restart-safe.'),
      '/tmp/test', DRAFT_OPTS, undefined, undefined, undefined, undefined,
      (entry) => { draftProgress.push({ status: entry.status, sessionId: entry.sessionId }) },
      (entry) => { fullAnswerProgress.push({ status: entry.status, sessionId: entry.sessionId }) },
    )

    expect(result.drafts).toHaveLength(1)
    expect(result.drafts[0]).toMatchObject({
      memberId: 'model-a', outcome: 'completed',
      draftMetrics: { epicCount: 1, userStoryCount: 1 },
      structuredOutput: { autoRetryCount: 1, repairApplied: true },
    })
    expect(result.fullAnswers[0]).toMatchObject({ memberId: 'model-a', outcome: 'completed', questionCount: 1 })
    expect(result.fullAnswers[0]?.content).toContain('answered_by: ai_skip')
    expect(result.drafts[0]?.content).toContain(`ticket_id: ${TEST.externalId}`)
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
    expect(adapter.messages.get('mock-session-2')?.some((message) => typeof message.content === 'string' && message.content.includes('Do not use tools.'))).toBe(true)
  })

  it('keeps full answers structured retries inside the same session while starting PRD drafting in a fresh one', async () => {
    const adapter = new TestOpenCodeAdapter(['This is not valid interview YAML.', resolvedYaml(), makePrdYaml()])
    const fullAnswerProgress: Array<{ status: string; sessionId?: string }> = []
    const draftProgress: Array<{ status: string; sessionId?: string }> = []

    const result = await draftPRD(adapter, COUNCIL,
      ticket('Retry full answers in place', 'Keep retries in-step but isolate PRD drafting into a new session.'),
      '/tmp/test', DRAFT_OPTS, undefined, undefined, undefined, undefined,
      (entry) => { draftProgress.push({ status: entry.status, sessionId: entry.sessionId }) },
      (entry) => { fullAnswerProgress.push({ status: entry.status, sessionId: entry.sessionId }) },
    )

    expect(result.fullAnswers[0]).toMatchObject({ memberId: 'model-a', outcome: 'completed', structuredOutput: { autoRetryCount: 1 } })
    expect(result.drafts[0]).toMatchObject({ memberId: 'model-a', outcome: 'completed', draftMetrics: { epicCount: 1, userStoryCount: 1 } })
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
    expect(fullAnswerRetryMessages[0]?.content).toContain('What are the key requirements?')
    expect(fullAnswerRetryMessages[0]?.content).toContain('Do not use tools.')
    expect(fullAnswerRetryMessages[0]?.content).toContain('Keep every generated free_text answer concise')
    expect(fullAnswerRetryMessages[0]?.content).toContain('If any free_text contains `:`')
    expect(fullAnswerRetryMessages[0]?.content).toContain('use only the existing canonical selected_option_ids')
    expect(fullAnswerRetryMessages[0]?.content).toContain('Set `status: draft`')
    expect(fullAnswerRetryMessages[0]?.content).toContain('keep `approval.approved_by: ""` plus `approval.approved_at: ""`')
    expect(fullAnswerRetryMessages[0]?.content).toContain('Stop immediately after the final approval block')
    expect(fullAnswerRetryMessages[0]?.content).not.toContain('Do not change `follow_up_rounds`, `summary`, or approval fields.')
    expect(adapter.messages.get('mock-session-2')?.some((message) => typeof message.content === 'string' && message.content.includes('Structured Output Retry'))).toBe(false)
  })

  it('restarts full answers in a fresh session when the model leaves skipped questions unanswered', async () => {
    const adapter = new TestOpenCodeAdapter([
      makeInterviewYaml({ status: 'draft', generated_by: GENERATED_BY }),
      resolvedYaml(),
      makePrdYaml(),
    ])

    const result = await draftPRD(adapter, COUNCIL,
      ticket('Restart unanswered full answers', 'Incomplete semantic full-answers artifacts should restart cleanly.'),
      '/tmp/test', DRAFT_OPTS,
    )

    expect(result.fullAnswers[0]).toMatchObject({ memberId: 'model-a', outcome: 'completed', structuredOutput: { autoRetryCount: 1 } })
    expect(result.drafts[0]?.outcome).toBe('completed')
    expect(adapter.sessions.map((session) => session.id)).toEqual(['mock-session-1', 'mock-session-2', 'mock-session-3'])
    expect(adapter.messages.get('mock-session-1')?.some((message) => typeof message.content === 'string' && message.content.includes('Structured Output Retry'))).toBe(false)
    expect(adapter.messages.get('mock-session-2')?.some((message) => typeof message.content === 'string' && message.content.includes('Structured Output Retry'))).toBe(false)
  })

  it('restarts full answers in a fresh session when the model omits canonical questions', async () => {
    const twoQResolved = makeInterviewYaml({
      status: 'draft', generated_by: GENERATED_BY,
      questions: [
        makeInterviewQuestion({ id: 'Q01', answer: { ...ANSWERED } }),
        makeInterviewQuestion({
          id: 'Q02', phase: 'Structure', prompt: 'Which session isolation guarantees are mandatory?',
          answer: { ...ANSWERED, free_text: 'Fresh-session retries must not inherit drifting context from invalid artifacts.' },
        }),
      ],
    })
    const adapter = new TestOpenCodeAdapter([resolvedYaml(), twoQResolved, makePrdYaml()])

    const result = await draftPRD(adapter, COUNCIL,
      ticket('Restart missing-question full answers', 'Missing canonical questions should force a clean retry session.',
        makeInterviewYaml({
          questions: [
            makeInterviewQuestion({ id: 'Q01' }),
            makeInterviewQuestion({ id: 'Q02', phase: 'Structure', prompt: 'Which session isolation guarantees are mandatory?' }),
          ],
        }),
      ),
      '/tmp/test', DRAFT_OPTS,
    )

    expect(result.fullAnswers[0]).toMatchObject({ memberId: 'model-a', outcome: 'completed', questionCount: 2, structuredOutput: { autoRetryCount: 1 } })
    expect(result.drafts[0]?.outcome).toBe('completed')
    expect(adapter.sessions.map((session) => session.id)).toEqual(['mock-session-1', 'mock-session-2', 'mock-session-3'])
    expect(adapter.messages.get('mock-session-1')?.some((message) => typeof message.content === 'string' && message.content.includes('Structured Output Retry'))).toBe(false)
    expect(adapter.messages.get('mock-session-2')?.some((message) => typeof message.content === 'string' && message.content.includes('Structured Output Retry'))).toBe(false)
  })

  it('keeps choice-mapping near misses on the same-session structured retry path', async () => {
    const choiceQ = { id: 'Q01', prompt: 'Who should consume the strategy?', answer_type: 'single_choice' as const, options: [{ id: 'opt1', label: 'Workflow engine' }, { id: 'opt2', label: 'Beads generation' }] }
    const adapter = new TestOpenCodeAdapter([
      makeInterviewYaml({
        status: 'draft', generated_by: GENERATED_BY,
        questions: [makeInterviewQuestion({ ...choiceQ, answer: { ...ANSWERED, free_text: 'Workflow engines' } })],
      }),
      makeInterviewYaml({
        status: 'draft', generated_by: GENERATED_BY,
        questions: [makeInterviewQuestion({ ...choiceQ, answer: { ...ANSWERED, selected_option_ids: ['opt1'], free_text: '' } })],
      }),
      makePrdYaml(),
    ])

    const result = await draftPRD(adapter, COUNCIL,
      ticket('Retry choice near misses in place', 'Exact option-ID mismatches should stay on the structured retry path.',
        makeInterviewYaml({ questions: [makeInterviewQuestion(choiceQ)] }),
      ),
      '/tmp/test', DRAFT_OPTS,
    )

    expect(result.fullAnswers[0]).toMatchObject({ memberId: 'model-a', outcome: 'completed', structuredOutput: { autoRetryCount: 1 } })
    expect(result.drafts[0]?.outcome).toBe('completed')
    expect(adapter.sessions.map((session) => session.id)).toEqual(['mock-session-1', 'mock-session-2'])
    const fullAnswerRetryMessages = adapter.messages.get('mock-session-1')?.filter((message) => typeof message.content === 'string' && message.content.includes('Full Answers Structured Output Retry')) ?? []
    expect(fullAnswerRetryMessages).toHaveLength(1)
    expect(fullAnswerRetryMessages[0]?.content).toContain('Only these skipped question answers may change: Q01')
    expect(adapter.messages.get('mock-session-2')?.some((message) => typeof message.content === 'string' && message.content.includes('Structured Output Retry'))).toBe(false)
  })

  it('continues to fail when the full-answers retry devolves into prose planning', async () => {
    const adapter = new TestOpenCodeAdapter([
      'This is not valid interview YAML.',
      '1. Introduce shard support.\n2. Add parser repairs.\n3. Update tests.',
    ])

    const result = await draftPRD(adapter, COUNCIL,
      ticket('Keep prose retries invalid', 'Pure prose should not be salvageable.'),
      '/tmp/test', DRAFT_OPTS,
    )

    expect(result.fullAnswers[0]).toMatchObject({ memberId: 'model-a', outcome: 'invalid_output', structuredOutput: { autoRetryCount: 1 } })
    expect(result.drafts[0]?.outcome).toBe('invalid_output')
    expect(adapter.sessions.map((session) => session.id)).toEqual(['mock-session-1'])
  })

  it('continues to fail when the full-answers retry is only a status message', async () => {
    const adapter = new TestOpenCodeAdapter([
      'This is not valid interview YAML.',
      'The complete interview artifact has been written to `.ticket/interview.yaml`.',
    ])

    const result = await draftPRD(adapter, COUNCIL,
      ticket('Keep status-message retries invalid', 'Status text is not a structured artifact.'),
      '/tmp/test', DRAFT_OPTS,
    )

    expect(result.fullAnswers[0]).toMatchObject({ memberId: 'model-a', outcome: 'invalid_output', structuredOutput: { autoRetryCount: 1 } })
    expect(result.drafts[0]?.outcome).toBe('invalid_output')
    expect(adapter.sessions.map((session) => session.id)).toEqual(['mock-session-1'])
  })

  it('restarts full answers in a fresh session after an empty response instead of sending a structured retry prompt', async () => {
    const adapter = new TestOpenCodeAdapter(['', resolvedYaml(), makePrdYaml()])

    const result = await draftPRD(adapter, COUNCIL,
      ticket('Restart empty full answers', 'Blank structured output should restart the session.'),
      '/tmp/test', DRAFT_OPTS,
    )

    expect(result.fullAnswers[0]).toMatchObject({ memberId: 'model-a', outcome: 'completed', structuredOutput: { autoRetryCount: 1 } })
    expect(result.drafts[0]?.outcome).toBe('completed')
    expect(adapter.sessions.map((session) => session.id)).toEqual(['mock-session-1', 'mock-session-2', 'mock-session-3'])
    expect(adapter.messages.get('mock-session-1')?.some((message) => typeof message.content === 'string' && message.content.includes('Structured Output Retry'))).toBe(false)
  })

  it('classifies repeated provider/session errors during prd_draft as failed instead of invalid_output', async () => {
    const adapter = new TestOpenCodeAdapter([
      resolvedYaml(),
      { response: '', error: "Provider returned error: The last message cannot have role 'assistant'" },
      { response: '', error: "Provider returned error: The last message cannot have role 'assistant'" },
    ])

    const result = await draftPRD(adapter, COUNCIL,
      ticket('Classify provider failures', 'Provider/session protocol failures should not be treated as invalid YAML.'),
      '/tmp/test', DRAFT_OPTS,
    )

    expect(result.fullAnswers[0]?.outcome).toBe('completed')
    expect(result.drafts[0]).toMatchObject({
      memberId: 'model-a', outcome: 'failed',
      structuredOutput: { autoRetryCount: 1, failureClass: 'session_protocol_error' },
    })
    expect(adapter.sessions.map((session) => session.id)).toEqual(['mock-session-1', 'mock-session-2', 'mock-session-3'])
    expect(adapter.messages.get('mock-session-2')?.some((message) => typeof message.content === 'string' && message.content.includes('Structured Output Retry'))).toBe(false)
    expect(adapter.messages.get('mock-session-3')?.some((message) => typeof message.content === 'string' && message.content.includes('Structured Output Retry'))).toBe(false)
  })

  it('continues to time out when the model misses the full-answers deadline', async () => {
    const adapter = new SlowTestOpenCodeAdapter([resolvedYaml()], 50)

    const result = await draftPRD(adapter, COUNCIL,
      ticket('Keep full-answers timeouts unchanged', 'Timeout policy is out of scope for this hardening pass.'),
      '/tmp/test', { draftTimeoutMs: 10, minQuorum: 1, ticketExternalId: TEST.externalId },
    )

    expect(result.fullAnswers[0]).toMatchObject({
      memberId: 'model-a', outcome: 'timed_out', error: 'AI response timeout reached after 10ms',
    })
    expect(result.drafts[0]?.outcome).toBe('timed_out')
    expect(adapter.sessions.map((session) => session.id)).toEqual(['mock-session-1'])
  })
})
