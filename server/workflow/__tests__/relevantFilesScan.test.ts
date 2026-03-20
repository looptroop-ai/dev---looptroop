import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createActor } from 'xstate'
import { existsSync, readFileSync } from 'node:fs'
import { initializeDatabase } from '../../db/init'
import { sqlite } from '../../db/index'
import { clearProjectDatabaseCache } from '../../db/project'
import { ticketMachine } from '../../machines/ticketMachine'
import type { TicketContext as MachineTicketContext } from '../../machines/types'
import { attachProject } from '../../storage/projects'
import { createTicket, getLatestPhaseArtifact, getTicketPaths } from '../../storage/tickets'
import { createFixtureRepoManager } from '../../test/fixtureRepo'
import { initializeTicket } from '../../ticket/initialize'

const { runOpenCodePromptMock, runOpenCodeSessionPromptMock } = vi.hoisted(() => ({
  runOpenCodePromptMock: vi.fn(),
  runOpenCodeSessionPromptMock: vi.fn(),
}))

vi.mock('../../opencode/factory', () => ({
  getOpenCodeAdapter: () => ({}),
  isMockOpenCodeMode: () => false,
}))

vi.mock('../runOpenCodePrompt', () => ({
  runOpenCodePrompt: runOpenCodePromptMock,
  runOpenCodeSessionPrompt: runOpenCodeSessionPromptMock,
}))

import { handleRelevantFilesScan } from '../runner'

