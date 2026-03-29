/**
 * Shared test factories for server-side tests.
 * Eliminates hardcoded ticket IDs, model names, and project-specific data.
 */
import type { InterviewDocument, InterviewDocumentQuestion } from '@shared/interviewArtifact'
import type { TicketContext } from '../machines/types'
import { buildInterviewDocumentYaml } from '../structuredOutput'
import { createTicket, getTicketPaths } from '../storage/tickets'
import { attachProject } from '../storage/projects'
import { initializeTicket } from '../ticket/initialize'
import { createFixtureRepoManager } from './fixtureRepo'
import { initializeDatabase } from '../db/init'
import { sqlite } from '../db/index'
import { clearProjectDatabaseCache } from '../db/project'

// ---------------------------------------------------------------------------
// Generic test constants — never reference real ticket/project names
// ---------------------------------------------------------------------------
export const TEST = {
  ticketId: '1:TEST-1',
  externalId: 'TEST-1',
  projectId: 1,
  projectName: 'TestProject',
  shortname: 'TEST',
  model: 'test-vendor/test-model',
  implementer: 'test-vendor/test-implementer',
  councilMembers: ['test-vendor/council-a', 'test-vendor/council-b'],
  timestamp: '2026-01-01T00:00:00.000Z',
} as const

// ---------------------------------------------------------------------------
// Machine TicketContext factory
// ---------------------------------------------------------------------------
export function makeTicketContext(
  overrides: Partial<TicketContext> = {},
): TicketContext {
  return {
    ticketId: TEST.ticketId,
    projectId: TEST.projectId,
    externalId: TEST.externalId,
    title: 'Test ticket',
    status: 'DRAFT',
    lockedMainImplementer: TEST.implementer,
    lockedMainImplementerVariant: null,
    lockedCouncilMembers: [...TEST.councilMembers],
    lockedCouncilMemberVariants: null,
    lockedInterviewQuestions: null,
    lockedCoverageFollowUpBudgetPercent: null,
    lockedMaxCoveragePasses: null,
    previousStatus: null,
    error: null,
    errorCodes: [],
    beadProgress: { total: 0, completed: 0, current: null },
    iterationCount: 0,
    maxIterations: 5,
    councilResults: null,
    createdAt: TEST.timestamp,
    updatedAt: TEST.timestamp,
    ...overrides,
  }
}

/**
 * Build a TicketContext from a real PublicTicket returned by createTicket().
 */
export function makeTicketContextFromTicket(
  ticket: ReturnType<typeof createTicket>,
  overrides: Partial<TicketContext> = {},
): TicketContext {
  return makeTicketContext({
    ticketId: ticket.id,
    projectId: ticket.projectId,
    externalId: ticket.externalId,
    title: ticket.title,
    status: ticket.status,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    ...overrides,
  })
}

// ---------------------------------------------------------------------------
// Interview document factory
// ---------------------------------------------------------------------------
export function makeInterviewQuestion(
  overrides: Partial<InterviewDocumentQuestion> = {},
): InterviewDocumentQuestion {
  return {
    id: 'Q01',
    phase: 'Foundation',
    prompt: 'What are the key requirements?',
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
    ...overrides,
  }
}

export function makeInterviewDocument(
  overrides: Partial<InterviewDocument> = {},
): InterviewDocument {
  return {
    schema_version: 1,
    ticket_id: TEST.externalId,
    artifact: 'interview',
    status: 'approved',
    generated_by: {
      winner_model: TEST.model,
      generated_at: TEST.timestamp,
    },
    questions: [makeInterviewQuestion()],
    follow_up_rounds: [],
    summary: {
      goals: ['Implement the feature'],
      constraints: ['Preserve existing behavior'],
      non_goals: ['Unrelated scope'],
      final_free_form_answer: '',
    },
    approval: {
      approved_by: '',
      approved_at: '',
    },
    ...overrides,
  }
}

export function makeInterviewYaml(
  overrides: Partial<InterviewDocument> = {},
): string {
  return buildInterviewDocumentYaml(makeInterviewDocument(overrides))
}

