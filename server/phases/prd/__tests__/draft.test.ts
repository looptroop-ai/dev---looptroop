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

describe('draftPRD', () => {
  it('retries invalid structured PRD output and keeps normalized metrics', async () => {
    const adapter = new TestOpenCodeAdapter([
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
        'interview_gap_resolutions:',
        '  - prompt: Which workflow guardrails are mandatory?',
        '    resolution: Default to interview council retry semantics.',
        '    rationale: Avoid losing skipped-question intent.',
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
    ])

    const result = await draftPRD(
      adapter,
      [{ modelId: 'model-a', name: 'Model A' }],
      [
        { type: 'text', source: 'ticket_details', content: 'Ticket: Harden PRD drafting output.' },
        { type: 'text', source: 'interview', content: buildInterviewYaml('PROJ-9') },
      ],
      '/tmp/test',
      {
        draftTimeoutMs: 1_000,
        minQuorum: 1,
        ticketExternalId: 'PROJ-9',
      },
    )

    expect(result.drafts).toHaveLength(1)
    expect(result.drafts[0]).toMatchObject({
      memberId: 'model-a',
      outcome: 'completed',
      draftMetrics: {
        epicCount: 1,
        userStoryCount: 1,
        gapResolutionCount: 1,
      },
      structuredOutput: {
        autoRetryCount: 1,
        repairApplied: true,
      },
    })
    expect(result.drafts[0]?.content).toContain('ticket_id: PROJ-9')
    expect(result.drafts[0]?.content).toContain('question_id: Q01')
    expect(result.drafts[0]?.content).toContain('id: EPIC-1')
    expect(result.drafts[0]?.structuredOutput?.validationError).toBeTruthy()

    const messages = Array.from(adapter.messages.values()).flat()
    expect(messages.some((message) => typeof message.content === 'string' && message.content.includes('Structured Output Retry'))).toBe(true)
  })
})