const repoManager = createFixtureRepoManager({
  templatePrefix: 'looptroop-relevant-files-',
  files: {
    'README.md': '# Relevant Files Scan Test\n',
    'src/main.ts': 'export const main = true\n',
    'src/routes.ts': 'export const routes = []\n',
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
    lockedCouncilMembers: null,
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
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    ...overrides,
  }
}

function createInitializedTicket() {
  const repoDir = repoManager.createRepo()
  const project = attachProject({
    folderPath: repoDir,
    name: 'LoopTroop',
    shortname: 'LOOP',
  })
  const ticket = createTicket({
    projectId: project.id,
    title: 'Harden relevant files scanning',
    description: 'Retry malformed relevant-files output and block on failure.',
  })

  initializeTicket({
    projectFolder: repoDir,
    externalId: ticket.externalId,
  })

  const paths = getTicketPaths(ticket.id)
  if (!paths) throw new Error('Expected ticket paths after initialization')

  return {
    ticket,
    context: buildTicketContext(ticket),
    paths,
  }
}

describe('handleRelevantFilesScan', () => {
  beforeEach(() => {
    clearProjectDatabaseCache()
    initializeDatabase()
    sqlite.exec('DELETE FROM attached_projects; DELETE FROM profiles;')
    runOpenCodePromptMock.mockReset()
    runOpenCodeSessionPromptMock.mockReset()
  })

  afterAll(() => {
    clearProjectDatabaseCache()
    repoManager.cleanup()
  })

  it('retries once in the same session after a prompt echo and succeeds with the corrected artifact', async () => {
    const { ticket, context, paths } = createInitializedTicket()
    const sendEvent = vi.fn()

    runOpenCodePromptMock.mockResolvedValueOnce({
      session: { id: 'ses-1', projectPath: paths.worktreePath },
      response: [
        'CRITICAL OUTPUT RULE:',
        'Return strict machine-readable output.',
        '',
        'CONTEXT REFRESH:',
        'Use the ticket context below.',
        '',
        '## System Role',
        'You are an expert software architect.',
      ].join('\n'),
      messages: [],
    })
    runOpenCodeSessionPromptMock.mockResolvedValueOnce({
      session: { id: 'ses-1', projectPath: paths.worktreePath },
      response: [
        '<RELEVANT_FILES_RESULT>',
        '```yaml',
        'payload:',
        '  file_count: 1',
        '  files:',
        '    - filepath: src/main.ts',
        '      reason: Entry point for the feature workflow.',
        '      relevance: high',
        '      action: modify',
        '      source: |',
        '        export const main = true',
        '```',
        '</RELEVANT_FILES_RESULT>',
      ].join('\n'),
      messages: [],
    })

    await handleRelevantFilesScan(ticket.id, context, sendEvent, new AbortController().signal)

    expect(runOpenCodePromptMock).toHaveBeenCalledTimes(1)
    expect(runOpenCodeSessionPromptMock).toHaveBeenCalledTimes(1)
    expect(runOpenCodeSessionPromptMock.mock.calls[0]?.[0]).toMatchObject({
      session: { id: 'ses-1' },
      model: 'openai/gpt-5-codex',
    })
    expect(runOpenCodeSessionPromptMock.mock.calls[0]?.[0]?.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'text',
        content: expect.stringContaining('## Structured Output Retry'),
      }),
    ]))
    expect(sendEvent).toHaveBeenCalledWith({ type: 'RELEVANT_FILES_READY' })

    const relevantFilesPath = `${paths.ticketDir}/relevant-files.yaml`
    expect(existsSync(relevantFilesPath)).toBe(true)
    const artifactYaml = readFileSync(relevantFilesPath, 'utf-8')
    expect(artifactYaml).toContain('ticket_id: LOOP-1')
    expect(artifactYaml).toContain('path: src/main.ts')
    expect(artifactYaml).toContain('likely_action: modify')

    const artifactRow = getLatestPhaseArtifact(ticket.id, 'relevant_files_scan', 'SCANNING_RELEVANT_FILES')
    expect(artifactRow).toBeDefined()
    const artifact = JSON.parse(artifactRow!.content) as { fileCount?: number; files?: Array<{ path?: string }> }
    expect(artifact.fileCount).toBe(1)
    expect(artifact.files?.[0]?.path).toBe('src/main.ts')
  })

  it('emits ERROR after the retry is exhausted so the ticket can block', async () => {
    const { ticket, context, paths } = createInitializedTicket()
    const sendEvent = vi.fn()

    runOpenCodePromptMock.mockResolvedValueOnce({
      session: { id: 'ses-2', projectPath: paths.worktreePath },
      response: [
        'CRITICAL OUTPUT RULE:',
        'Return strict machine-readable output.',
        '',
        'CONTEXT REFRESH:',
        'Use the ticket context below.',
      ].join('\n'),
      messages: [],
    })
    runOpenCodeSessionPromptMock.mockResolvedValueOnce({
      session: { id: 'ses-2', projectPath: paths.worktreePath },
      response: [
        '<RELEVANT_FILES_RESULT>',
        'file_count: 0',
        'files: []',
        '</RELEVANT_FILES_RESULT>',
      ].join('\n'),
      messages: [],
    })

    await handleRelevantFilesScan(ticket.id, context, sendEvent, new AbortController().signal)

    expect(sendEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'ERROR',
      message: expect.stringContaining('failed validation after retry'),
      codes: ['RELEVANT_FILES_SCAN_FAILED'],
    }))
    expect(existsSync(`${paths.ticketDir}/relevant-files.yaml`)).toBe(false)
    expect(getLatestPhaseArtifact(ticket.id, 'relevant_files_scan', 'SCANNING_RELEVANT_FILES')).toBeUndefined()
  })

  it('blocks immediately when no main implementer is locked', async () => {
    const { ticket } = createInitializedTicket()
    const sendEvent = vi.fn()

    await handleRelevantFilesScan(
      ticket.id,
      buildTicketContext(ticket, { lockedMainImplementer: null }),
      sendEvent,
      new AbortController().signal,
    )

    expect(runOpenCodePromptMock).not.toHaveBeenCalled()
    expect(sendEvent).toHaveBeenCalledWith({
      type: 'ERROR',
      message: 'No main implementer configured for relevant files scan.',
      codes: ['RELEVANT_FILES_SCAN_FAILED', 'MAIN_IMPLEMENTER_MISSING'],
    })
  })

  it('succeeds without retry when model output is truncated but normalizer recovers', async () => {
    const { ticket, context, paths } = createInitializedTicket()
    const sendEvent = vi.fn()

    runOpenCodePromptMock.mockResolvedValueOnce({
      session: { id: 'ses-trunc', projectPath: paths.worktreePath },
      response: [
        '<RELEVANT_FILES_RESULT>',
        'file_count: 3',
        'files:',
        '  - path: src/main.ts',
        '    rationale: Entry point.',
        '    relevance: high',
        '    likely_action: modify',
        '    content: |',
        '      export const main = true',
        '  - path: src/routes.ts',
        '    rationale: Routing surface.',
        '    relevance: medium',
        '    likely_action: read',
        '    content: |',
        '      export const routes = []',
        '  - path: src/broken.ts',
        '    rationale: This file entry gets cut off.',
        '    relevance: high',
        '    likely_action: modify',
        '    content: |',
        '      import { something } from "./something"',
        '    relev',
        // No closing tag — truncated mid-key at token limit
      ].join('\n'),
      messages: [],
    })

    await handleRelevantFilesScan(ticket.id, context, sendEvent, new AbortController().signal)

    // Should NOT have retried — normalizer recovered directly
    expect(runOpenCodeSessionPromptMock).not.toHaveBeenCalled()
    expect(sendEvent).toHaveBeenCalledWith({ type: 'RELEVANT_FILES_READY' })

    const relevantFilesPath = `${paths.ticketDir}/relevant-files.yaml`
    expect(existsSync(relevantFilesPath)).toBe(true)
    const artifactYaml = readFileSync(relevantFilesPath, 'utf-8')
    expect(artifactYaml).toContain('path: src/main.ts')
    expect(artifactYaml).toContain('path: src/routes.ts')
    // Truncated entry should NOT be in the artifact
    expect(artifactYaml).not.toContain('src/broken.ts')
  })

  it('transitions scan errors to BLOCKED_ERROR in the ticket machine', () => {
    const actor = createActor(ticketMachine, {
      input: buildTicketContext(createInitializedTicket().ticket),
    })

    actor.start()
    actor.send({ type: 'START', lockedMainImplementer: 'openai/gpt-5-codex' })
    expect(actor.getSnapshot().value).toBe('SCANNING_RELEVANT_FILES')

    actor.send({ type: 'ERROR', message: 'Relevant files scan failed', codes: ['RELEVANT_FILES_SCAN_FAILED'] })
    expect(actor.getSnapshot().value).toBe('BLOCKED_ERROR')
  })
})
