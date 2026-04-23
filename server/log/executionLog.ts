import type { LogEvent, LogEventType, LogSource } from './types'
import { safeAtomicAppend } from '../io/atomicAppend'
import { getTicketPaths } from '../storage/tickets'
import { removeBuffered } from './upsertBuffer'
import { resolvePhaseAttempt } from '../storage/ticketPhaseAttempts'

type StructuredLogFields = Omit<LogEvent, 'timestamp' | 'type' | 'ticketId' | 'phase' | 'message' | 'source' | 'status' | 'data'>

// Keys that are promoted to top-level LogEvent fields by pickStructuredFields.
// They are stripped from `data` before serialization to avoid redundant storage.
const STRUCTURED_KEYS: ReadonlySet<string> = new Set([
  'content', 'source', 'status', 'entryId', 'fingerprint', 'op', 'audience',
  'kind', 'modelId', 'sessionId', 'beadId', 'streaming', 'phaseAttempt',
])

// Internal-only keys that should never be persisted in the log file.
const INTERNAL_KEYS: ReadonlySet<string> = new Set([
  'suppressDebugMirror',
])

function pickStructuredFields(data?: Record<string, unknown>): Partial<LogEvent> {
  if (!data) return {}
  return {
    ...(typeof data.content === 'string' ? { content: data.content } : {}),
    ...(typeof data.source === 'string' ? { source: data.source as LogSource } : {}),
    ...(typeof data.status === 'string' ? { status: data.status } : {}),
    ...(typeof data.entryId === 'string' ? { entryId: data.entryId } : {}),
    ...(typeof data.fingerprint === 'string' ? { fingerprint: data.fingerprint } : {}),
    ...(typeof data.op === 'string' ? { op: data.op as LogEvent['op'] } : {}),
    ...(typeof data.audience === 'string' ? { audience: data.audience as LogEvent['audience'] } : {}),
    ...(typeof data.kind === 'string' ? { kind: data.kind as LogEvent['kind'] } : {}),
    ...(typeof data.modelId === 'string' ? { modelId: data.modelId } : {}),
    ...(typeof data.sessionId === 'string' ? { sessionId: data.sessionId } : {}),
    ...(typeof data.beadId === 'string' ? { beadId: data.beadId } : {}),
    ...(typeof data.streaming === 'boolean' ? { streaming: data.streaming } : {}),
    ...(typeof data.phaseAttempt === 'number' && Number.isFinite(data.phaseAttempt) ? { phaseAttempt: data.phaseAttempt } : {}),
  }
}

/**
 * Strip redundant and internal-only keys from the data object before
 * persisting. Structured fields are already promoted to top-level event
 * properties; keeping them in `data` doubles storage for every entry.
 */
function cleanDataForPersistence(data?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!data) return undefined
  const cleaned: Record<string, unknown> = {}
  let hasKeys = false
  for (const [key, value] of Object.entries(data)) {
    if (STRUCTURED_KEYS.has(key) || INTERNAL_KEYS.has(key)) continue
    cleaned[key] = value
    hasKeys = true
  }
  return hasKeys ? cleaned : undefined
}

