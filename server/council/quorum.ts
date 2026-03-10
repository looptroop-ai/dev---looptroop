import type { DraftResult, MemberOutcome } from './types'

export function checkQuorum(
  results: DraftResult[],
  minQuorum: number = 2,
): { passed: boolean; validCount: number; message: string } {
  const validCount = results.filter(r => r.outcome === 'completed' && r.content).length

  if (validCount >= minQuorum) {
    return { passed: true, validCount, message: `Quorum met: ${validCount} valid responses` }
  }

  // Collect failure reasons for diagnostics
  const failures = results
    .filter(r => r.outcome !== 'completed')
    .map(r => {
      const reason = r.error ?? (r.content.startsWith('error: ') ? r.content.slice(7) : r.outcome)
      return `${r.memberId}: ${reason}`
    })
  const failureDetail = failures.length > 0 ? ` Failures: ${failures.join('; ')}` : ''

  return {
    passed: false,
    validCount,
    message: `Quorum not met: ${validCount}/${minQuorum} required valid responses.${failureDetail}`,
  }
}

export function checkMemberResponseQuorum(
  memberOutcomes: Record<string, MemberOutcome>,
  minQuorum: number = 2,
): { passed: boolean; completedCount: number; message: string } {
  const entries = Object.entries(memberOutcomes)
  const completedCount = entries.filter(([, outcome]) => outcome === 'completed').length

  if (completedCount >= minQuorum) {
    return { passed: true, completedCount, message: `Quorum met: ${completedCount} completed responses` }
  }

  const failures = entries
    .filter(([, outcome]) => outcome !== 'completed')
    .map(([memberId, outcome]) => `${memberId}: ${outcome}`)
  const failureDetail = failures.length > 0 ? ` Failures: ${failures.join('; ')}` : ''

  return {
    passed: false,
    completedCount,
    message: `Quorum not met: ${completedCount}/${minQuorum} required completed responses.${failureDetail}`,
  }
}
