import { resolve, relative, isAbsolute } from 'path'

export function isWithinScope(filePath: string, scopeRoot: string): boolean {
  const resolved = isAbsolute(filePath) ? filePath : resolve(scopeRoot, filePath)
  const rel = relative(scopeRoot, resolved)
  return !rel.startsWith('..') && !isAbsolute(rel)
}

export function validateRunnerAccess(
  requestedPath: string,
  ticketWorktree: string,
): { allowed: boolean; reason?: string } {
  if (!isWithinScope(requestedPath, ticketWorktree)) {
    return { allowed: false, reason: `Access denied: ${requestedPath} is outside ticket worktree` }
  }
  return { allowed: true }
}