/*
 * ── LOG SIZE BUDGET ──────────────────────────────────────────────────────
 *
 * The execution-log.jsonl file is preserved as audit/debug evidence and is
 * never automatically truncated. To keep it from growing unbounded:
 *
 * 1. STREAMING UPSERTS ARE NOT PERSISTED. Intermediate streaming snapshots
 *    (op='upsert' + streaming=true) are only delivered to the UI via SSE
 *    (broadcaster.broadcast in helpers.ts). Only the final 'finalize' event
 *    is written to disk. Without this, a 5-minute streaming session produces
 *    ~90 progressive snapshots with quadratic content growth.
 *
 * 2. DEBUG MIRROR ENTRIES ARE NOT PERSISTED. emitPhaseLog() auto-creates a
 *    debug copy of every non-debug log entry. These mirrors are broadcast
 *    via SSE for the real-time DEBUG tab but are NOT written to disk. Direct
 *    emitDebugLog() calls (e.g., opencode response logging) still persist.
 *    See the `persist` parameter on emitDebugLog in helpers.ts.
 *
 * 3. REDUNDANT DATA FIELDS ARE STRIPPED. Structured fields already promoted
 *    to top-level event properties (entryId, sessionId, etc.) and internal
 *    flags (suppressDebugMirror) are removed from `data` before serializing.
 *
 * These optimizations reduce log size by ~80% (38 MB → ~7 MB measured on
 * a real ticket). The real-time log viewer is unaffected because it receives
 * all events via SSE, which is independent of disk persistence.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function appendLogEvent(
  ticketId: string,
  type: LogEventType,
  phase: string,
  message: string,
  data?: Record<string, unknown>,
  source?: LogSource,
  status?: string,
  extra?: Partial<StructuredLogFields>,
) {
  const structured = pickStructuredFields(data)
  const timestamp = typeof data?.timestamp === 'string' ? data.timestamp : new Date().toISOString()
  const phaseAttempt = extra?.phaseAttempt
    ?? structured.phaseAttempt
    ?? resolvePhaseAttempt(ticketId, phase, typeof data?.phaseAttempt === 'number' ? data.phaseAttempt : undefined)
  const event: LogEvent = {
    timestamp,
    type,
    ticketId,
    phase,
    phaseAttempt,
    message,
    content: typeof data?.content === 'string' ? data.content : message,
    ...(source != null ? { source } : structured.source ? { source: structured.source } : {}),
    ...(status != null ? { status } : structured.status ? { status: structured.status } : {}),
    data: cleanDataForPersistence(data),
    ...structured,
    ...extra,
  }

  const fingerprint = typeof event.fingerprint === 'string' && event.fingerprint
    ? event.fingerprint
    : undefined

  const paths = getTicketPaths(ticketId)
  if (!paths) {
    throw new Error(`Ticket not found for execution log append: ${ticketId}`)
  }
  const logPath = paths.executionLogPath

  // Streaming upserts are NOT persisted — only delivered via SSE (see budget
  // note above). The finalize event carries the complete final content.
  if (event.op === 'upsert' && event.streaming && event.entryId) {
    return
  }

  // Finalize supersedes any buffered upsert for this entryId
  if (event.op === 'finalize' && event.entryId) {
    removeBuffered(event.entryId)
  }

  if (fingerprint && hasPersistedFingerprint(ticketId, phase, phaseAttempt, fingerprint)) {
    return
  }

  safeAtomicAppend(logPath, JSON.stringify(event))
  if (fingerprint) {
    rememberPersistedFingerprint(ticketId, phase, phaseAttempt, fingerprint)
  }
}

const MAX_PERSISTED_FINGERPRINTS_PER_TICKET = 256
const persistedFingerprintsByTicket = new Map<string, Map<string, number>>()

function buildFingerprintScopeKey(phase: string, phaseAttempt: number, fingerprint: string): string {
  return `${phase}:${phaseAttempt}:${fingerprint}`
}

function hasPersistedFingerprint(ticketId: string, phase: string, phaseAttempt: number, fingerprint: string): boolean {
  const key = buildFingerprintScopeKey(phase, phaseAttempt, fingerprint)
  return persistedFingerprintsByTicket.get(ticketId)?.has(key) ?? false
}

function rememberPersistedFingerprint(ticketId: string, phase: string, phaseAttempt: number, fingerprint: string): void {
  const bucket = persistedFingerprintsByTicket.get(ticketId) ?? new Map<string, number>()
  const scopedKey = buildFingerprintScopeKey(phase, phaseAttempt, fingerprint)
  if (bucket.has(scopedKey)) {
    bucket.delete(scopedKey)
  }
  bucket.set(scopedKey, Date.now())

  while (bucket.size > MAX_PERSISTED_FINGERPRINTS_PER_TICKET) {
    const oldest = bucket.keys().next().value
    if (!oldest) break
    bucket.delete(oldest)
  }

  persistedFingerprintsByTicket.set(ticketId, bucket)
}

export function createLogEvent(
  ticketId: string,
  type: LogEventType,
  phase: string,
  message: string,
  data?: Record<string, unknown>,
  source?: LogSource,
  status?: string,
  extra?: Partial<StructuredLogFields>,
): LogEvent {
  const structured = pickStructuredFields(data)
  const timestamp = typeof data?.timestamp === 'string' ? data.timestamp : new Date().toISOString()
  const phaseAttempt = extra?.phaseAttempt
    ?? structured.phaseAttempt
    ?? resolvePhaseAttempt(ticketId, phase, typeof data?.phaseAttempt === 'number' ? data.phaseAttempt : undefined)
  return {
    timestamp,
    type,
    ticketId,
    phase,
    phaseAttempt,
    message,
    content: typeof data?.content === 'string' ? data.content : message,
    ...(source != null ? { source } : structured.source ? { source: structured.source } : {}),
    ...(status != null ? { status } : structured.status ? { status: structured.status } : {}),
    data,
    ...structured,
    ...extra,
  }
}
