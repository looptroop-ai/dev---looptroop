import { AsyncLocalStorage } from 'node:async_hooks'

interface CommandLogContext {
  ticketId: string
  externalId: string
  phase: string
  fields?: Record<string, unknown>
  /** Emitter callback for SYS log entries. */
  emit: (phase: string, type: 'info' | 'error', content: string, data?: Record<string, unknown>) => void
}

// Use a globalThis singleton so the same AsyncLocalStorage is shared across
// ESM (import) and CJS (require) module instances. Without this, the project's
// "type": "module" setting causes require() in logCmd() wrappers to load a
// separate module instance whose commandLogStore is a different object —
// making logCommand() always see undefined context and silently no-op.
const STORE_KEY = Symbol.for('looptroop:commandLogStore')
function getSharedStore(): AsyncLocalStorage<CommandLogContext> {
  const g = globalThis as unknown as Record<symbol, AsyncLocalStorage<CommandLogContext> | undefined>
  if (!g[STORE_KEY]) {
    g[STORE_KEY] = new AsyncLocalStorage<CommandLogContext>()
  }
  return g[STORE_KEY]!
}
const commandLogStore = getSharedStore()

/**
 * Run `fn` with command-logging context active.  Any `logCommand()` calls
 * made anywhere in the call stack inside `fn` will emit SYS log entries
 * for the given ticket/phase via the provided `emit` function.
 */
export function withCommandLogging<T>(
  ticketId: string,
  externalId: string,
  phase: string,
  fn: () => T,
  emit: CommandLogContext['emit'],
): T {
  return commandLogStore.run({ ticketId, externalId, phase, emit }, fn)
}

/**
 * Async variant of `withCommandLogging` for async callers.
 */
export async function withCommandLoggingAsync<T>(
  ticketId: string,
  externalId: string,
  phase: string,
  fn: () => Promise<T>,
  emit: CommandLogContext['emit'],
): Promise<T> {
  return commandLogStore.run({ ticketId, externalId, phase, emit }, fn)
}

/**
 * Nest command logging metadata inside the current async context.
 * This lets callers scope command rows to a bead without changing the
 * surrounding command logging lifecycle.
 */
export function withCommandLoggingFields<T>(
  fields: Record<string, unknown>,
  fn: () => T,
): T {
  const ctx = commandLogStore.getStore()
  if (!ctx) return fn()
  return commandLogStore.run({
    ...ctx,
    fields: {
      ...(ctx.fields ?? {}),
      ...fields,
    },
  }, fn)
}

export async function withCommandLoggingFieldsAsync<T>(
  fields: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  const ctx = commandLogStore.getStore()
  if (!ctx) return await fn()
  return await commandLogStore.run({
    ...ctx,
    fields: {
      ...(ctx.fields ?? {}),
      ...fields,
    },
  }, fn)
}

/**
 * Log a shell command execution result as a SYS log entry.
 * No-op if no command-logging context is active.
 *
 * @param bin     The binary name (e.g. 'git')
 * @param args    The arguments array
 * @param result  The outcome: `{ ok: true, stdout? }` or `{ ok: false, error }`
 */
export function logCommand(
  bin: string,
  args: string[],
  result: { ok: true; stdout?: string; stderr?: string } | { ok: false; error: string },
) {
  const ctx = commandLogStore.getStore()
  if (!ctx) return

  // Build a human-readable command string, redacting the -C <path> for brevity
  const displayArgs = redactCwd(args)
  const cmdStr = `${bin} ${displayArgs.join(' ')}`
  const commandText = [bin, ...args].join(' ')

  let content: string
  let type: 'info' | 'error'

  if (result.ok) {
    const probeOutcome = formatKnownGitProbeSuccess(commandText, result.stdout, result.stderr)
    if (probeOutcome) {
      content = `[CMD] $ ${cmdStr}  →  ${truncateOutput(probeOutcome, 2500)}`
      type = 'info'
      ctx.emit(ctx.phase, type, content, ctx.fields)
      return
    }

    const outputStr = formatCompactCommandOutput(result.stdout, result.stderr)
    content = outputStr
      ? `[CMD] $ ${cmdStr}  →  ${truncateOutput(outputStr, 2500)}`
      : `[CMD] $ ${cmdStr}  →  ok`
    type = 'info'
  } else {
    const benignProbeFailure = formatKnownGitProbeFailure(commandText, result.error)
    if (benignProbeFailure) {
      content = `[CMD] $ ${cmdStr}  →  ${truncateOutput(benignProbeFailure, 2500)}`
      type = 'info'
      ctx.emit(ctx.phase, type, content, ctx.fields)
      return
    }

    const error = compactCommandText(result.error)
    content = `[CMD] $ ${cmdStr}  →  error: ${truncateOutput(error, 2500)}`
    type = 'error'
  }

  ctx.emit(ctx.phase, type, content, ctx.fields)
}

/**
 * Redact the `-C <path>` git flag to keep logs concise.
 * Shows just the last two path segments instead of the full absolute path.
 */
function redactCwd(args: string[]): string[] {
  const result: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-C' && i + 1 < args.length) {
      const fullPath = args[i + 1]!
      const shortPath = fullPath.split('/').slice(-2).join('/')
      result.push('-C', shortPath)
      i++ // skip the path argument
    } else {
      result.push(args[i]!)
    }
  }
  return result
}

function compactCommandText(text: string | undefined): string {
  return (text ?? '').trim().replace(/\r?\n+/g, ' | ')
}

function formatCompactCommandOutput(stdout?: string, stderr?: string): string {
  const normalizedStdout = compactCommandText(stdout)
  const normalizedStderr = compactCommandText(stderr)

  if (normalizedStdout && normalizedStderr) {
    return `STDOUT: ${normalizedStdout} | STDERR: ${normalizedStderr}`
  }
  if (normalizedStdout) return normalizedStdout
  if (normalizedStderr) return `STDERR: ${normalizedStderr}`
  return ''
}

function isLikelyMissingRefProbeFailure(error: string): boolean {
  const normalized = error.trim()
  return normalized === 'exit code 1' || normalized === 'command returned non-zero'
}

function formatKnownGitProbeSuccess(commandText: string, stdout?: string, stderr?: string): string | null {
  if (!commandText.startsWith('git ')) return null

  const output = formatCompactCommandOutput(stdout, stderr)
  if (commandText.includes(' show-ref --verify --quiet refs/')) {
    return output || 'ref found'
  }

  if (commandText.includes(' symbolic-ref --quiet --short refs/remotes/origin/HEAD')) {
    return output || 'origin/HEAD resolved'
  }

  if (commandText.includes(' rev-parse --abbrev-ref HEAD')) {
    return output || 'branch resolved'
  }

  return null
}

function formatKnownGitProbeFailure(commandText: string, error: string): string | null {
  if (!commandText.startsWith('git ')) return null
  if (!isLikelyMissingRefProbeFailure(error)) return null

  if (commandText.includes(' symbolic-ref --quiet --short refs/remotes/origin/HEAD')) {
    return 'origin/HEAD not set'
  }

  if (commandText.includes(' show-ref --verify --quiet refs/')) {
    return 'ref not found'
  }

  return null
}

function truncateOutput(text: string, maxLen = 800): string {
  if (text.length <= maxLen) return text
  return `${text.slice(0, maxLen)}… (truncated)`
}
