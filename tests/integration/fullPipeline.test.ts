import { describe, it, expect, beforeEach } from 'vitest'
import { MockOpenCodeAdapter } from '../../server/opencode/adapter'
import { runCouncilPipeline } from '../../server/council/pipeline'
import { createBatches, processAnswers } from '../../server/phases/interview/qa'
import { verifyInterviewCoverage } from '../../server/phases/interview/coverage'
import { verifyPRDCoverage } from '../../server/phases/prd/coverage'
import { verifyBeadsCoverage } from '../../server/phases/beads/coverage'
import { expandBeads } from '../../server/phases/beads/expand'
import { runPreFlightChecks } from '../../server/phases/preflight/doctor'
import { getRunnable, isAllComplete } from '../../server/phases/execution/scheduler'
import { parseCompletionMarker } from '../../server/phases/execution/completionChecker'
import { recoverFromCrash } from '../../server/errors/recovery'
import { initializeDatabase } from '../../server/db/init'
import type { CouncilMember } from '../../server/council/types'
import type { InterviewQuestion, InterviewResult } from '../../server/phases/interview/types'
import type { BeadSubset } from '../../server/phases/beads/types'

describe('Full Pipeline Integration', () => {
  let adapter: MockOpenCodeAdapter
  const members: CouncilMember[] = [
    { modelId: 'model-a', name: 'Model A' },
    { modelId: 'model-b', name: 'Model B' },
    { modelId: 'model-c', name: 'Model C' },
  ]

  beforeEach(() => {
    adapter = new MockOpenCodeAdapter()
    initializeDatabase()
  })

  it('runs interview council pipeline end-to-end', async () => {
    const result = await runCouncilPipeline(adapter, {
      phase: 'interview_draft',
      members,
      contextParts: [{ type: 'text', content: 'Generate interview questions for a todo app' }],
      projectPath: '/tmp/test',
    })
    expect(result.phase).toBe('interview_draft')
    expect(result.drafts.length).toBe(3)
    expect(result.refinedContent).toBeTruthy()
  })

  it('processes interview Q&A flow', () => {
    const questions: InterviewQuestion[] = [
      { id: 'q1', category: 'scope', question: 'What features?', priority: 'critical', rationale: 'Core scope' },
      { id: 'q2', category: 'tech', question: 'What stack?', priority: 'high', rationale: 'Tech decisions' },
      { id: 'q3', category: 'ux', question: 'What UX?', priority: 'medium', rationale: 'UX decisions' },
    ]
    const batches = createBatches(questions, 2)
    expect(batches.length).toBe(2)

    const answers = processAnswers(questions, { q1: 'CRUD features', q2: 'React + Node' })
    const result: InterviewResult = {
      questions,
      answers,
      followUps: [],
      coverageReport: { passed: true, gaps: [] },
    }
    const coverage = verifyInterviewCoverage(result)
    expect(coverage.coveragePercent).toBe(67)
  })

  it('verifies PRD coverage', () => {
    const prdContent = 'This PRD contains an epic with user story requirements and acceptance criteria ' + 'x'.repeat(200)
    const coverage = verifyPRDCoverage(prdContent, 'interview content')
    expect(coverage.passed).toBe(true)
  })

  it('runs beads expansion and coverage', () => {
    const subsets: BeadSubset[] = [
      { id: 'b1', title: 'Setup', prdRefs: ['e1'], description: 'Initial setup',
        contextGuidance: '', acceptanceCriteria: ['works'], tests: ['test'], testCommands: ['npm test'] },
      { id: 'b2', title: 'Feature', prdRefs: ['e1'], description: 'Feature impl',
        contextGuidance: '', acceptanceCriteria: ['works'], tests: ['test'], testCommands: ['npm test'] },
    ]
    const expanded = expandBeads(subsets)
    expect(expanded.length).toBe(2)
    expect(expanded[0]!.status).toBe('pending')

    const coverage = verifyBeadsCoverage(expanded, 'prd content')
    expect(coverage.passed).toBe(true)
  })

  it('runs pre-flight checks', async () => {
    const beads = expandBeads([{
      id: 'b1', title: 'Test', prdRefs: [], description: 'd',
      contextGuidance: '', acceptanceCriteria: ['ac'], tests: ['t'], testCommands: ['cmd'],
    }])
    const report = await runPreFlightChecks(adapter, 'TEST-1', beads)
    expect(report.checks.find(c => c.name === 'OpenCode Connectivity')?.result).toBe('pass')
  })

  it('schedules and validates bead execution', () => {
    const beads = expandBeads([
      { id: 'b1', title: 'First', prdRefs: [], description: 'd', contextGuidance: '', acceptanceCriteria: ['ac'], tests: ['t'], testCommands: ['cmd'] },
      { id: 'b2', title: 'Second', prdRefs: [], description: 'd', contextGuidance: '', acceptanceCriteria: ['ac'], tests: ['t'], testCommands: ['cmd'] },
    ])
    beads[1]!.dependencies = ['b1']

    const runnable = getRunnable(beads)
    expect(runnable.length).toBe(1)
    expect(runnable[0]!.id).toBe('b1')

    beads[0]!.status = 'completed'
    expect(getRunnable(beads)[0]!.id).toBe('b2')

    beads[1]!.status = 'completed'
    expect(isAllComplete(beads)).toBe(true)
  })

  it('parses bead completion markers', () => {
    const validMarker = JSON.stringify({
      bead_id: 'b1', status: 'completed',
      checks: { tests: 'pass', lint: 'pass', typecheck: 'pass', qualitative: 'pass' },
    })
    const failedMarker = JSON.stringify({
      bead_id: 'b1', status: 'failed',
      checks: { tests: 'fail', lint: 'pass', typecheck: 'pass', qualitative: 'pass' },
    })
    expect(parseCompletionMarker(`done <BEAD_STATUS>${validMarker}</BEAD_STATUS>`).complete).toBe(true)
    expect(parseCompletionMarker(`err <BEAD_STATUS>${failedMarker}</BEAD_STATUS>`).complete).toBe(false)
    expect(parseCompletionMarker('no marker').markerFound).toBe(false)
  })

  it('recovers from crash', () => {
    const report = recoverFromCrash()
    expect(report.errors.length).toBe(0)
  })
})
