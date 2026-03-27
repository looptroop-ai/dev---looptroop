import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseUiRefinementDiffArtifact } from '@shared/refinementDiffArtifacts'
import { initializeDatabase } from '../../db/init'
import { sqlite } from '../../db/index'
import { clearProjectDatabaseCache } from '../../db/project'
import { attachProject } from '../../storage/projects'
import { createTicket, getLatestPhaseArtifact, getTicketPaths } from '../../storage/tickets'
import { createFixtureRepoManager } from '../../test/fixtureRepo'
import { initializeTicket } from '../../ticket/initialize'
import type { TicketContext as MachineTicketContext } from '../../machines/types'
import { phaseIntermediate } from '../phases/state'

const { refineDraftMock } = vi.hoisted(() => ({
  refineDraftMock: vi.fn(),
}))

vi.mock('../../opencode/factory', () => ({
  getOpenCodeAdapter: () => ({}),
  isMockOpenCodeMode: () => false,
}))

vi.mock('../../council/refiner', () => ({
  refineDraft: refineDraftMock,
}))

import { handleInterviewCompile } from '../phases/interviewPhase'

const repoManager = createFixtureRepoManager({
  templatePrefix: 'looptroop-interview-compile-',
  files: {
    'README.md': '# Interview Compile Phase Test\n',
  },
})

function buildTicketContext(ticket: ReturnType<typeof createTicket>, overrides: Partial<MachineTicketContext> = {}): MachineTicketContext {
  return {
    ticketId: ticket.id,
    projectId: ticket.projectId,
    externalId: ticket.externalId,
    title: ticket.title,
    status: ticket.status,
    lockedMainImplementer: 'openai/gpt-5-codex',
    lockedMainImplementerVariant: null,
    lockedCouncilMembers: ['openai/gpt-5.4', 'openai/gpt-5-mini'],
    lockedCouncilMemberVariants: null,
    lockedInterviewQuestions: 10,
    lockedCoverageFollowUpBudgetPercent: 20,
    lockedMaxCoveragePasses: 3,
    previousStatus: null,
    error: null,
    errorCodes: [],
    beadProgress: { total: 0, completed: 0, current: null },
    iterationCount: 0,
    maxIterations: 5,
    councilResults: null,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    ...overrides,
  }
}

