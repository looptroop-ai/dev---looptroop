import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { eq } from 'drizzle-orm'
import { createActor } from 'xstate'
import { initializeTicket } from '../ticket/initialize'
import { ticketMachine } from '../machines/ticketMachine'
import type { TicketEvent } from '../machines/types'
import { db, sqlite } from './index'
import { profiles, projects, tickets, phaseArtifacts, opencodeSessions, ticketStatusHistory } from './schema'

console.log('🌱 Seeding database...')

type ProjectKey = 'ATLS' | 'VYNE' | 'QNTA'

const MAIN_FLOW = [
  'DRAFT',
  'COUNCIL_DELIBERATING',
  'COUNCIL_VOTING_INTERVIEW',
  'COMPILING_INTERVIEW',
  'WAITING_INTERVIEW_ANSWERS',
  'VERIFYING_INTERVIEW_COVERAGE',
  'WAITING_INTERVIEW_APPROVAL',
  'DRAFTING_PRD',
  'COUNCIL_VOTING_PRD',
  'REFINING_PRD',
  'VERIFYING_PRD_COVERAGE',
  'WAITING_PRD_APPROVAL',
  'DRAFTING_BEADS',
  'COUNCIL_VOTING_BEADS',
  'REFINING_BEADS',
  'VERIFYING_BEADS_COVERAGE',
  'WAITING_BEADS_APPROVAL',
  'PRE_FLIGHT_CHECK',
  'CODING',
  'RUNNING_FINAL_TEST',
  'INTEGRATING_CHANGES',
  'WAITING_MANUAL_VERIFICATION',
  'CLEANING_ENV',
  'COMPLETED',
] as const

type FlowStatus = (typeof MAIN_FLOW)[number]
type TicketStatus = FlowStatus | 'BLOCKED_ERROR' | 'CANCELED'
type BeadStatus = 'pending' | 'in_progress' | 'done' | 'error'

interface ProjectSeed {
  key: ProjectKey
  name: string
  icon: string
  color: string
  folderPath: string
  ticketCounter: number
}

interface TicketSeed {
  externalId: string
  projectKey: ProjectKey
  title: string
  description: string
  priority: number
  status: TicketStatus
}

interface TicketTimeline {
  createdHoursAgo: number
  updatedHoursAgo: number
  history: string[]
}

interface SeededTicketRow {
  id: number
  externalId: string
  projectId: number
  title: string
  createdAt: string
}

interface BeadRow {
  id: string
  title: string
  priority: number
  status: BeadStatus
  issue_type: string
  external_ref: string
  prd_references: string
  labels: string[]
  description: string
  context_guidance: {
    patterns: string[]
    anti_patterns: string[]
  }
  acceptance_criteria: string
  dependencies: {
    blocked_by: string[]
    blocks: string[]
  }
  target_files: string[]
  tests: string[]
  test_commands: string[]
  notes: string
  iteration: number
  created_at: string
  updated_at: string
  completed_at: string
  started_at: string
  bead_start_commit: string
}

const COUNCIL_MODELS = ['claude-sonnet-4-20250514', 'gpt-4o', 'gemini-2.5-pro'] as const
const COUNCIL_JSON = JSON.stringify(COUNCIL_MODELS)

const INTERVIEW_THRESHOLD = MAIN_FLOW.indexOf('WAITING_INTERVIEW_ANSWERS')
const PRD_THRESHOLD = MAIN_FLOW.indexOf('DRAFTING_PRD')
const BEADS_THRESHOLD = MAIN_FLOW.indexOf('DRAFTING_BEADS')
const PRE_FLIGHT_THRESHOLD = MAIN_FLOW.indexOf('PRE_FLIGHT_CHECK')
const CODING_THRESHOLD = MAIN_FLOW.indexOf('CODING')
const FINAL_TEST_THRESHOLD = MAIN_FLOW.indexOf('RUNNING_FINAL_TEST')

const STATUS_REASON: Record<string, string> = {
  DRAFT: 'Ticket created',
  COUNCIL_DELIBERATING: 'Interview drafting started',
  COUNCIL_VOTING_INTERVIEW: 'Interview drafts submitted for voting',
  COMPILING_INTERVIEW: 'Winning interview draft selected for compile',
  WAITING_INTERVIEW_ANSWERS: 'Interview questions compiled, awaiting answers',
  VERIFYING_INTERVIEW_COVERAGE: 'Answers submitted, verifying coverage',
  WAITING_INTERVIEW_APPROVAL: 'Coverage clean, awaiting interview approval',
  DRAFTING_PRD: 'Interview approved, drafting PRD',
  COUNCIL_VOTING_PRD: 'PRD drafts submitted for voting',
  REFINING_PRD: 'Winning PRD selected for refinement',
  VERIFYING_PRD_COVERAGE: 'Refined PRD under coverage verification',
  WAITING_PRD_APPROVAL: 'PRD coverage clean, awaiting approval',
  DRAFTING_BEADS: 'PRD approved, drafting beads',
  COUNCIL_VOTING_BEADS: 'Beads drafts submitted for voting',
  REFINING_BEADS: 'Winning beads plan selected for refinement',
  VERIFYING_BEADS_COVERAGE: 'Refined beads under coverage verification',
  WAITING_BEADS_APPROVAL: 'Beads coverage clean, awaiting approval',
  PRE_FLIGHT_CHECK: 'Beads approved, running pre-flight checks',
  CODING: 'Pre-flight checks passed, coding started',
  RUNNING_FINAL_TEST: 'All beads done, running final tests',
  INTEGRATING_CHANGES: 'Final tests passed, integrating changes',
  WAITING_MANUAL_VERIFICATION: 'Integration complete, waiting manual verification',
  CLEANING_ENV: 'Manual verification complete, cleaning environment',
  COMPLETED: 'Cleanup complete, ticket finished',
  BLOCKED_ERROR: 'Execution blocked by runtime error',
  CANCELED: 'Ticket canceled by user',
}

