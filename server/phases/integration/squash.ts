import { execFileSync } from 'node:child_process'
import { resolveBaseBranchRef } from '../../git/repository'

export interface SquashResult {
  success: boolean
  message: string
  commitHash?: string
  mergeBase?: string
  preSquashHead?: string
  commitCount?: number
}

export function prepareSquashCandidate(
  worktreePath: string,
  baseBranch: string,
  ticketTitle: string,
  ticketId: string,
): SquashResult {
  const runGit = (args: string[]) => execFileSync('git', ['-C', worktreePath, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()

  try {
    const baseBranchRef = resolveBaseBranchRef(worktreePath, baseBranch)
    const preSquashHead = runGit(['rev-parse', 'HEAD'])
    const mergeBase = runGit(['merge-base', 'HEAD', baseBranchRef])
    const commitCount = Number(runGit(['rev-list', '--count', `${mergeBase}..HEAD`]))

    runGit(['reset', '--soft', mergeBase])
    runGit(['add', '-A'])

    const stagedChanges = runGit(['status', '--porcelain'])
    if (!stagedChanges) {
      runGit(['reset', '--soft', preSquashHead])
      return {
        success: false,
        message: 'No candidate changes were available to squash',
        mergeBase,
        preSquashHead,
        commitCount,
      }
    }

    runGit([
      '-c',
      'user.name=LoopTroop',
      '-c',
      'user.email=looptroop@local',
      'commit',
      '--no-verify',
      '-m',
      `${ticketId}: ${ticketTitle}`,
    ])
    const commitHash = runGit(['rev-parse', 'HEAD'])
    return {
      success: true,
      message: `Prepared candidate commit ${commitHash} from ${commitCount} commit(s) on ${ticketId}`,
      commitHash,
      mergeBase,
      preSquashHead,
      commitCount,
    }
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}
