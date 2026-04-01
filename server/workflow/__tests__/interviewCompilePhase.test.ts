import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseUiRefinementDiffArtifact } from '@shared/refinementDiffArtifacts'
import { attachProject } from '../../storage/projects'
import { createTicket, getLatestPhaseArtifact, getTicketPaths } from '../../storage/tickets'
import { TEST, makeTicketContextFromTicket as makeTicketContext, createTestRepoManager, resetTestDb } from '../../test/factories'
import { initializeTicket } from '../../ticket/initialize'
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

const repoManager = createTestRepoManager('interview-compile')

function readExecutionLogEntries(ticketId: string) {
  const paths = getTicketPaths(ticketId)
  if (!paths) throw new Error(`Missing ticket paths for ${ticketId}`)
  return readFileSync(paths.executionLogPath, 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

describe('handleInterviewCompile', () => {
  beforeEach(() => {
    resetTestDb()
    phaseIntermediate.clear()
    refineDraftMock.mockReset()
  })

  afterAll(() => {
    resetTestDb()
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
      winnerId: TEST.councilMembers[0],
      drafts: [
        {
          memberId: TEST.councilMembers[0],
          content: winnerDraftContent,
          outcome: 'completed',
          duration: 1000,
        },
        {
          memberId: TEST.councilMembers[1],
          content: losingDraftContent,
          outcome: 'completed',
          duration: 1000,
        },
      ],
      memberOutcomes: {
        [TEST.councilMembers[0]]: 'completed',
        [TEST.councilMembers[1]]: 'completed',
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
      makeTicketContext(ticket, {
        status: 'COMPILING_INTERVIEW',
        lockedMainImplementer: TEST.implementer,
        lockedCouncilMembers: [...TEST.councilMembers],
        lockedInterviewQuestions: 10,
        lockedCoverageFollowUpBudgetPercent: 20,
        lockedMaxCoveragePasses: 3,
      }),
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
          memberId: TEST.councilMembers[1],
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

    expect(readExecutionLogEntries(ticket.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        message: `Compiled final interview from winner ${TEST.councilMembers[0]}. Validated 2 normalized questions.`,
        source: 'system',
        modelId: TEST.councilMembers[0],
      }),
    ]))

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
      winnerId: TEST.councilMembers[0],
      drafts: [
        {
          memberId: TEST.councilMembers[0],
          content: winnerDraftContent,
          outcome: 'completed',
          duration: 1000,
        },
        {
          memberId: TEST.councilMembers[1],
          content: losingDraftContent,
          outcome: 'completed',
          duration: 1000,
        },
      ],
      memberOutcomes: {
        [TEST.councilMembers[0]]: 'completed',
        [TEST.councilMembers[1]]: 'completed',
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
      makeTicketContext(ticket, {
        status: 'COMPILING_INTERVIEW',
        lockedMainImplementer: TEST.implementer,
        lockedCouncilMembers: [...TEST.councilMembers],
        lockedInterviewQuestions: 10,
        lockedCoverageFollowUpBudgetPercent: 20,
        lockedMaxCoveragePasses: 3,
      }),
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
          memberId: TEST.councilMembers[1],
          sourceId: 'Q07',
          sourceText: 'Alternative draft replacement question?',
        }),
        attributionStatus: 'inspired',
      }),
    ]))

    expect(sendEvent).toHaveBeenCalledWith({ type: 'READY' })
  })
})