const projectSeeds: ProjectSeed[] = [
  {
    key: 'ATLS',
    name: 'Atlas Ledger',
    icon: '🧾',
    color: '#0F766E',
    folderPath: '/mnt/d/atlas-ledger',
    ticketCounter: 8,
  },
  {
    key: 'VYNE',
    name: 'Vyne Studio',
    icon: '🎬',
    color: '#C2410C',
    folderPath: '/mnt/d/vyne-studio',
    ticketCounter: 7,
  },
  {
    key: 'QNTA',
    name: 'Quanta Fleet',
    icon: '🚚',
    color: '#2563EB',
    folderPath: '/mnt/d/quanta-fleet',
    ticketCounter: 5,
  },
]

const ticketSeeds: TicketSeed[] = [
  {
    externalId: 'ATLS-1',
    projectKey: 'ATLS',
    title: 'Launch reconciliation workspace foundation',
    description: 'Set up the reconciliation dashboard shell, role-aware entry points, and baseline ledger navigation.',
    priority: 2,
    status: 'DRAFT',
  },
  {
    externalId: 'ATLS-2',
    projectKey: 'ATLS',
    title: 'Draft interview set for dispute queue intake',
    description: 'Generate council interview drafts covering dispute intake rules, operator workflows, and settlement constraints.',
    priority: 2,
    status: 'COUNCIL_DELIBERATING',
  },
  {
    externalId: 'ATLS-3',
    projectKey: 'ATLS',
    title: 'Vote on interview draft for settlement exception routing',
    description: 'Compare interview candidates for exception routing, escalations, and approval ownership boundaries.',
    priority: 3,
    status: 'COUNCIL_VOTING_INTERVIEW',
  },
  {
    externalId: 'ATLS-4',
    projectKey: 'ATLS',
    title: 'Compile merchant onboarding interview pack',
    description: 'Finalize the winning interview and prepare structured questions for merchant onboarding workflow design.',
    priority: 2,
    status: 'COMPILING_INTERVIEW',
  },
  {
    externalId: 'ATLS-5',
    projectKey: 'ATLS',
    title: 'Collect approvals for payout hold release flow',
    description: 'Gather stakeholder answers covering release approvals, audit controls, and payout exception handling.',
    priority: 2,
    status: 'WAITING_INTERVIEW_ANSWERS',
  },
  {
    externalId: 'ATLS-6',
    projectKey: 'ATLS',
    title: 'Verify interview coverage for multi-ledger rollback',
    description: 'Check that interview answers fully cover rollback sequencing, idempotency, and audit evidence.',
    priority: 1,
    status: 'VERIFYING_INTERVIEW_COVERAGE',
  },
  {
    externalId: 'ATLS-7',
    projectKey: 'ATLS',
    title: 'Approve interview for reserve account rebalancing',
    description: 'Review the finalized interview artifact before PRD drafting for reserve account balancing rules.',
    priority: 1,
    status: 'WAITING_INTERVIEW_APPROVAL',
  },
  {
    externalId: 'ATLS-8',
    projectKey: 'ATLS',
    title: 'Draft PRD for reconciliation variance cockpit',
    description: 'Create a PRD for investigating reconciliation variances with filters, drilldowns, and operator assignments.',
    priority: 2,
    status: 'DRAFTING_PRD',
  },
  {
    externalId: 'VYNE-1',
    projectKey: 'VYNE',
    title: 'Vote PRD variants for campaign review lanes',
    description: 'Compare PRD options for creator campaign review queues, feedback loops, and release gating.',
    priority: 1,
    status: 'COUNCIL_VOTING_PRD',
  },
  {
    externalId: 'VYNE-2',
    projectKey: 'VYNE',
    title: 'Refine PRD for asset review assistant',
    description: 'Refine the winning PRD to cover review heuristics, moderation checkpoints, and human override behavior.',
    priority: 1,
    status: 'REFINING_PRD',
  },
  {
    externalId: 'VYNE-3',
    projectKey: 'VYNE',
    title: 'Run PRD coverage for series launch planner',
    description: 'Verify the refined PRD covers launch sequencing, asset readiness, and release-governance edge cases.',
    priority: 2,
    status: 'VERIFYING_PRD_COVERAGE',
  },
  {
    externalId: 'VYNE-4',
    projectKey: 'VYNE',
    title: 'Approve PRD for creator entitlement sync',
    description: 'Await approval on entitlement sync rules spanning creator access, revocation timing, and auditability.',
    priority: 2,
    status: 'WAITING_PRD_APPROVAL',
  },
  {
    externalId: 'VYNE-5',
    projectKey: 'VYNE',
    title: 'Draft beads for media ingest retries',
    description: 'Break down ingest retry orchestration into bead-sized tasks with focused verification commands.',
    priority: 1,
    status: 'DRAFTING_BEADS',
  },
  {
    externalId: 'VYNE-6',
    projectKey: 'VYNE',
    title: 'Vote beads strategy for review SLA escalations',
    description: 'Evaluate bead breakdowns for review deadlines, automated escalation, and queue balancing.',
    priority: 2,
    status: 'COUNCIL_VOTING_BEADS',
  },
  {
    externalId: 'VYNE-7',
    projectKey: 'VYNE',
    title: 'Refine beads for publishing handoff tracking',
    description: 'Refine the selected bead plan so publishing handoffs, QA checks, and ownership transitions stay isolated.',
    priority: 3,
    status: 'REFINING_BEADS',
  },
  {
    externalId: 'QNTA-1',
    projectKey: 'QNTA',
    title: 'Verify beads coverage for dispatch surge board',
    description: 'Validate that beads cover surge routing, dispatch prioritization, and fallback assignment flows.',
    priority: 1,
    status: 'VERIFYING_BEADS_COVERAGE',
  },
  {
    externalId: 'QNTA-2',
    projectKey: 'QNTA',
    title: 'Approve beads plan for route deviation alerts',
    description: 'Review the bead plan for live route deviation alerts, acknowledgment timing, and escalation rules.',
    priority: 2,
    status: 'WAITING_BEADS_APPROVAL',
  },
  {
    externalId: 'QNTA-3',
    projectKey: 'QNTA',
    title: 'Run pre-flight checks for dock assignment optimizer',
    description: 'Run repository and runtime diagnostics before coding dock assignment optimization flows.',
    priority: 1,
    status: 'PRE_FLIGHT_CHECK',
  },
  {
    externalId: 'QNTA-4',
    projectKey: 'QNTA',
    title: 'Execute coding for live ETA recompute engine',
    description: 'Implement bead-scoped changes for live ETA recomputation while preserving existing dispatch contracts.',
    priority: 1,
    status: 'CODING',
  },
  {
    externalId: 'QNTA-5',
    projectKey: 'QNTA',
    title: 'Run final tests for manifest discrepancy repair',
    description: 'Execute the final verification suite after coding manifest discrepancy repair improvements.',
    priority: 1,
    status: 'RUNNING_FINAL_TEST',
  },
  {
    externalId: 'QNTA-6',
    projectKey: 'QNTA',
    title: 'Integrate route bundle handoff changes',
    description: 'Prepare and validate the clean integration candidate after final test success for route bundle handoffs.',
    priority: 1,
    status: 'INTEGRATING_CHANGES',
  },
  {
    externalId: 'QNTA-7',
    projectKey: 'QNTA',
    title: 'Await manual verification for detention reimbursement',
    description: 'Present the release candidate for detention reimbursement workflows and gather final human verification.',
    priority: 1,
    status: 'WAITING_MANUAL_VERIFICATION',
  },
  {
    externalId: 'QNTA-8',
    projectKey: 'QNTA',
    title: 'Recover blocked trailer swap orchestration',
    description: 'Investigate and resolve a runtime failure while processing trailer swap orchestration payloads.',
    priority: 1,
    status: 'BLOCKED_ERROR',
  },
  {
    externalId: 'QNTA-9',
    projectKey: 'QNTA',
    title: 'Complete carrier scorecard drilldown rollout',
    description: 'Finalize and ship carrier scorecard drilldowns with reporting summaries and verification receipts.',
    priority: 1,
    status: 'COMPLETED',
  },
]

