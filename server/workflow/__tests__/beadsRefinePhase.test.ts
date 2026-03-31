import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getLatestPhaseArtifact } from '../../storage/tickets'
import { TEST, createTestRepoManager, resetTestDb, createInitializedTestTicket } from '../../test/factories'
import { phaseIntermediate, phaseResults } from '../phases/state'

const { refineDraftMock, runOpenCodePromptMock } = vi.hoisted(() => ({
  refineDraftMock: vi.fn(),
  runOpenCodePromptMock: vi.fn(),
}))

vi.mock('../../opencode/factory', () => ({
  getOpenCodeAdapter: () => ({}),
  isMockOpenCodeMode: () => false,
}))

vi.mock('../../council/refiner', () => ({
  refineDraft: refineDraftMock,
}))

vi.mock('../runOpenCodePrompt', () => ({
  runOpenCodePrompt: runOpenCodePromptMock,
}))

import { handleBeadsRefine } from '../phases/beadsPhase'

const repoManager = createTestRepoManager('beads-refine')

function buildBeadSubsetContent(options: {
  includeSecondBead?: boolean
  secondBeadId?: string
  secondBeadTitle?: string
} = {}): string {
  const lines = [
    'beads:',
    '  - id: "bead-1"',
    '    title: "Validate refinement attribution"',
    '    prdRefs: ["EPIC-1 / US-1"]',
    '    description: "Preserve explicit inspiration in refinement diffs."',
    '    contextGuidance: |',
    '      Patterns:',
    '      - Keep repairs deterministic.',
    '      Anti-patterns:',
    '      - Do not widen the repair scope unnecessarily.',
    '    acceptanceCriteria:',
    '      - "Validate attribution survives refinement"',
    '    tests:',
    '      - "Shared tests cover refinement attribution"',
    '    testCommands:',
    '      - "npm run test:server"',
  ]

  if (options.includeSecondBead) {
    lines.push(
      `  - id: "${options.secondBeadId ?? 'bead-2'}"`,
      `    title: "${options.secondBeadTitle ?? 'Surface retry metadata'}"`,
      '    prdRefs: ["EPIC-1 / US-2"]',
      '    description: "Surface refinement retry metadata in the diff viewer."',
      '    contextGuidance: |',
      '      Patterns:',
      '      - Keep attribution deterministic.',
      '      Anti-patterns:',
      '      - Do not remove inspiration metadata.',
      '    acceptanceCriteria:',
      '      - "Show retry metadata alongside refinement diffs"',
      '    tests:',
      '      - "UI tests show the correct inspiration tooltip"',
      '    testCommands:',
      '      - "npm run test:server"',
    )
  }

  return lines.join('\n')
}

function buildValidRefinementOutput(): string {
  return [
    'beads:',
    '  - id: "bead-1"',
    '    title: "Validate refinement attribution"',
    '    prdRefs: ["EPIC-1 / US-1"]',
    '    description: "Preserve explicit inspiration in refinement diffs."',
    '    contextGuidance: |',
    '      Patterns:',
    '      - Keep repairs deterministic.',
    '      Anti-patterns:',
    '      - Do not widen the repair scope unnecessarily.',
    '    acceptanceCriteria:',
    '      - "Validate attribution survives refinement"',
    '    tests:',
    '      - "Shared tests cover refinement attribution"',
    '    testCommands:',
    '      - "npm run test:server"',
    '  - id: "bead-2"',
    '    title: "Surface retry metadata"',
    '    prdRefs: ["EPIC-1 / US-2"]',
    '    description: "Surface refinement retry metadata in the diff viewer."',
    '    contextGuidance: |',
    '      Patterns:',
    '      - Keep attribution deterministic.',
    '      Anti-patterns:',
    '      - Do not remove inspiration metadata.',
    '    acceptanceCriteria:',
    '      - "Show retry metadata alongside refinement diffs"',
    '    tests:',
    '      - "UI tests show the correct inspiration tooltip"',
    '    testCommands:',
    '      - "npm run test:server"',
    'changes:',
    '  - type: added',
    '    item_type: bead',
    '    before: null',
    '    after:',
    '      id: "bead-2"',
    '      title: "Surface retry metadata"',
    '    inspiration:',
    '      alternative_draft: 1',
    '      item:',
    '        id: "bead-9"',
    '        title: "Adopt losing-draft telemetry"',
  ].join('\n')
}

