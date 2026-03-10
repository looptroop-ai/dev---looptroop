import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeDatabase } from '../../db/init'
import { db as appDb } from '../../db/index'
import { clearProjectDatabaseCache } from '../../db/project'
import { attachedProjects, profiles } from '../../db/schema'
import { broadcaster } from '../../sse/broadcaster'
import { stopAllActors } from '../../machines/persistence'
import { resetOpenCodeAdapter } from '../../opencode/factory'
import { createFixtureRepoManager } from '../../test/fixtureRepo'
import { attachProject } from '../projects'
import {
  createTicket,
  insertPhaseArtifact,
  listPhaseArtifacts,
  upsertLatestPhaseArtifact,
} from '../tickets'

const repoFixture = createFixtureRepoManager({
  templatePrefix: 'looptroop-storage-template-',
  files: {
    'README.md': '# Fixture\n',
  },
})

beforeAll(() => {
  initializeDatabase()
})

afterAll(() => {
  repoFixture.cleanup()
})

beforeEach(() => {
  stopAllActors()
  resetOpenCodeAdapter()
  clearProjectDatabaseCache()
  appDb.delete(attachedProjects).run()
  appDb.delete(profiles).run()
})

afterEach(() => {
  stopAllActors()
  resetOpenCodeAdapter()
  clearProjectDatabaseCache()
  vi.restoreAllMocks()
  appDb.delete(attachedProjects).run()
  appDb.delete(profiles).run()
})

describe('ticket artifact storage', () => {
  it('broadcasts and lists inserted artifacts using the public row shape', () => {
    const repoDir = repoFixture.createRepo('looptroop-storage-insert-')
    const project = attachProject({
      folderPath: repoDir,
      name: 'Storage Fixture',
      shortname: 'STR',
    })
    const ticket = createTicket({
      projectId: project.id,
      title: 'Broadcast inserted artifacts',
    })
    const broadcastSpy = vi.spyOn(broadcaster, 'broadcast')

    insertPhaseArtifact(ticket.id, {
      phase: 'COUNCIL_DELIBERATING',
      artifactType: 'interview_drafts',
      content: '{"drafts":[]}',
    })

    const artifacts = listPhaseArtifacts(ticket.id)
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]).toMatchObject({
      ticketId: ticket.id,
      phase: 'COUNCIL_DELIBERATING',
      artifactType: 'interview_drafts',
      filePath: null,
      content: '{"drafts":[]}',
    })

    expect(broadcastSpy).toHaveBeenCalledWith(ticket.id, 'artifact_change', expect.objectContaining({
      ticketId: ticket.id,
      phase: 'COUNCIL_DELIBERATING',
      artifactType: 'interview_drafts',
      artifact: expect.objectContaining({
        id: artifacts[0]?.id,
        ticketId: ticket.id,
        phase: 'COUNCIL_DELIBERATING',
        artifactType: 'interview_drafts',
        filePath: null,
        content: '{"drafts":[]}',
      }),
    }))
  })

  it('broadcasts updated snapshots on upsert while keeping the artifact id stable', () => {
    const repoDir = repoFixture.createRepo('looptroop-storage-upsert-')
    const project = attachProject({
      folderPath: repoDir,
      name: 'Storage Fixture',
      shortname: 'STR',
    })
    const ticket = createTicket({
      projectId: project.id,
      title: 'Broadcast updated artifacts',
    })

    upsertLatestPhaseArtifact(ticket.id, 'interview_drafts', 'COUNCIL_DELIBERATING', '{"drafts":[]}')
    const firstArtifact = listPhaseArtifacts(ticket.id)[0]
    expect(firstArtifact).toBeDefined()

    const broadcastSpy = vi.spyOn(broadcaster, 'broadcast')
    upsertLatestPhaseArtifact(ticket.id, 'interview_drafts', 'COUNCIL_DELIBERATING', '{"drafts":[{"memberId":"openai/gpt-5"}]}')

    const artifacts = listPhaseArtifacts(ticket.id)
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]?.id).toBe(firstArtifact?.id)
    expect(artifacts[0]?.content).toBe('{"drafts":[{"memberId":"openai/gpt-5"}]}')

    expect(broadcastSpy).toHaveBeenCalledWith(ticket.id, 'artifact_change', expect.objectContaining({
      ticketId: ticket.id,
      phase: 'COUNCIL_DELIBERATING',
      artifactType: 'interview_drafts',
      artifact: expect.objectContaining({
        id: firstArtifact?.id,
        ticketId: ticket.id,
        phase: 'COUNCIL_DELIBERATING',
        artifactType: 'interview_drafts',
        filePath: null,
        content: '{"drafts":[{"memberId":"openai/gpt-5"}]}',
      }),
    }))
  })
})