describe('handleInterviewCompile', () => {
  beforeEach(() => {
    clearProjectDatabaseCache()
    initializeDatabase()
    sqlite.exec('DELETE FROM attached_projects; DELETE FROM profiles;')
    phaseIntermediate.clear()
    refineDraftMock.mockReset()
  })

  afterAll(() => {
    clearProjectDatabaseCache()
    repoManager.cleanup()
  })

  it('persists interview ui refinement diffs from parsed inline changes so inspiration tooltips survive slimming', async () => {
    const repoDir = repoManager.createRepo()
    const project = attachProject({
      folderPath: repoDir,
      name: 'LoopTroop',
      shortname: 'LOOP',
    })
    const ticket = createTicket({
      projectId: project.id,
      title: 'Restore interview inspiration tooltip',
      description: 'Keep prompt output single-source while saving UI-only inspiration metadata separately.',
    })

    initializeTicket({
      projectFolder: repoDir,
      externalId: ticket.externalId,
    })

    const winnerDraftContent = [
      'questions:',
      '  - id: Q01',
      '    phase: Foundation',
      '    question: "Original winner question?"',
      '  - id: Q02',
      '    phase: Structure',
      '    question: "Winner replacement source question?"',
    ].join('\n')

    const losingDraftContent = [
      'questions:',
      '  - id: Q07',
      '    phase: Structure',
      '    question: "Alternative draft replacement question?"',
    ].join('\n')

    const rawRefinementOutput = [
      'questions:',
      '  - id: Q01',
      '    phase: Foundation',
      '    question: "Refined winner question?"',
      '  - id: Q03',
      '    phase: Structure',
      '    question: "Replacement target question?"',
      'changes:',
      '  - type: modified',
      '    before:',
      '      id: Q01',
      '      phase: Foundation',
      '      question: "Original winner question?"',
      '    after:',
      '      id: Q01',
      '      phase: Foundation',
      '      question: "Refined winner question?"',
      '  - type: replaced',
      '    before:',
      '      id: Q02',
      '      phase: Structure',
      '      question: "Winner replacement source question?"',
      '    after:',
      '      id: Q03',
      '      phase: Structure',
      '      question: "Replacement target question?"',
      '    inspiration:',
      '      alternative_draft: 1',
      '      question:',
      '        id: Q07',
      '        phase: Structure',
      '        question: "Alternative draft replacement question?"',
    ].join('\n')

    refineDraftMock.mockImplementation(async (...args: unknown[]) => {
      const validateResponse = args[12] as ((content: string) => { normalizedContent?: string }) | undefined
      if (!validateResponse) return rawRefinementOutput
      const validation = validateResponse(rawRefinementOutput)
      return validation.normalizedContent ?? rawRefinementOutput
    })

    phaseIntermediate.set(`${ticket.id}:interview`, {
      phase: 'interview',
      worktreePath: repoDir,
      winnerId: 'openai/gpt-5.4',
      drafts: [
        {
          memberId: 'openai/gpt-5.4',
          content: winnerDraftContent,
          outcome: 'completed',
          duration: 1000,
        },
        {
          memberId: 'openai/gpt-5-mini',
          content: losingDraftContent,
          outcome: 'completed',
          duration: 1000,
        },
      ],
      memberOutcomes: {
        'openai/gpt-5.4': 'completed',
        'openai/gpt-5-mini': 'completed',
      },
      ticketState: {
        ticketId: ticket.externalId,
        title: ticket.title,
        description: ticket.description ?? '',
        relevantFiles: '',
      },
    })

    const sendEvent = vi.fn()

    await handleInterviewCompile(
      ticket.id,
      buildTicketContext(ticket, { status: 'COMPILING_INTERVIEW' }),
      sendEvent,
      new AbortController().signal,
    )

    const uiDiffArtifact = getLatestPhaseArtifact(ticket.id, 'ui_refinement_diff:interview', 'COMPILING_INTERVIEW')
    expect(uiDiffArtifact).toBeDefined()

    const parsedUiDiff = parseUiRefinementDiffArtifact(uiDiffArtifact?.content)
    expect(parsedUiDiff?.domain).toBe('interview')
    expect(parsedUiDiff?.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        changeType: 'replaced',
        beforeId: 'Q02',
        afterId: 'Q03',
        inspiration: expect.objectContaining({
          memberId: 'openai/gpt-5-mini',
          sourceId: 'Q07',
          sourceText: 'Alternative draft replacement question?',
        }),
        attributionStatus: 'inspired',
      }),
    ]))

    const paths = getTicketPaths(ticket.id)
    expect(paths).toBeDefined()
    const mirroredUiDiff = readFileSync(`${paths!.ticketDir}/ui/refinement-diffs/interview.json`, 'utf-8')
    expect(parseUiRefinementDiffArtifact(mirroredUiDiff)?.entries).toEqual(parsedUiDiff?.entries)

    const compiledArtifact = getLatestPhaseArtifact(ticket.id, 'interview_compiled', 'COMPILING_INTERVIEW')
    expect(compiledArtifact).toBeDefined()
    const compiledPayload = JSON.parse(compiledArtifact!.content) as { refinedContent?: string; changes?: unknown }
    expect(compiledPayload.refinedContent).toContain('Refined winner question?')
    expect(compiledPayload.refinedContent).toContain('Replacement target question?')
    expect('changes' in compiledPayload).toBe(false)

    expect(sendEvent).toHaveBeenCalledWith({ type: 'READY' })
  })

  it('restores interview inspiration tooltips when the refiner cites a source question as plain text', async () => {
    const repoDir = repoManager.createRepo()
    const project = attachProject({
      folderPath: repoDir,
      name: 'LoopTroop',
      shortname: 'LOOP',
    })
    const ticket = createTicket({
      projectId: project.id,
      title: 'Hydrate scalar inspiration question text',
      description: 'Persist tooltip-ready interview inspiration even when the model returns source text without question metadata.',
    })

    initializeTicket({
      projectFolder: repoDir,
      externalId: ticket.externalId,
    })

    const winnerDraftContent = [
      'questions:',
      '  - id: Q01',
      '    phase: Foundation',
      '    question: "Original winner question?"',
    ].join('\n')

    const losingDraftContent = [
      'questions:',
      '  - id: Q07',
      '    phase: Structure',
      '    question: "Alternative draft replacement question?"',
    ].join('\n')

    const rawRefinementOutput = [
      'questions:',
      '  - id: Q01',
      '    phase: Foundation',
      '    question: "Refined winner question?"',
      'changes:',
      '  - type: modified',
      '    before:',
      '      id: Q01',
      '      phase: Foundation',
      '      question: "Original winner question?"',
      '    after:',
      '      id: Q01',
      '      phase: Foundation',
      '      question: "Refined winner question?"',
      '    inspiration:',
      '      alternative_draft: 1',
      '      question: "Alternative draft replacement question?"',
    ].join('\n')

    refineDraftMock.mockImplementation(async (...args: unknown[]) => {
      const validateResponse = args[12] as ((content: string) => { normalizedContent?: string }) | undefined
      if (!validateResponse) return rawRefinementOutput
      const validation = validateResponse(rawRefinementOutput)
      return validation.normalizedContent ?? rawRefinementOutput
    })

    phaseIntermediate.set(`${ticket.id}:interview`, {
      phase: 'interview',
      worktreePath: repoDir,
      winnerId: 'openai/gpt-5.4',
      drafts: [
        {
          memberId: 'openai/gpt-5.4',
          content: winnerDraftContent,
          outcome: 'completed',
          duration: 1000,
        },
        {
          memberId: 'openai/gpt-5-mini',
          content: losingDraftContent,
          outcome: 'completed',
          duration: 1000,
        },
      ],
      memberOutcomes: {
        'openai/gpt-5.4': 'completed',
        'openai/gpt-5-mini': 'completed',
      },
      ticketState: {
        ticketId: ticket.externalId,
        title: ticket.title,
        description: ticket.description ?? '',
        relevantFiles: '',
      },
    })

    const sendEvent = vi.fn()

    await handleInterviewCompile(
      ticket.id,
      buildTicketContext(ticket, { status: 'COMPILING_INTERVIEW' }),
      sendEvent,
      new AbortController().signal,
    )

    const uiDiffArtifact = getLatestPhaseArtifact(ticket.id, 'ui_refinement_diff:interview', 'COMPILING_INTERVIEW')
    expect(uiDiffArtifact).toBeDefined()

    const parsedUiDiff = parseUiRefinementDiffArtifact(uiDiffArtifact?.content)
    expect(parsedUiDiff?.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        changeType: 'modified',
        beforeId: 'Q01',
        afterId: 'Q01',
        inspiration: expect.objectContaining({
          memberId: 'openai/gpt-5-mini',
          sourceId: 'Q07',
          sourceText: 'Alternative draft replacement question?',
        }),
        attributionStatus: 'inspired',
      }),
    ]))

    expect(sendEvent).toHaveBeenCalledWith({ type: 'READY' })
  })
})
