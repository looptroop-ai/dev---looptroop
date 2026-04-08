import { AsyncLocalStorage } from 'node:async_hooks'

interface CommandLogContext {
  ticketId: string
  externalId: string
  phase: string
  /** Emitter callback for SYS log entries. */
  emit: (phase: string, type: 'info' | 'error', content: string) => void
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

  let content: string
  let type: 'info' | 'error'

  if (result.ok) {
    const stdout = result.stdout?.trim()
    const stderr = result.stderr?.trim()
    
    let outputStr = ''
    if (stdout || stderr) {
      const parts = []
      if (stdout) parts.push(`STDOUT:\n${stdout}`)
      if (stderr) parts.push(`STDERR:\n${stderr}`)
      outputStr = `\n${parts.join('\n\n')}`
    }

    content = outputStr
      ? `[CMD] $ ${cmdStr}${truncateOutput(outputStr, 2500)}`
      : `[CMD] $ ${cmdStr}  →  ok`
    type = 'info'
  } else {
    const error = result.error.trim()
    content = `[CMD] $ ${cmdStr}  →  error:\n${truncateOutput(error, 2500)}`
    type = 'error'
  }

  ctx.emit(ctx.phase, type, content)
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

function truncateOutput(text: string, maxLen = 800): string {
  if (text.length <= maxLen) return text
  return `${text.slice(0, maxLen)}… (truncated)`
}