// ---------------------------------------------------------------------------
// PRD YAML factory
// ---------------------------------------------------------------------------
export function makePrdYaml(overrides: {
  ticketId?: string
  status?: string
  problemStatement?: string
  epicCount?: number
  storyCount?: number
} = {}): string {
  const tid = overrides.ticketId ?? TEST.externalId
  const status = overrides.status ?? 'draft'
  const problem = overrides.problemStatement ?? 'Implement the planned feature.'
  const epicCount = overrides.epicCount ?? 1
  const storyCount = overrides.storyCount ?? 1

  const epics: string[] = []
  for (let e = 1; e <= epicCount; e++) {
    epics.push(
      `  - id: EPIC-${e}`,
      `    title: Epic ${e}`,
      `    objective: Deliver epic ${e}.`,
      `    implementation_steps: [Implement epic ${e}]`,
      `    user_stories:`,
    )
    for (let s = 1; s <= storyCount; s++) {
      epics.push(
        `      - id: US-${s}`,
        `        title: Story ${s}`,
        `        acceptance_criteria: [Criteria ${s}]`,
        `        implementation_steps: [Implement story ${s}]`,
        `        verification:`,
        `          required_commands: [npm run test]`,
      )
    }
  }

  return [
    'schema_version: 1',
    `ticket_id: ${tid}`,
    'artifact: prd',
    `status: ${status}`,
    'source_interview:',
    '  content_sha256: test-hash',
    'product:',
    `  problem_statement: ${problem}`,
    '  target_users: [Engineers]',
    'scope:',
    '  in_scope: [Feature implementation]',
    '  out_of_scope: [Unrelated scope]',
    'technical_requirements:',
    '  architecture_constraints: [Reuse existing patterns]',
    '  data_model: []',
    '  api_contracts: []',
    '  security_constraints: []',
    '  performance_constraints: []',
    '  reliability_constraints: [Fail fast on invalid input]',
    '  error_handling_rules: [Persist only normalized output]',
    '  tooling_assumptions: [Vitest test runner]',
    'epics:',
    ...epics,
    'risks: []',
    'approval:',
    '  approved_by: ""',
    '  approved_at: ""',
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Beads YAML factory
// ---------------------------------------------------------------------------
export function makeBeadsYaml(options: {
  beadCount?: number
} = {}): string {
  const count = options.beadCount ?? 1
  const lines = ['beads:']
  for (let i = 1; i <= count; i++) {
    lines.push(
      `  - id: "bead-${i}"`,
      `    title: "Bead ${i}"`,
      `    prdRefs: ["EPIC-1 / US-${i}"]`,
      `    description: "Implement bead ${i}."`,
      '    contextGuidance: |',
      '      Patterns:',
      '      - Follow existing conventions.',
      '      Anti-patterns:',
      '      - Avoid unnecessary scope.',
      '    acceptanceCriteria:',
      `      - "Bead ${i} acceptance criteria met"`,
      '    tests:',
      `      - "Bead ${i} tests pass"`,
      '    testCommands:',
      '      - "npm run test"',
    )
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Vote factory
// ---------------------------------------------------------------------------
export function makeVote(overrides: {
  voterId?: string
  draftId?: string
  scores?: Array<{ category: string; score: number; justification: string }>
  totalScore?: number
} = {}) {
  const scores = overrides.scores ?? [
    { category: 'Coverage', score: 18, justification: 'Good coverage.' },
    { category: 'Correctness', score: 17, justification: 'Sound approach.' },
    { category: 'Testability', score: 16, justification: 'Clear criteria.' },
    { category: 'Complexity', score: 15, justification: 'Well decomposed.' },
    { category: 'Risks', score: 14, justification: 'Risks addressed.' },
  ]
  return {
    voterId: overrides.voterId ?? TEST.councilMembers[0],
    draftId: overrides.draftId ?? 'draft-1',
    scores,
    totalScore: overrides.totalScore ?? scores.reduce((sum, s) => sum + s.score, 0),
  }
}

// ---------------------------------------------------------------------------
// Initialized ticket with real DB + filesystem (for integration-style tests)
// ---------------------------------------------------------------------------
export function createTestRepoManager(prefix = 'test-') {
  return createFixtureRepoManager({
    templatePrefix: `looptroop-${prefix}`,
    files: { 'README.md': '# Test Repository\n' },
  })
}

export function resetTestDb() {
  clearProjectDatabaseCache()
  initializeDatabase()
  sqlite.exec('DELETE FROM attached_projects; DELETE FROM profiles;')
}

export function createInitializedTestTicket(
  repoManager: ReturnType<typeof createTestRepoManager>,
  overrides: {
    projectName?: string
    shortname?: string
    title?: string
    description?: string
  } = {},
) {
  const repoDir = repoManager.createRepo()
  const project = attachProject({
    folderPath: repoDir,
    name: overrides.projectName ?? TEST.projectName,
    shortname: overrides.shortname ?? TEST.shortname,
  })
  const ticket = createTicket({
    projectId: project.id,
    title: overrides.title ?? 'Test ticket',
    description: overrides.description ?? 'Test description.',
  })

  initializeTicket({
    projectFolder: repoDir,
    externalId: ticket.externalId,
  })

  const paths = getTicketPaths(ticket.id)
  if (!paths) throw new Error('Expected ticket paths after initialization')

  return {
    ticket,
    context: makeTicketContextFromTicket(ticket),
    paths,
    repoDir,
    project,
  }
}
