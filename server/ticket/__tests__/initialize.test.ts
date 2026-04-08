import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AsyncLocalStorage } from 'node:async_hooks'
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { appendLogEvent } from '../../log/executionLog'
import { attachProject } from '../../storage/projects'
import { createTicket, getTicketPaths } from '../../storage/tickets'
import { createTestRepoManager, resetTestDb } from '../../test/factories'
import { initializeTicket } from '../initialize'

interface CommandLogContext {
  ticketId: string
  externalId: string
  phase: string
  emit: (phase: string, type: 'info' | 'error', content: string) => void
}

const STORE_KEY = Symbol.for('looptroop:commandLogStore')
let activeWorktreePath: string | null = null
let unsafeAppendCount = 0

function getSharedCommandLogStore(): AsyncLocalStorage<CommandLogContext> {
  const globalStore = globalThis as unknown as Record<symbol, AsyncLocalStorage<CommandLogContext> | undefined>
  if (!globalStore[STORE_KEY]) {
    globalStore[STORE_KEY] = new AsyncLocalStorage<CommandLogContext>()
  }
  return globalStore[STORE_KEY]!
}

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process')

  return {
    ...actual,
    spawnSync: vi.fn((command: string, args: readonly string[], options?: Parameters<typeof actual.spawnSync>[2]) => {
      const result = actual.spawnSync(command, args, options)
      const ctx = getSharedCommandLogStore().getStore()
      const targetRef = ctx?.externalId ? `refs/heads/${ctx.externalId}` : null

      if (
        ctx
        && activeWorktreePath
        && !existsSync(activeWorktreePath)
        && targetRef
        && args.includes('show-ref')
        && args.includes(targetRef)
      ) {
        unsafeAppendCount += 1
        ctx.emit(ctx.phase, 'info', `[CMD] $ git ${args.join(' ')}`)
      }

      return result
    }),
  }
})

const repoManager = createTestRepoManager('ticket-initialize-')

describe('initializeTicket', () => {
  beforeEach(() => {
    resetTestDb()
    activeWorktreePath = null
    unsafeAppendCount = 0
  })

  afterAll(() => {
    resetTestDb()
    repoManager.cleanup()
  })

  it('materializes a reserved ticket skeleton when command logs are persisted during initialization', () => {
    const repoDir = repoManager.createRepo()
    const project = attachProject({
      folderPath: repoDir,
      name: 'LoopTroop',
      shortname: 'LOOP',
    })
    const ticket = createTicket({
      projectId: project.id,
      title: 'Initialize with command logging',
      description: 'Regression coverage for worktree creation logging.',
    })
    const paths = getTicketPaths(ticket.id)
    if (!paths) throw new Error('Expected ticket paths before initialization')
    appendLogEvent(
      ticket.id,
      'info',
      'DRAFT',
      'Baseline log before initialization.',
      { timestamp: new Date().toISOString() },
      'system',
      'DRAFT',
    )

    activeWorktreePath = paths.worktreePath
    const init = getSharedCommandLogStore().run(
      {
        ticketId: ticket.id,
        externalId: ticket.externalId,
        phase: 'DRAFT',
        emit: (phase, type, content) => {
          const timestamp = new Date().toISOString()
          appendLogEvent(
            ticket.id,
            type,
            phase,
            content,
            { timestamp },
            type === 'error' ? 'error' : 'system',
            phase,
          )
        },
      },
      () => initializeTicket({
        projectFolder: repoDir,
        externalId: ticket.externalId,
      }),
    )
    activeWorktreePath = null

    expect(init.worktreePath).toBe(paths.worktreePath)
    expect(init.branchName).toBe(ticket.externalId)
    expect(existsSync(`${init.worktreePath}/.git`)).toBe(true)

    const branchResult = spawnSync('git', ['-C', init.worktreePath, 'branch', '--show-current'], {
      encoding: 'utf8',
    })
    expect(branchResult.status).toBe(0)
    expect(branchResult.stdout.trim()).toBe(ticket.externalId)

    expect(existsSync(paths.executionLogPath)).toBe(true)
    const persistedLog = readFileSync(paths.executionLogPath, 'utf8')
    expect(persistedLog).toContain('Baseline log before initialization.')
    expect(persistedLog).not.toContain('INIT_WORKTREE_CREATE_FAILED')
    expect(persistedLog).not.toContain('Ticket worktree is invalid after initialization')
    expect(unsafeAppendCount).toBe(0)
  })
})
