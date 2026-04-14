import { beforeEach, describe, expect, it, vi } from 'vitest'

const spawnSyncMock = vi.fn()

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process')
  return {
    ...actual,
    spawnSync: spawnSyncMock,
  }
})

function makeSpawnResult(overrides: {
  status?: number
  stdout?: string
  stderr?: string
  error?: Error
} = {}): ReturnType<typeof import('node:child_process').spawnSync> {
  return {
    status: overrides.status ?? 0,
    stdout: overrides.stdout ?? '',
    stderr: overrides.stderr ?? '',
    error: overrides.error,
    pid: 123,
    output: [null, overrides.stdout ?? '', overrides.stderr ?? ''],
    signal: null,
  } as ReturnType<typeof import('node:child_process').spawnSync>
}

describe('server/git/github', () => {
  beforeEach(() => {
    vi.resetModules()
    spawnSyncMock.mockReset()
  })

  it('accepts a direct github.com remote without SSH alias resolution', async () => {
    const github = await import('../github')

    const repo = github.parseGitHubRemoteUrl('git@github.com:openai/looptroop.git')

    expect(repo).toEqual({
      owner: 'openai',
      repo: 'looptroop',
      slug: 'openai/looptroop',
      remoteUrl: 'git@github.com:openai/looptroop.git',
    })
    expect(spawnSyncMock).not.toHaveBeenCalled()
  })

  it('accepts an SSH alias remote when the alias resolves to github.com', async () => {
    spawnSyncMock.mockImplementation((command: string, args: readonly string[]) => {
      expect(command).toBe('ssh')
      expect(args).toEqual(['-G', 'github-second'])
      return makeSpawnResult({
        stdout: 'host github-second\nhostname github.com\nuser git\n',
      })
    })

    const github = await import('../github')
    const repo = github.parseGitHubRemoteUrl('git@github-second:looptroop-ai/pocketbase-master.git')

    expect(repo).toEqual({
      owner: 'looptroop-ai',
      repo: 'pocketbase-master',
      slug: 'looptroop-ai/pocketbase-master',
      remoteUrl: 'git@github-second:looptroop-ai/pocketbase-master.git',
    })
    expect(spawnSyncMock).toHaveBeenCalledTimes(1)
  })

  it('rejects an SSH alias remote when the alias resolves to a non-GitHub host', async () => {
    spawnSyncMock.mockReturnValue(makeSpawnResult({
      stdout: 'host company-git\nhostname gitlab.example.com\nuser git\n',
    }))

    const github = await import('../github')
    const repo = github.parseGitHubRemoteUrl('git@company-git:looptroop-ai/pocketbase-master.git')

    expect(repo).toBeNull()
  })

  it('treats gh auth as ready when an active GitHub account succeeds even if another account fails', async () => {
    spawnSyncMock.mockReturnValue(makeSpawnResult({
      stdout: JSON.stringify({
        hosts: {
          'github.com': [
            { state: 'success', active: true, login: 'looptroop-ai' },
            { state: 'error', active: false, login: 'liviux', error: 'HTTP 401: Bad credentials' },
          ],
        },
      }),
    }))

    const github = await import('../github')

    expect(github.getGhAuthStatus()).toEqual({ ok: true })
  })

  it('surfaces a useful auth error when there is no active successful GitHub account', async () => {
    spawnSyncMock.mockReturnValue(makeSpawnResult({
      stdout: JSON.stringify({
        hosts: {
          'github.com': [
            { state: 'error', active: true, login: 'looptroop-ai', error: 'HTTP 401: Bad credentials' },
          ],
        },
      }),
    }))

    const github = await import('../github')
    const result = github.getGhAuthStatus()

    expect(result.ok).toBe(false)
    expect(result).toEqual({
      ok: false,
      error: 'looptroop-ai (error): HTTP 401: Bad credentials',
    })
  })

  it('omits an oversized patch instead of throwing during PR diff capture', async () => {
    spawnSyncMock.mockImplementation((_command: string, args: readonly string[]) => {
      if (args.includes('--stat')) {
        return makeSpawnResult({ stdout: 'src/app.ts | 2 +-' })
      }
      if (args.includes('--name-status')) {
        return makeSpawnResult({ stdout: 'M\tsrc/app.ts' })
      }
      if (args.includes('--unified=0')) {
        return makeSpawnResult({ error: new Error('spawnSync git ENOBUFS') })
      }
      return makeSpawnResult()
    })

    const github = await import('../github')
    const result = github.readGitDiff('/repo', 'base', 'head')

    expect(result.stat).toBe('src/app.ts | 2 +-')
    expect(result.nameStatus).toBe('M\tsrc/app.ts')
    expect(result.patchTruncated).toBe(true)
    expect(result.patchError).toBe('spawnSync git ENOBUFS')
    expect(result.patch).toContain('omitted the full patch')
  })
})