function buildExpansionRecords() {
  return [
    {
      id: 'proj-1-validate-refinement-attribution',
      title: 'Validate refinement attribution',
      prdRefs: ['EPIC-1 / US-1'],
      description: 'Preserve explicit inspiration in refinement diffs.',
      contextGuidance: {
        patterns: ['Keep repairs deterministic.'],
        anti_patterns: ['Do not widen the repair scope unnecessarily.'],
      },
      acceptanceCriteria: ['Validate attribution survives refinement'],
      tests: ['Shared tests cover refinement attribution'],
      testCommands: ['npm run test:server'],
      issueType: 'task',
      labels: ['ticket:PROJ-1', 'story:US-1'],
      dependencies: { blocked_by: [] },
      targetFiles: ['server/workflow/phases/beadsPhase.ts'],
    },
    {
      id: 'proj-1-surface-retry-metadata',
      title: 'Surface retry metadata',
      prdRefs: ['EPIC-1 / US-2'],
      description: 'Surface refinement retry metadata in the diff viewer.',
      contextGuidance: {
        patterns: ['Keep attribution deterministic.'],
        anti_patterns: ['Do not remove inspiration metadata.'],
      },
      acceptanceCriteria: ['Show retry metadata alongside refinement diffs'],
      tests: ['UI tests show the correct inspiration tooltip'],
      testCommands: ['npm run test:server'],
      issueType: 'task',
      labels: ['ticket:PROJ-1', 'story:US-2'],
      dependencies: { blocked_by: ['proj-1-validate-refinement-attribution'] },
      targetFiles: ['src/components/workspace/ArtifactContentViewer.tsx'],
    },
  ]
}

function buildValidExpansionOutput(options?: {
  mutateFirstBead?: (bead: ReturnType<typeof buildExpansionRecords>[number]) => ReturnType<typeof buildExpansionRecords>[number]
}): string {
  const [firstBead, ...remainingBeads] = buildExpansionRecords()
  const beads = [
    options?.mutateFirstBead ? options.mutateFirstBead(firstBead!) : firstBead!,
    ...remainingBeads,
  ]

  return beads.map((bead) => JSON.stringify(bead)).join('\n')
}

