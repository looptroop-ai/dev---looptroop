import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { OpenCodeAdapter } from '../adapter'
import type {
  HealthStatus,
  Message,
  PromptPart,
  PromptSessionOptions,
  Session,
  StreamEvent,
} from '../types'
import { initializeDatabase } from '../../db/init'
import { sqlite } from '../../db/index'
import { clearProjectDatabaseCache } from '../../db/project'
import { SessionManager } from '../sessionManager'
import { attachProject } from '../../storage/projects'
import { createTicket, patchTicket } from '../../storage/tickets'
import { createFixtureRepoManager } from '../../test/fixtureRepo'

class TestOpenCodeAdapter implements OpenCodeAdapter {
  public sessions: Session[] = []
  private sessionCounter = 0

  async createSession(projectPath: string): Promise<Session> {
    const session: Session = {
      id: `session-${++this.sessionCounter}`,
      projectPath,
      createdAt: new Date().toISOString(),
    }
    this.sessions.push(session)
    return session
  }

  async promptSession(
    _sessionId: string,
    _parts: PromptPart[],
    _signal?: AbortSignal,
    _options?: PromptSessionOptions,
  ): Promise<string> {
    return 'assistant response'
  }

  async listSessions(): Promise<Session[]> {
    return this.sessions
  }

  async getSessionMessages(_sessionId: string): Promise<Message[]> {
    return []
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

const repoManager = createFixtureRepoManager({
  templatePrefix: 'looptroop-session-manager-',
  files: {
    'README.md': '# Session Manager Test\n',
  },
})

describe('SessionManager', () => {
  beforeEach(() => {
    clearProjectDatabaseCache()
    initializeDatabase()
    sqlite.exec('DELETE FROM attached_projects; DELETE FROM profiles;')
  })

  afterAll(() => {
    clearProjectDatabaseCache()
    repoManager.cleanup()
  })

  it('requires PRD step ownership to match when reconnecting an active session', async () => {
    const repoDir = repoManager.createRepo()
    const project = attachProject({
      folderPath: repoDir,
      name: 'LoopTroop',
      shortname: 'LOOP',
    })
    const ticket = createTicket({
      projectId: project.id,
      title: 'Reconnect PRD sessions by step',
      description: 'Ensure PRD sub-steps do not reuse each other sessions.',
    })
    patchTicket(ticket.id, { status: 'DRAFTING_PRD' })

    const adapter = new TestOpenCodeAdapter()
    const sessionManager = new SessionManager(adapter)
    const created = await sessionManager.createSessionForPhase(
      ticket.id,
      'DRAFTING_PRD',
      1,
      'model-a',
      undefined,
      undefined,
      'full_answers',
      repoDir,
    )

    await expect(sessionManager.validateAndReconnect(ticket.id, 'DRAFTING_PRD', {
      phaseAttempt: 1,
      memberId: 'model-a',
      step: 'full_answers',
    })).resolves.toEqual(created)

    await expect(sessionManager.validateAndReconnect(ticket.id, 'DRAFTING_PRD', {
      phaseAttempt: 1,
      memberId: 'model-a',
      step: 'prd_draft',
    })).resolves.toBeNull()
  })
})