const ago = (hours: number): string => new Date(Date.now() - hours * 3600000).toISOString()

function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36)
}

function ensureMockProjectRepo(projectFolder: string, projectName: string): void {
  mkdirSync(projectFolder, { recursive: true })

  try {
    const inside = execFileSync('git', ['-C', projectFolder, 'rev-parse', '--is-inside-work-tree'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()

    if (inside === 'true') {
      const hasMain = execFileSync('git', ['-C', projectFolder, 'show-ref', '--verify', '--quiet', 'refs/heads/main'], {
        stdio: ['ignore', 'ignore', 'ignore'],
      })
      void hasMain
      return
    }
  } catch {
    execFileSync('git', ['init', '-b', 'main', projectFolder], { stdio: ['ignore', 'ignore', 'ignore'] })
    writeFileSync(resolve(projectFolder, 'README.md'), `# ${projectName}\n\nMock repository used by the LoopTroop seed data.\n`)
    execFileSync('git', ['-C', projectFolder, 'add', 'README.md'], { stdio: ['ignore', 'ignore', 'ignore'] })
    execFileSync('git', ['-C', projectFolder, '-c', 'user.name=LoopTroop Seed', '-c', 'user.email=seed@looptroop.local', 'commit', '-m', 'Initial mock project scaffold'], {
      stdio: ['ignore', 'ignore', 'ignore'],
    })
  }
}

function historyForStatus(status: TicketStatus): string[] {
  if (status === 'BLOCKED_ERROR') {
    const codingIndex = MAIN_FLOW.indexOf('CODING')
    return [...MAIN_FLOW.slice(0, codingIndex + 1), 'BLOCKED_ERROR']
  }
  if (status === 'CANCELED') {
    return ['DRAFT', 'COUNCIL_DELIBERATING', 'CANCELED']
  }
  const index = MAIN_FLOW.indexOf(status as FlowStatus)
  if (index === -1) return ['DRAFT']
  return MAIN_FLOW.slice(0, index + 1)
}

function rankForStatus(status: TicketStatus): number {
  const inFlow = MAIN_FLOW.indexOf(status as FlowStatus)
  if (inFlow !== -1) return inFlow
  if (status === 'BLOCKED_ERROR') return CODING_THRESHOLD
  if (status === 'CANCELED') return MAIN_FLOW.indexOf('COUNCIL_DELIBERATING')
  return 0
}

function shouldWriteInterview(status: TicketStatus): boolean {
  return rankForStatus(status) >= INTERVIEW_THRESHOLD
}

function shouldWritePrd(status: TicketStatus): boolean {
  return rankForStatus(status) >= PRD_THRESHOLD
}

function shouldWriteBeads(status: TicketStatus): boolean {
  return rankForStatus(status) >= BEADS_THRESHOLD
}

function shouldHaveBranch(status: TicketStatus): boolean {
  return rankForStatus(status) >= PRE_FLIGHT_THRESHOLD
}

function percentForStatus(status: TicketStatus): number {
  if (status === 'BLOCKED_ERROR') return 68
  if (status === 'CANCELED') return 32
  const flowIndex = MAIN_FLOW.indexOf(status as FlowStatus)
  if (flowIndex === -1) return 0
  return Math.round((flowIndex / (MAIN_FLOW.length - 1)) * 100)
}

function beadProgressForStatus(status: TicketStatus): { current: number; total: number } | null {
  const total = 4
  const rank = rankForStatus(status)
  if (rank < BEADS_THRESHOLD) return null

  if (status === 'BLOCKED_ERROR') {
    return { current: 2, total }
  }

  if (rank < CODING_THRESHOLD) {
    return { current: 0, total }
  }

  if (rank >= FINAL_TEST_THRESHOLD) {
    return { current: total, total }
  }

  return { current: 2, total }
}

function beadStatesForStatus(status: TicketStatus): BeadStatus[] {
  if (status === 'BLOCKED_ERROR') {
    return ['done', 'error', 'pending', 'pending']
  }

  const rank = rankForStatus(status)
  if (rank >= FINAL_TEST_THRESHOLD) {
    return ['done', 'done', 'done', 'done']
  }

  if (rank >= CODING_THRESHOLD) {
    return ['done', 'in_progress', 'pending', 'pending']
  }

  return ['pending', 'pending', 'pending', 'pending']
}

function buildInterviewYaml(externalId: string, title: string, generatedAt: string, approvedAt: string): string {
  return [
    'schema_version: 1',
    `ticket_id: "${externalId}"`,
    'artifact: "interview"',
    'status: "approved"',
    'generated_by:',
    `  winner_model: "${COUNCIL_MODELS[0]}"`,
    `  generated_at: "${generatedAt}"`,
    'questions:',
    '  - id: "Q1"',
    `    prompt: "What is the business success criteria for ${title}?"`,
    '    answer_type: "free_text"',
    '    options: []',
    '    answer:',
    '      skipped: false',
    '      selected_option_ids: []',
    '      free_text: "Reduce manual steps while preserving deterministic behavior and traceability."',
    '      answered_by: "user"',
    `      answered_at: "${approvedAt}"`,
    '  - id: "Q2"',
    '    prompt: "Which constraints are non-negotiable for this implementation?"',
    '    answer_type: "free_text"',
    '    options: []',
    '    answer:',
    '      skipped: false',
    '      selected_option_ids: []',
    '      free_text: "Maintain idempotency, auditable transitions, and strict validation in approval gates."',
    '      answered_by: "user"',
    `      answered_at: "${approvedAt}"`,
    'follow_up_rounds: []',
    'summary:',
    '  goals:',
    '    - "Deliver an end-to-end reliable workflow."',
    '  constraints:',
    '    - "No breaking changes to existing API contracts."',
    '  non_goals:',
    '    - "No redesign of unrelated dashboard modules."',
    'approval:',
    '  approved_by: "user"',
    `  approved_at: "${approvedAt}"`,
    '',
  ].join('\n')
}

function buildPrdYaml(externalId: string, title: string, generatedAt: string, approvedAt: string): string {
  return [
    'schema_version: 1',
    `ticket_id: "${externalId}"`,
    'artifact: "prd"',
    'status: "approved"',
    'source_interview:',
    `  content_sha256: "mock-${externalId.toLowerCase()}-interview-sha"`,
    'product:',
    `  problem_statement: "${title} requires a robust implementation plan with clear acceptance criteria."`,
    '  target_users:',
    '    - "Operations team"',
    '    - "Engineering support"',
    'scope:',
    '  in_scope:',
    '    - "Workflow automation and verification"',
    '    - "Operational observability"',
    '  out_of_scope:',
    '    - "Cross-product design refresh"',
    'technical_requirements:',
    '  architecture_constraints:',
    '    - "Keep API backward compatible"',
    '  data_model:',
    '    - "Persist all transition artifacts with timestamps"',
    '  api_contracts:',
    '    - "Retain existing route semantics"',
    '  security_constraints:',
    '    - "No sensitive data in logs"',
    '  performance_constraints:',
    '    - "P95 write latency under 150ms"',
    '  reliability_constraints:',
    '    - "Operations must be retry-safe"',
    '  error_handling_rules:',
    '    - "Errors must preserve previous workflow state"',
    '  tooling_assumptions:',
    '    - "Node.js runtime and SQLite persistence"',
    'epics:',
    '  - id: "EPIC-1"',
    `    title: "${title}"`,
    '    objective: "Ship a testable and maintainable implementation path."',
    '    implementation_steps:',
    '      - "Define phase outputs"',
    '      - "Implement transitions and tests"',
    '    user_stories:',
    '      - id: "US-1"',
    '        title: "As an operator, I can trust status transitions and artifacts"',
    '        acceptance_criteria:',
    '          - "Status history is complete and chronological"',
    '          - "Artifacts exist for reached phases"',
    '        implementation_steps:',
    '          - "Generate and validate output files"',
    '        verification:',
    '          required_commands:',
    '            - "npm run test"',
    'risks:',
    '  - "Inconsistent mock data can confuse workflow review"',
    'approval:',
    '  approved_by: "user"',
    `  approved_at: "${approvedAt}"`,
    'generated_by:',
    `  winner_model: "${COUNCIL_MODELS[0]}"`,
    `  generated_at: "${generatedAt}"`,
    '',
  ].join('\n')
}

function buildBeads(externalId: string, title: string, status: TicketStatus, baseHoursAgo: number): BeadRow[] {
  const statuses = beadStatesForStatus(status)

  return statuses.map((beadStatus, index) => {
    const beadNum = index + 1
    const createdAt = ago(baseHoursAgo - beadNum * 8)
    const updatedAt = ago(baseHoursAgo - beadNum * 5)
    const startedAt = beadStatus === 'pending' ? '' : ago(baseHoursAgo - beadNum * 6)
    const completedAt = beadStatus === 'done' ? ago(baseHoursAgo - beadNum * 3) : ''

    return {
      id: `${externalId}-EPIC-1-US-1-task${beadNum}-m${beadNum}a${beadNum}`,
      title: `${title} - bead ${beadNum}`,
      priority: beadNum,
      status: beadStatus,
      issue_type: 'task',
      external_ref: externalId,
      prd_references: 'EPIC-1 / US-1',
      labels: [`ticket:${externalId}`, 'epic:EPIC-1', 'story:US-1'],
      description: `Implement bead ${beadNum} for ${title} with focused scope and verifiable behavior.`,
      context_guidance: {
        patterns: ['Preserve deterministic transitions', 'Write clear verification outputs'],
        anti_patterns: ['Coupling unrelated concerns', 'Hidden side effects'],
      },
      acceptance_criteria: `Bead ${beadNum} passes scoped tests and updates artifacts consistently.`,
      dependencies: {
        blocked_by: beadNum === 1 ? [] : [`${externalId}-EPIC-1-US-1-task${beadNum - 1}-m${beadNum - 1}a${beadNum - 1}`],
        blocks: beadNum === statuses.length ? [] : [`${externalId}-EPIC-1-US-1-task${beadNum + 1}-m${beadNum + 1}a${beadNum + 1}`],
      },
      target_files: [`src/modules/${externalId.toLowerCase()}/bead-${beadNum}.ts`],
      tests: [`Bead ${beadNum} acceptance test passes`],
      test_commands: ['npm run test'],
      notes: beadStatus === 'error' ? 'Runtime failure encountered while validating upstream payload shape.' : '',
      iteration: 1,
      created_at: createdAt,
      updated_at: updatedAt,
      completed_at: completedAt,
      started_at: startedAt,
      bead_start_commit: beadStatus === 'pending' ? '' : `mocksha${beadNum}${externalId.toLowerCase().replace('-', '')}`,
    }
  })
}

function toJsonl(rows: unknown[]): string {
  return rows.map((row) => JSON.stringify(row)).join('\n') + '\n'
}

function interviewDraftText(title: string, model: string): string {
  return [
    `# Interview Draft (${model})`,
    '',
    `1. Which requirements define success for ${title}?`,
    '2. Which constraints are hard limits and cannot be negotiated?',
    '3. Which failure scenarios should be tested before approval?',
  ].join('\n')
}

function prdDraftText(title: string, model: string): string {
  return [
    `# PRD Draft (${model})`,
    '',
    `## Problem`,
    `${title} needs a deterministic implementation plan with measurable acceptance criteria.`,
    '',
    '## Scope',
    '- Define implementation boundaries and validation rules',
    '- Capture risk and edge-case handling',
  ].join('\n')
}

function beadsDraftText(title: string, model: string): string {
  return [
    `# Beads Draft (${model})`,
    '',
    `## Bead 1: Setup for ${title}`,
    '- Establish working structure and interfaces',
    '',
    '## Bead 2: Core execution',
    '- Implement critical path behavior and tests',
    '',
    '## Bead 3: Verification and cleanup',
    '- Validate outputs and complete lifecycle checks',
  ].join('\n')
}

function buildCouncilDraftResult(kind: 'interview' | 'prd' | 'beads', title: string): string {
  const drafts = COUNCIL_MODELS.map((memberId, index) => {
    const content = kind === 'interview'
      ? interviewDraftText(title, memberId)
      : kind === 'prd'
        ? prdDraftText(title, memberId)
        : beadsDraftText(title, memberId)

    return {
      memberId,
      content,
      outcome: 'completed',
      duration: 9000 + index * 1200,
    }
  })

  const refinedContent = kind === 'interview'
    ? interviewDraftText(title, COUNCIL_MODELS[0])
    : kind === 'prd'
      ? prdDraftText(title, COUNCIL_MODELS[0])
      : beadsDraftText(title, COUNCIL_MODELS[0])

  return JSON.stringify({
    drafts,
    winnerId: COUNCIL_MODELS[0],
    winnerContent: drafts[0]?.content ?? '',
    refinedContent,
  })
}

function buildCouncilVoteResult(kind: 'interview' | 'prd' | 'beads', title: string): string {
  const draftResult = JSON.parse(buildCouncilDraftResult(kind, title)) as {
    drafts: Array<{ memberId: string; content: string; outcome: string; duration: number }>
    winnerId: string
    winnerContent: string
    refinedContent: string
  }

  const categories = ['Coverage', 'Correctness', 'Testability', 'Complexity', 'Risks']

  const votes = COUNCIL_MODELS.flatMap((voterId, voterIndex) => {
    return draftResult.drafts.map((draft, draftIndex) => {
      const scores = categories.map((category, categoryIndex) => ({
        category,
        score: Math.max(12, 20 - Math.abs(voterIndex - draftIndex) - categoryIndex),
      }))

      const totalScore = scores.reduce((sum, item) => sum + item.score, 0)
      return {
        voterId,
        draftId: draft.memberId,
        scores,
        totalScore,
      }
    })
  })

  return JSON.stringify({
    drafts: draftResult.drafts,
    votes,
    winnerId: draftResult.winnerId,
    winnerContent: draftResult.winnerContent,
    refinedContent: draftResult.refinedContent,
  })
}

function buildTransitionEvent(from: string, to: string): TicketEvent {
  if (to === 'BLOCKED_ERROR') {
    if (from === 'CODING') return { type: 'BEAD_ERROR' }
    return { type: 'ERROR', message: 'Mock seed blocked transition' }
  }

  if (to === 'CANCELED') {
    return { type: 'CANCEL' }
  }

  switch (from) {
    case 'DRAFT':
      return { type: 'START' }
    case 'COUNCIL_DELIBERATING':
      return { type: 'QUESTIONS_READY', result: { seeded: true } }
    case 'COUNCIL_VOTING_INTERVIEW':
      return { type: 'WINNER_SELECTED', winner: COUNCIL_MODELS[0] }
    case 'COMPILING_INTERVIEW':
      return { type: 'READY' }
    case 'WAITING_INTERVIEW_ANSWERS':
      return { type: 'ANSWER_SUBMITTED', answers: { Q1: 'Seeded answer' } }
    case 'VERIFYING_INTERVIEW_COVERAGE':
      return { type: 'COVERAGE_CLEAN' }
    case 'WAITING_INTERVIEW_APPROVAL':
      return { type: 'APPROVE' }
    case 'DRAFTING_PRD':
      return { type: 'DRAFTS_READY' }
    case 'COUNCIL_VOTING_PRD':
      return { type: 'WINNER_SELECTED', winner: COUNCIL_MODELS[0] }
    case 'REFINING_PRD':
      return { type: 'REFINED' }
    case 'VERIFYING_PRD_COVERAGE':
      return { type: 'COVERAGE_CLEAN' }
    case 'WAITING_PRD_APPROVAL':
      return { type: 'APPROVE' }
    case 'DRAFTING_BEADS':
      return { type: 'DRAFTS_READY' }
    case 'COUNCIL_VOTING_BEADS':
      return { type: 'WINNER_SELECTED', winner: COUNCIL_MODELS[0] }
    case 'REFINING_BEADS':
      return { type: 'REFINED' }
    case 'VERIFYING_BEADS_COVERAGE':
      return { type: 'COVERAGE_CLEAN' }
    case 'WAITING_BEADS_APPROVAL':
      return { type: 'APPROVE' }
    case 'PRE_FLIGHT_CHECK':
      return { type: 'CHECKS_PASSED' }
    case 'CODING':
      return { type: 'ALL_BEADS_DONE' }
    case 'RUNNING_FINAL_TEST':
      return { type: 'TESTS_PASSED' }
    case 'INTEGRATING_CHANGES':
      return { type: 'INTEGRATION_DONE' }
    case 'WAITING_MANUAL_VERIFICATION':
      return { type: 'VERIFY_COMPLETE' }
    case 'CLEANING_ENV':
      return { type: 'CLEANUP_DONE' }
    default:
      throw new Error(`Unsupported transition source state: ${from} -> ${to}`)
  }
}

function buildSnapshotForTicket(
  ticketId: number,
  projectId: number,
  externalId: string,
  title: string,
  history: string[],
  lockedMainImplementer: string | null,
): string {
  const actor = createActor(ticketMachine, {
    input: {
      ticketId: String(ticketId),
      projectId,
      externalId,
      title,
      lockedMainImplementer,
      lockedCouncilMembers: [...COUNCIL_MODELS],
      maxIterations: 5,
    },
  })

  actor.start()

  for (let index = 1; index < history.length; index += 1) {
    const from = history[index - 1]
    const to = history[index]

    if (!from || !to) {
      throw new Error(`Invalid history transition index for ${externalId}`)
    }

    const event = buildTransitionEvent(from, to)
    actor.send(event)

    const currentValue = actor.getSnapshot().value
    if (typeof currentValue === 'string' && currentValue !== to) {
      throw new Error(`Snapshot transition mismatch for ${externalId}: expected ${to}, got ${currentValue}`)
    }
  }

  const snapshot = JSON.stringify(actor.getPersistedSnapshot())
  actor.stop()
  return snapshot
}

function buildArtifactsForPhase(
  ticketId: number,
  phase: string,
  title: string,
  interviewYaml: string,
  prdYaml: string,
  beads: BeadRow[],
): Array<{ ticketId: number; phase: string; artifactType: string; content: string }> {
  switch (phase) {
    case 'COUNCIL_DELIBERATING':
      return [{ ticketId, phase, artifactType: 'interview_drafts', content: buildCouncilDraftResult('interview', title) }]
    case 'COUNCIL_VOTING_INTERVIEW':
      return [{ ticketId, phase, artifactType: 'interview_votes', content: buildCouncilVoteResult('interview', title) }]
    case 'COMPILING_INTERVIEW':
      return [
        {
          ticketId,
          phase,
          artifactType: 'interview_compiled',
          content: JSON.stringify({
            winnerId: COUNCIL_MODELS[0],
            refinedContent: interviewYaml,
            questions: [
              { id: 'Q1', question: `What is the business success criteria for ${title}?`, phase: 'Goals' },
              { id: 'Q2', question: 'Which constraints cannot be violated during implementation?', phase: 'Constraints' },
            ],
          }),
        },
        {
          ticketId,
          phase,
          artifactType: 'interview_winner',
          content: JSON.stringify({ winnerId: COUNCIL_MODELS[0] }),
        },
      ]
    case 'WAITING_INTERVIEW_ANSWERS':
      return [{
        ticketId, phase, artifactType: 'interview_compiled', content: JSON.stringify({
          winnerId: COUNCIL_MODELS[0],
          refinedContent: interviewYaml,
          questions: [
            { id: 'Q1', question: `What is the business success criteria for ${title}?`, phase: 'Goals' },
            { id: 'Q2', question: 'Which constraints cannot be violated during implementation?', phase: 'Constraints' },
          ],
        }),
      }]
    case 'VERIFYING_INTERVIEW_COVERAGE':
      return [
        {
          ticketId,
          phase,
          artifactType: 'interview_coverage_input',
          content: JSON.stringify({
            refinedContent: interviewYaml,
            userAnswers: JSON.stringify({
              Q1: 'Operators need deterministic workflows and visible audit context.',
              Q2: 'No silent state changes, no non-idempotent writes, and no schema drift.',
            }),
          }),
        },
        {
          ticketId,
          phase,
          artifactType: 'interview_coverage',
          content: JSON.stringify({
            winnerId: COUNCIL_MODELS[0],
            response: 'status: clean\ngaps: []\nsummary: Interview answers cover the required scope.',
            hasGaps: false,
          }),
        },
      ]
    case 'WAITING_INTERVIEW_APPROVAL':
      return [{
        ticketId,
        phase,
        artifactType: 'interview_coverage_input',
        content: JSON.stringify({
          refinedContent: interviewYaml,
          userAnswers: JSON.stringify({
            Q1: 'Operators need deterministic workflows and visible audit context.',
            Q2: 'No silent state changes, no non-idempotent writes, and no schema drift.',
          }),
        }),
      }]
    case 'DRAFTING_PRD':
      return [{ ticketId, phase, artifactType: 'prd_drafts', content: buildCouncilDraftResult('prd', title) }]
    case 'COUNCIL_VOTING_PRD':
      return [{ ticketId, phase, artifactType: 'prd_votes', content: buildCouncilVoteResult('prd', title) }]
    case 'REFINING_PRD':
      return [{
        ticketId,
        phase,
        artifactType: 'prd_refined',
        content: JSON.stringify({
          winnerId: COUNCIL_MODELS[0],
          refinedContent: prdYaml,
        }),
      }]
    case 'VERIFYING_PRD_COVERAGE':
      return [
        {
          ticketId,
          phase,
          artifactType: 'prd_coverage_input',
          content: JSON.stringify({
            prd: prdYaml,
            refinedContent: prdYaml,
          }),
        },
        {
          ticketId,
          phase,
          artifactType: 'prd_coverage',
          content: JSON.stringify({
            winnerId: COUNCIL_MODELS[0],
            response: 'status: clean\ngaps: []\nsummary: PRD covers scope, risks, and verification requirements.',
            hasGaps: false,
          }),
        },
      ]
    case 'WAITING_PRD_APPROVAL':
      return [{
        ticketId,
        phase,
        artifactType: 'prd_coverage_input',
        content: JSON.stringify({
          prd: prdYaml,
          refinedContent: prdYaml,
        }),
      }]
    case 'DRAFTING_BEADS':
      return [{ ticketId, phase, artifactType: 'beads_drafts', content: buildCouncilDraftResult('beads', title) }]
    case 'COUNCIL_VOTING_BEADS':
      return [{ ticketId, phase, artifactType: 'beads_votes', content: buildCouncilVoteResult('beads', title) }]
    case 'REFINING_BEADS':
      return [{
        ticketId,
        phase,
        artifactType: 'beads_refined',
        content: JSON.stringify({
          winnerId: COUNCIL_MODELS[0],
          refinedContent: JSON.stringify(beads),
          expandedBeads: beads,
        }),
      }]
    case 'VERIFYING_BEADS_COVERAGE':
      return [
        {
          ticketId,
          phase,
          artifactType: 'beads_coverage_input',
          content: JSON.stringify({
            beads,
            refinedContent: JSON.stringify(beads),
          }),
        },
        {
          ticketId,
          phase,
          artifactType: 'beads_coverage',
          content: JSON.stringify({
            winnerId: COUNCIL_MODELS[0],
            response: 'status: clean\ngaps: []\nsummary: Beads are executable, isolated, and fully mapped to PRD scope.',
            hasGaps: false,
          }),
        },
      ]
    case 'WAITING_BEADS_APPROVAL':
      return [{
        ticketId,
        phase,
        artifactType: 'beads_coverage_input',
        content: JSON.stringify({
          beads,
          refinedContent: JSON.stringify(beads),
        }),
      }]
    case 'PRE_FLIGHT_CHECK':
      return [{ ticketId, phase, artifactType: 'diagnostics_report', content: 'All diagnostics checks are green. Ready for coding.' }]
    case 'CODING':
      return [{ ticketId, phase, artifactType: 'bead_progress', content: JSON.stringify({ summary: '2 of 4 beads complete, 1 active, 1 pending.', beads }) }]
    case 'RUNNING_FINAL_TEST':
      return [{ ticketId, phase, artifactType: 'test_results', content: 'Final test suite running. 112/112 checks currently passing.' }]
    case 'INTEGRATING_CHANGES':
      return [{ ticketId, phase, artifactType: 'integration_summary', content: 'Preparing release candidate branch and validating final integration checks.' }]
    case 'WAITING_MANUAL_VERIFICATION':
      return [{ ticketId, phase, artifactType: 'manual_verification_packet', content: 'Release candidate ready for human verification with completed bead and test summary.' }]
    case 'BLOCKED_ERROR':
      return [{ ticketId, phase, artifactType: 'bead_error_report', content: 'Execution blocked: schema mismatch detected while parsing upstream payload.' }]
    case 'COMPLETED':
      return [{ ticketId, phase, artifactType: 'final_summary', content: 'Ticket completed successfully with all verification gates passing.' }]
    default:
      return []
  }
}

function buildArtifactsForHistory(
  ticketId: number,
  history: string[],
  title: string,
  interviewYaml: string,
  prdYaml: string,
  beads: BeadRow[],
): Array<{ ticketId: number; phase: string; artifactType: string; content: string }> {
  return history.flatMap((phase) => buildArtifactsForPhase(ticketId, phase, title, interviewYaml, prdYaml, beads))
}

function seedTicketFiles(options: {
  ticket: SeededTicketRow
  projectFolder: string
  projectName: string
  status: TicketStatus
  history: string[]
  createdHoursAgo: number
  updatedHoursAgo: number
  interviewYaml: string
  prdYaml: string
  beads: BeadRow[]
}): void {
  const initResult = initializeTicket({
    externalId: options.ticket.externalId,
    projectFolder: options.projectFolder,
  })

  const ticketDir = initResult.ticketDir
  const metaDir = resolve(ticketDir, 'meta')
  mkdirSync(metaDir, { recursive: true })

  writeFileSync(
    resolve(metaDir, 'ticket.meta.json'),
    JSON.stringify(
      {
        id: options.ticket.id,
        externalId: options.ticket.externalId,
        projectId: options.ticket.projectId,
        project: options.projectName,
        title: options.ticket.title,
        status: options.status,
        createdAt: options.ticket.createdAt,
      },
      null,
      2,
    ),
  )

  const span = Math.max(1, options.createdHoursAgo - options.updatedHoursAgo)
  const denominator = Math.max(1, options.history.length - 1)
  const logEntries = options.history.map((state, index) => {
    const when = Math.round(options.createdHoursAgo - (span * index) / denominator)
    return {
      ts: ago(when),
      phase: state,
      status: index === options.history.length - 1 ? 'active' : 'completed',
      message: index === 0 ? 'Seeded ticket created' : `Transitioned to ${state}`,
    }
  })

  const jsonl = toJsonl(logEntries)
  mkdirSync(resolve(ticketDir, 'runtime'), { recursive: true })
  writeFileSync(resolve(ticketDir, 'execution-log.jsonl'), jsonl)
  writeFileSync(resolve(ticketDir, 'runtime', 'execution-log.jsonl'), jsonl)

  if (shouldWriteInterview(options.status)) {
    writeFileSync(resolve(ticketDir, 'interview.yaml'), options.interviewYaml)
  }

  if (shouldWritePrd(options.status)) {
    writeFileSync(resolve(ticketDir, 'prd.yaml'), options.prdYaml)
  }

  if (shouldWriteBeads(options.status)) {
    const beadsDir = resolve(ticketDir, 'beads', 'main', '.beads')
    mkdirSync(beadsDir, { recursive: true })
    writeFileSync(resolve(beadsDir, 'issues.jsonl'), toJsonl(options.beads))
  }
}

// Delete all existing data (order matters for FK constraints)
db.delete(ticketStatusHistory).run()
db.delete(phaseArtifacts).run()
db.delete(opencodeSessions).run()
db.delete(tickets).run()
db.delete(projects).run()

// Ensure a profile exists
const existingProfile = db.select().from(profiles).get()
const profileId = existingProfile?.id ?? db.insert(profiles).values({
  username: 'developer',
  icon: '👤',
  councilMembers: COUNCIL_JSON,
  minCouncilQuorum: 2,
  maxIterations: 5,
}).returning().get()!.id

console.log(`  ✅ Profile ready (id: ${profileId})`)

for (const project of projectSeeds) {
  ensureMockProjectRepo(project.folderPath, project.name)
}

const insertedProjects = db.insert(projects).values(
  projectSeeds.map((project) => ({
    name: project.name,
    shortname: project.key,
    icon: project.icon,
    color: project.color,
    folderPath: project.folderPath,
    profileId,
    ticketCounter: project.ticketCounter,
  })),
).returning().all()

const projectByKey = new Map<ProjectKey, (typeof insertedProjects)[number]>()
for (const seed of projectSeeds) {
  const row = insertedProjects.find((project) => project.shortname === seed.key)
  if (!row) {
    throw new Error(`Missing inserted project row for ${seed.key}`)
  }
  projectByKey.set(seed.key, row)
}

console.log('  ✅ Created 3 projects')

const timelines = new Map<string, TicketTimeline>()
const seedByExternalId = new Map<string, TicketSeed>()

const ticketInsertValues = ticketSeeds.map((seed, index) => {
  const project = projectByKey.get(seed.projectKey)
  if (!project) {
    throw new Error(`Project mapping missing for ${seed.projectKey}`)
  }

  const history = historyForStatus(seed.status)
  const createdHoursAgo = 560 - index * 14
  const updatedHoursAgo = Math.max(1, createdHoursAgo - Math.max(4, history.length * 2))

  timelines.set(seed.externalId, { createdHoursAgo, updatedHoursAgo, history })
  seedByExternalId.set(seed.externalId, seed)

  const nonDraft = seed.status !== 'DRAFT'
  const lockedMainImplementer = nonDraft
    ? (COUNCIL_MODELS[index % COUNCIL_MODELS.length] ?? COUNCIL_MODELS[0])
    : null
  const progress = beadProgressForStatus(seed.status)

  return {
    externalId: seed.externalId,
    projectId: project.id,
    title: seed.title,
    description: seed.description,
    priority: seed.priority,
    status: seed.status,
    xstateSnapshot: null,
    branchName: shouldHaveBranch(seed.status)
      ? `feat/${seed.externalId.toLowerCase()}-${slugifyTitle(seed.title)}`
      : null,
    currentBead: progress?.current ?? null,
    totalBeads: progress?.total ?? null,
    percentComplete: percentForStatus(seed.status),
    errorMessage: seed.status === 'BLOCKED_ERROR'
      ? 'Mock dependency schema mismatch in billing pipeline payload parser.'
      : null,
    lockedMainImplementer,
    lockedCouncilMembers: nonDraft ? COUNCIL_JSON : null,
    startedAt: nonDraft ? ago(createdHoursAgo - 2) : null,
    plannedDate: null,
    createdAt: ago(createdHoursAgo),
    updatedAt: ago(updatedHoursAgo),
  }
})

const insertedTickets = db.insert(tickets).values(ticketInsertValues).returning().all()

for (const row of insertedTickets) {
  const timeline = timelines.get(row.externalId)
  if (!timeline) continue

  const lockedMainImplementer = row.lockedMainImplementer ?? null
  const snapshot = buildSnapshotForTicket(
    row.id,
    row.projectId,
    row.externalId,
    row.title,
    timeline.history,
    lockedMainImplementer,
  )

  db.update(tickets)
    .set({ xstateSnapshot: snapshot })
    .where(eq(tickets.id, row.id))
    .run()
}

console.log('  ✅ Created 20 tickets with XState snapshots')

const ticketByExternalId = new Map<string, SeededTicketRow>()
for (const row of insertedTickets) {
  ticketByExternalId.set(row.externalId, {
    id: row.id,
    externalId: row.externalId,
    projectId: row.projectId,
    title: row.title,
    createdAt: row.createdAt,
  })
}

const statusHistoryRows: Array<{
  ticketId: number
  previousStatus: string | null
  newStatus: string
  reason: string
  changedAt: string
}> = []

for (const seed of ticketSeeds) {
  const ticket = ticketByExternalId.get(seed.externalId)
  const timeline = timelines.get(seed.externalId)
  if (!ticket || !timeline) {
    throw new Error(`Missing ticket/timeline for ${seed.externalId}`)
  }

  const span = Math.max(1, timeline.createdHoursAgo - timeline.updatedHoursAgo)
  const denominator = Math.max(1, timeline.history.length - 1)

  for (let index = 0; index < timeline.history.length; index += 1) {
    const newStatus = timeline.history[index]
    if (!newStatus) continue

    const previousStatus = index === 0 ? null : (timeline.history[index - 1] ?? null)
    const offsetHours = Math.round(timeline.createdHoursAgo - (span * index) / denominator)

    statusHistoryRows.push({
      ticketId: ticket.id,
      previousStatus,
      newStatus,
      reason: STATUS_REASON[newStatus] ?? 'Workflow advanced',
      changedAt: ago(offsetHours),
    })
  }
}

db.insert(ticketStatusHistory).values(statusHistoryRows).run()
console.log(`  ✅ Created ${statusHistoryRows.length} status history entries`)

const artifactRows: Array<{ ticketId: number; phase: string; artifactType: string; content: string }> = []

for (const seed of ticketSeeds) {
  const ticket = ticketByExternalId.get(seed.externalId)
  const timeline = timelines.get(seed.externalId)
  const project = projectByKey.get(seed.projectKey)
  if (!ticket || !timeline || !project) {
    throw new Error(`Missing data for seed ${seed.externalId}`)
  }

  const generatedAt = ago(Math.max(1, timeline.updatedHoursAgo + 2))
  const approvedAt = ago(Math.max(1, timeline.updatedHoursAgo))
  const interviewYaml = buildInterviewYaml(seed.externalId, seed.title, generatedAt, approvedAt)
  const prdYaml = buildPrdYaml(seed.externalId, seed.title, generatedAt, approvedAt)
  const beads = buildBeads(seed.externalId, seed.title, seed.status, timeline.updatedHoursAgo + 24)

  seedTicketFiles({
    ticket,
    projectFolder: project.folderPath,
    projectName: project.name,
    status: seed.status,
    history: timeline.history,
    createdHoursAgo: timeline.createdHoursAgo,
    updatedHoursAgo: timeline.updatedHoursAgo,
    interviewYaml,
    prdYaml,
    beads,
  })

  artifactRows.push(...buildArtifactsForHistory(
    ticket.id,
    timeline.history,
    seed.title,
    interviewYaml,
    prdYaml,
    beads,
  ))
}

if (artifactRows.length > 0) {
  db.insert(phaseArtifacts).values(artifactRows).run()
}

console.log(`  ✅ Created ${artifactRows.length} phase artifacts`)

sqlite.close()
console.log('\n🎉 Seed complete!')