describe('handleBeadsRefine', () => {
  beforeEach(() => {
    resetTestDb()
    phaseIntermediate.clear()
    phaseResults.clear()
    refineDraftMock.mockReset()
    runOpenCodePromptMock.mockReset()
  })

  afterAll(() => {
    resetTestDb()
    repoManager.cleanup()
  })

  it('persists ui_refinement_diff:beads with explicit inspiration metadata from validated changes', async () => {
    const { ticket, context, paths } = createInitializedTestTicket(repoManager, {
      title: 'Preserve Beads refinement attribution',
      description: 'Keep explicit inspiration metadata in REFINING_BEADS diff artifacts.',
    })
    const sendEvent = vi.fn()
    const winnerId = TEST.councilMembers[0]
    const winnerDraftContent = buildBeadSubsetContent()
    const losingDraftContent = buildBeadSubsetContent({
      includeSecondBead: true,
      secondBeadId: 'bead-9',
      secondBeadTitle: 'Adopt losing-draft telemetry',
    })
    const validOutput = buildValidRefinementOutput()

    phaseIntermediate.set(`${ticket.id}:beads`, {
      phase: 'beads',
      worktreePath: paths.worktreePath,
      winnerId,
      drafts: [
        { memberId: winnerId, outcome: 'completed', content: winnerDraftContent, duration: 1 },
        { memberId: TEST.councilMembers[1], outcome: 'completed', content: losingDraftContent, duration: 1 },
      ],
      memberOutcomes: {
        [winnerId]: 'completed',
        [TEST.councilMembers[1]]: 'completed',
      },
      contextBuilder: () => [],
    })

    refineDraftMock.mockImplementationOnce(async (
      _adapter: unknown,
      _winnerDraft: unknown,
      _losingDrafts: unknown,
      _contextParts: unknown,
      _projectPath: unknown,
      _timeoutMs: unknown,
      _signal: unknown,
      _onOpenCodeSessionLog: unknown,
      _onOpenCodeStreamEvent: unknown,
      _onOpenCodePromptDispatched: unknown,
      _sessionOwnership: unknown,
      _buildPrompt: unknown,
      validateResponse?: (content: string) => { normalizedContent?: string },
    ) => validateResponse?.(validOutput).normalizedContent ?? validOutput)

    runOpenCodePromptMock.mockResolvedValue({
      session: { id: 'session-expand-1' },
      response: buildValidExpansionOutput(),
      messages: [],
      responseMeta: {
        hasAssistantMessage: true,
        latestAssistantWasEmpty: false,
        latestAssistantHasError: false,
        latestAssistantWasStale: false,
      },
    })

    await handleBeadsRefine(ticket.id, context, sendEvent, new AbortController().signal)

    const uiDiffArtifact = getLatestPhaseArtifact(ticket.id, 'ui_refinement_diff:beads', 'REFINING_BEADS')
    expect(uiDiffArtifact).toBeDefined()
    expect(JSON.parse(uiDiffArtifact!.content)).toMatchObject({
      domain: 'beads',
      winnerId,
      entries: expect.arrayContaining([
        expect.objectContaining({
          changeType: 'added',
          itemKind: 'bead',
          afterId: 'bead-2',
          inspiration: expect.objectContaining({
            memberId: TEST.councilMembers[1],
            sourceId: 'bead-9',
            sourceLabel: 'Adopt losing-draft telemetry',
          }),
          attributionStatus: 'inspired',
        }),
      ]),
    })
    expect(getLatestPhaseArtifact(ticket.id, 'beads_refined', 'REFINING_BEADS')).toBeDefined()
    expect(getLatestPhaseArtifact(ticket.id, 'beads_expanded', 'REFINING_BEADS')).toBeDefined()
    expect(getLatestPhaseArtifact(ticket.id, 'beads_winner', 'REFINING_BEADS')).toBeDefined()
    const persistedBeads = readFileSync(paths.beadsPath, 'utf-8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { priority: number; status: string; labels: string[]; dependencies: { blocked_by: string[]; blocks: string[] } })
    expect(persistedBeads).toHaveLength(2)
    expect(persistedBeads[0]).toMatchObject({
      priority: 1,
      status: 'pending',
      labels: ['ticket:PROJ-1', 'story:US-1'],
      dependencies: { blocked_by: [], blocks: ['proj-1-surface-retry-metadata'] },
    })
    expect(persistedBeads[1]).toMatchObject({
      priority: 2,
      status: 'pending',
      labels: ['ticket:PROJ-1', 'story:US-2'],
      dependencies: { blocked_by: ['proj-1-validate-refinement-attribution'], blocks: [] },
    })
    expect(runOpenCodePromptMock).toHaveBeenCalledWith(expect.objectContaining({
      model: winnerId,
      sessionOwnership: expect.objectContaining({
        ticketId: ticket.id,
        phase: 'REFINING_BEADS',
        memberId: winnerId,
        step: 'expand',
      }),
    }))
    expect(phaseIntermediate.get(`${ticket.id}:beads`)).toBeUndefined()
    expect(sendEvent).toHaveBeenCalledWith({ type: 'REFINED' })
  })

  it('salvages punctuation-only preserved-field drift and records a repair warning', async () => {
    const { ticket, context, paths } = createInitializedTestTicket(repoManager, {
      title: 'Salvage near-miss bead expansion drift',
      description: 'Keep beads expansion strict but tolerate punctuation-only preserved-field drift.',
    })
    const sendEvent = vi.fn()
    const winnerId = TEST.councilMembers[0]
    const winnerDraftContent = buildBeadSubsetContent()
    const losingDraftContent = buildBeadSubsetContent({
      includeSecondBead: true,
      secondBeadId: 'bead-9',
      secondBeadTitle: 'Adopt losing-draft telemetry',
    })

    phaseIntermediate.set(`${ticket.id}:beads`, {
      phase: 'beads',
      worktreePath: paths.worktreePath,
      winnerId,
      drafts: [
        { memberId: winnerId, outcome: 'completed', content: winnerDraftContent, duration: 1 },
        { memberId: TEST.councilMembers[1], outcome: 'completed', content: losingDraftContent, duration: 1 },
      ],
      memberOutcomes: {
        [winnerId]: 'completed',
        [TEST.councilMembers[1]]: 'completed',
      },
      contextBuilder: () => [],
    })

    refineDraftMock.mockImplementationOnce(async (
      _adapter: unknown,
      _winnerDraft: unknown,
      _losingDrafts: unknown,
      _contextParts: unknown,
      _projectPath: unknown,
      _timeoutMs: unknown,
      _signal: unknown,
      _onOpenCodeSessionLog: unknown,
      _onOpenCodeStreamEvent: unknown,
      _onOpenCodePromptDispatched: unknown,
      _sessionOwnership: unknown,
      _buildPrompt: unknown,
      validateResponse?: (content: string) => { normalizedContent?: string },
    ) => validateResponse?.(buildValidRefinementOutput()).normalizedContent ?? buildValidRefinementOutput())

    runOpenCodePromptMock.mockResolvedValueOnce({
      session: { id: 'session-expand-salvage' },
      response: buildValidExpansionOutput({
        mutateFirstBead: (bead) => ({
          ...bead,
          contextGuidance: {
            patterns: ['Keep repairs deterministic'],
            anti_patterns: bead.contextGuidance.anti_patterns,
          },
        }),
      }),
      messages: [],
      responseMeta: {
        hasAssistantMessage: true,
        latestAssistantWasEmpty: false,
        latestAssistantHasError: false,
        latestAssistantWasStale: false,
      },
    })

    await handleBeadsRefine(ticket.id, context, sendEvent, new AbortController().signal)

    const persistedBeads = readFileSync(paths.beadsPath, 'utf-8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { contextGuidance: { patterns: string[] } })
    expect(persistedBeads[0]?.contextGuidance.patterns[0]).toBe('Keep repairs deterministic.')

    const companionArtifact = JSON.parse(readFileSync(
      resolve(paths.ticketDir, 'ui', 'artifact-companions', 'beads_expanded.json'),
      'utf-8',
    )) as {
      payload: {
        structuredOutput: {
          repairApplied: boolean
          autoRetryCount: number
          repairWarnings: string[]
        }
      }
    }
    expect(companionArtifact.payload.structuredOutput.repairApplied).toBe(true)
    expect(companionArtifact.payload.structuredOutput.autoRetryCount).toBe(0)
    expect(companionArtifact.payload.structuredOutput.repairWarnings).toEqual([
      expect.stringContaining('punctuation/whitespace-only drift'),
    ])
    expect(sendEvent).toHaveBeenCalledWith({ type: 'REFINED' })
  })

  it('adds preserved-field verbatim guidance on retry while keeping the retry budget at one', async () => {
    const { ticket, context, paths } = createInitializedTestTicket(repoManager, {
      title: 'Retry beads expansion with preserved-field drift guidance',
      description: 'Ensure preserved-field drift retries include the extra verbatim-copy appendix.',
    })
    const sendEvent = vi.fn()
    const winnerId = TEST.councilMembers[0]
    const winnerDraftContent = buildBeadSubsetContent()
    const losingDraftContent = buildBeadSubsetContent({
      includeSecondBead: true,
      secondBeadId: 'bead-9',
      secondBeadTitle: 'Adopt losing-draft telemetry',
    })

    phaseIntermediate.set(`${ticket.id}:beads`, {
      phase: 'beads',
      worktreePath: paths.worktreePath,
      winnerId,
      drafts: [
        { memberId: winnerId, outcome: 'completed', content: winnerDraftContent, duration: 1 },
        { memberId: TEST.councilMembers[1], outcome: 'completed', content: losingDraftContent, duration: 1 },
      ],
      memberOutcomes: {
        [winnerId]: 'completed',
        [TEST.councilMembers[1]]: 'completed',
      },
      contextBuilder: () => [],
    })

    refineDraftMock.mockImplementationOnce(async (
      _adapter: unknown,
      _winnerDraft: unknown,
      _losingDrafts: unknown,
      _contextParts: unknown,
      _projectPath: unknown,
      _timeoutMs: unknown,
      _signal: unknown,
      _onOpenCodeSessionLog: unknown,
      _onOpenCodeStreamEvent: unknown,
      _onOpenCodePromptDispatched: unknown,
      _sessionOwnership: unknown,
      _buildPrompt: unknown,
      validateResponse?: (content: string) => { normalizedContent?: string },
    ) => validateResponse?.(buildValidRefinementOutput()).normalizedContent ?? buildValidRefinementOutput())

    runOpenCodePromptMock
      .mockResolvedValueOnce({
        session: { id: 'session-expand-retry-1' },
        response: buildValidExpansionOutput({
          mutateFirstBead: (bead) => ({
            ...bead,
            description: 'Rewrite the refinement pipeline around a new metadata transport.',
          }),
        }),
        messages: [],
        responseMeta: {
          hasAssistantMessage: true,
          latestAssistantWasEmpty: false,
          latestAssistantHasError: false,
          latestAssistantWasStale: false,
        },
      })
      .mockResolvedValueOnce({
        session: { id: 'session-expand-retry-2' },
        response: buildValidExpansionOutput(),
        messages: [],
        responseMeta: {
          hasAssistantMessage: true,
          latestAssistantWasEmpty: false,
          latestAssistantHasError: false,
          latestAssistantWasStale: false,
        },
      })

    await handleBeadsRefine(ticket.id, context, sendEvent, new AbortController().signal)

    expect(runOpenCodePromptMock).toHaveBeenCalledTimes(2)
    const secondCall = runOpenCodePromptMock.mock.calls[1]?.[0] as { parts: Array<{ content: string }> }
    const retryPromptText = secondCall.parts.map((part) => part.content).join('\n')
    expect(retryPromptText).toContain('Copy every Part 1 field from `### beads_draft` verbatim, including punctuation.')
    expect(retryPromptText).toContain('Edit only `id`, `issueType`, `labels`, `dependencies.blocked_by`, and `targetFiles`.')
    expect(retryPromptText).toContain('Do not rewrite `title`, `prdRefs`, `description`, `contextGuidance`, `acceptanceCriteria`, `tests`, or `testCommands`.')

    const companionArtifact = JSON.parse(readFileSync(
      resolve(paths.ticketDir, 'ui', 'artifact-companions', 'beads_expanded.json'),
      'utf-8',
    )) as {
      payload: {
        structuredOutput: {
          autoRetryCount: number
        }
      }
    }
    expect(companionArtifact.payload.structuredOutput.autoRetryCount).toBe(1)
    expect(sendEvent).toHaveBeenCalledWith({ type: 'REFINED' })
  })
})
