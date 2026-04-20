import { extractLogFingerprint, hasMatchingLogFingerprint } from '@shared/logIdentity'

export interface LogEntry {
  id: string
  entryId: string
  fingerprint?: string
  line: string
  source: string
  status: string
  timestamp?: string
  audience: 'all' | 'ai' | 'debug'
  kind: string
  modelId?: string
  sessionId?: string
  beadId?: string
  streaming: boolean
  op: 'append' | 'upsert' | 'finalize'
}

export interface PlainLogOptions {
  source?: string
  status?: string
  timestamp?: string
  audience?: LogEntry['audience']
  kind?: string
  modelId?: string
  sessionId?: string
  entryId?: string
  fingerprint?: string
  op?: LogEntry['op']
  streaming?: boolean
}

export interface LogContextValue {
  logsByPhase: Record<string, LogEntry[]>
  activePhase: string | null
  isLoadingLogs: boolean
  addLog: (phase: string, line: string, options?: PlainLogOptions) => void
  addLogRecord: (phase: string, data: Record<string, unknown>) => void
  getLogsForPhase: (phase: string) => LogEntry[]
  getAllLogs: () => LogEntry[]
  setActivePhase: (phase: string | null) => void
  clearLogs: () => void
}

export const LOG_STORAGE_PREFIX = 'logs-v2-'
export const LEGACY_LOG_STORAGE_PREFIX = 'logs-'

const LOG_TYPE_TAGS: Record<string, string> = {
  state_change: '[SYS]',
  model_output: '[MODEL]',
  test_result: '[TEST]',
  error: '[ERROR]',
  bead_complete: '[BEAD]',
  info: '[SYS]',
  debug: '[DEBUG]',
}

export const serverLogCache = new Map<string, Array<Record<string, unknown>>>()

const LOW_VALUE_GIT_PROBE_PATTERNS = [
  ' symbolic-ref --quiet --short refs/remotes/origin/HEAD',
  ' rev-parse --abbrev-ref HEAD',
  ' show-ref --verify --quiet refs/heads/',
  ' show-ref --verify --quiet refs/remotes/origin/',
  ' diff --cached --quiet',
] as const

function stringifyForLine(value: unknown, maxLen = 2000): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  try {
    const raw = JSON.stringify(value)
    return raw.length > maxLen ? `${raw.slice(0, maxLen)}…[truncated]` : raw
  } catch {
    return String(value)
  }
}

function extractContent(data: Record<string, unknown>): string {
  const directCandidates = [data.content, data.message, data.text]
  for (const candidate of directCandidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate
  }

  const nested = data.data && typeof data.data === 'object'
    ? (data.data as Record<string, unknown>)
    : null
  if (!nested) return ''

  const nestedCandidates = [nested.content, nested.message, nested.text]
  for (const candidate of nestedCandidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate
  }

  return ''
}

function deriveSource(data: Record<string, unknown>): string {
  if (typeof data.source === 'string' && data.source) return data.source
  if (typeof data.modelId === 'string' && data.modelId) return `model:${data.modelId}`

  const nested = data.data && typeof data.data === 'object'
    ? (data.data as Record<string, unknown>)
    : null
  if (nested) {
    if (typeof nested.source === 'string' && nested.source) return nested.source
    if (typeof nested.modelId === 'string' && nested.modelId) return `model:${nested.modelId}`
  }

  const type = String(data.type ?? 'info')
  if (type === 'debug') return 'debug'
  if (type === 'error') return 'error'
  if (type === 'model_output') return 'opencode'
  return 'system'
}

function deriveAudience(data: Record<string, unknown>, source: string): LogEntry['audience'] {
  if (data.audience === 'all' || data.audience === 'ai' || data.audience === 'debug') return data.audience
  if (source === 'debug') return 'debug'
  if (source === 'opencode' || source.startsWith('model:')) return 'ai'
  return 'all'
}

function deriveKind(data: Record<string, unknown>, type: string, audience: LogEntry['audience']): string {
  if (typeof data.kind === 'string' && data.kind) return data.kind
  if (type === 'error') return 'error'
  if (type === 'test_result') return 'test'
  if (audience === 'ai') return type === 'model_output' ? 'text' : 'session'
  return 'milestone'
}

function deriveModelId(data: Record<string, unknown>, source: string): string | undefined {
  if (typeof data.modelId === 'string' && data.modelId) return data.modelId
  if (source.startsWith('model:')) return source.slice('model:'.length)

  const nested = data.data && typeof data.data === 'object'
    ? (data.data as Record<string, unknown>)
    : null
  if (typeof nested?.modelId === 'string' && nested.modelId) return nested.modelId
  return undefined
}

function deriveOperation(data: Record<string, unknown>): LogEntry['op'] {
  if (data.op === 'append' || data.op === 'upsert' || data.op === 'finalize') return data.op
  return 'append'
}

function formatLine(type: string, kind: string, content: string, fallback: unknown): string {
  if (kind === 'reasoning' && content) {
    return content
  }
  const tag = LOG_TYPE_TAGS[type] || '[SYS]'
  if (content) {
    return /^\[[A-Z_]+\]/.test(content.trim()) ? content : `${tag} ${content}`
  }
  return `${tag} ${stringifyForLine(fallback)}`
}

export function fallbackEntryId(status: string, source: string, timestamp: string | undefined, line: string): string {
  return `${status}:${source}:${timestamp ?? 'no-ts'}:${line}`
}

export function normalizeLogRecord(data: Record<string, unknown>, fallbackPhase: string): LogEntry {
  const type = String(data.type ?? 'info')
  const source = deriveSource(data)
  const audience = deriveAudience(data, source)
  const kind = deriveKind(data, type, audience)
  const status = String(data.status ?? data.phase ?? fallbackPhase)
  const timestamp = typeof data.timestamp === 'string' ? data.timestamp : undefined
  const fingerprint = extractLogFingerprint(data)
  const line = formatLine(type, kind, extractContent(data), data)
  const entryId = typeof data.entryId === 'string' && data.entryId
    ? data.entryId
    : fallbackEntryId(status, source, timestamp, line)
  const modelId = deriveModelId(data, source)
  const sessionId = typeof data.sessionId === 'string' ? data.sessionId : undefined
  const beadId = typeof data.beadId === 'string' ? data.beadId : undefined
  const op = deriveOperation(data)
  const streaming = typeof data.streaming === 'boolean' ? data.streaming : op !== 'append'

  return {
    id: entryId,
    entryId,
    line,
    source,
    status,
    ...(timestamp ? { timestamp } : {}),
    ...(fingerprint ? { fingerprint } : {}),
    audience,
    kind,
    ...(modelId ? { modelId } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(beadId ? { beadId } : {}),
    streaming,
    op,
  }
}

export function normalizeStoredEntry(entry: Partial<LogEntry>, fallbackStatus: string): LogEntry {
  const source = String(entry.source ?? 'system')
  const status = String(entry.status ?? fallbackStatus)
  const line = String(entry.line ?? '')
  const timestamp = entry.timestamp ? String(entry.timestamp) : undefined
  const fingerprint = extractLogFingerprint(entry as Record<string, unknown>)
  const audience = entry.audience === 'all' || entry.audience === 'ai' || entry.audience === 'debug'
    ? entry.audience
    : source === 'debug'
      ? 'debug'
      : source === 'opencode' || source.startsWith('model:')
        ? 'ai'
        : 'all'
  const entryId = String(entry.entryId ?? entry.id ?? fallbackEntryId(status, source, timestamp, line))

  return {
    id: entryId,
    entryId,
    line,
    source,
    status,
    ...(timestamp ? { timestamp } : {}),
    ...(fingerprint ? { fingerprint } : {}),
    audience,
    kind: String(entry.kind ?? (audience === 'ai' ? 'text' : 'milestone')),
    ...(entry.modelId ? { modelId: String(entry.modelId) } : {}),
    ...(entry.sessionId ? { sessionId: String(entry.sessionId) } : {}),
    ...(entry.beadId ? { beadId: String(entry.beadId) } : {}),
    streaming: Boolean(entry.streaming),
    op: entry.op === 'upsert' || entry.op === 'finalize' ? entry.op : 'append',
  }
}

export function compareTimestamps(a?: string, b?: string): number {
  const at = a ? Date.parse(a) : Number.NaN
  const bt = b ? Date.parse(b) : Number.NaN
  if (Number.isNaN(at) && Number.isNaN(bt)) return 0
  if (Number.isNaN(at)) return 1
  if (Number.isNaN(bt)) return -1
  return at - bt
}

function timestampDistanceMs(a?: string, b?: string): number | null {
  const at = a ? Date.parse(a) : Number.NaN
  const bt = b ? Date.parse(b) : Number.NaN
  if (Number.isNaN(at) || Number.isNaN(bt)) return null
  return Math.abs(at - bt)
}

export function isCommandLine(line: string): boolean {
  return line.startsWith('[CMD] $ ')
}

export function isLowValueGitProbeLine(line: string): boolean {
  return isCommandLine(line)
    && line.includes('$ git ')
    && LOW_VALUE_GIT_PROBE_PATTERNS.some((pattern) => line.includes(pattern))
}

export function isBenignGitProbeErrorLine(line: string): boolean {
  if (!isLowValueGitProbeLine(line)) return false

  if (line.includes('origin/HEAD not set') || line.includes('ref not found')) {
    return true
  }

  if (line.includes(' diff --cached --quiet')) {
    return line.includes('staged changes present') || line.includes('error: exit code 1')
  }

  return false
}

export function mergeEntry(bucket: LogEntry[], entry: LogEntry): LogEntry[] {
  const existingIndex = bucket.findIndex(existing =>
    hasMatchingLogFingerprint(existing, entry) || existing.entryId === entry.entryId,
  )

  if (entry.op === 'append') {
    if (existingIndex >= 0) {
      const existing = bucket[existingIndex]!
      const isTextFallbackForStreamingEntry =
        existing.kind === 'text'
        && entry.kind === 'text'
        && existing.source === entry.source
        && existing.status === entry.status
        && existing.line === entry.line
        && existing.streaming

      if (isTextFallbackForStreamingEntry) {
        const next = [...bucket]
        next[existingIndex] = {
          ...existing,
          ...entry,
          // A terminal non-streaming fallback append should stop the UI stream state
          // even if a later finalize for the same canonical row still arrives.
          streaming: false,
        }
        return next
      }

      if (hasMatchingLogFingerprint(existing, entry)) {
        return bucket
      }
    }

    const duplicate = bucket.some(existing =>
      hasMatchingLogFingerprint(existing, entry)
      || (
        existing.line === entry.line
        && existing.source === entry.source
        && existing.status === entry.status
        && (
          existing.entryId === entry.entryId
          || compareTimestamps(existing.timestamp, entry.timestamp) === 0
          || (
            isLowValueGitProbeLine(existing.line)
            && isLowValueGitProbeLine(entry.line)
            && (timestampDistanceMs(existing.timestamp, entry.timestamp) ?? 0) <= 2000
          )
        )
      ))
    if (duplicate) return bucket
    return [...bucket, entry]
  }

  if (existingIndex === -1) return [...bucket, entry]

  const next = [...bucket]
  next[existingIndex] = {
    ...next[existingIndex],
    ...entry,
    streaming: entry.op === 'finalize' ? false : entry.streaming,
  }
  return next
}

export function persistLogs(ticketId: string | null | undefined, logsByPhase: Record<string, LogEntry[]>) {
  if (!ticketId || typeof window === 'undefined') return
  for (const [status, entries] of Object.entries(logsByPhase)) {
    try {
      localStorage.setItem(`${LOG_STORAGE_PREFIX}${ticketId}-${status}`, JSON.stringify(entries))
    } catch {
      // Ignore quota failures; in-memory state is still usable.
    }
  }
}

export function formatLogLine(data: Record<string, unknown>): { line: string; source: string } {
  const normalized = normalizeLogRecord(data, String(data.status ?? data.phase ?? 'unknown'))
  return { line: normalized.line, source: normalized.source }
}

export function clearPersistedTicketLogs(ticketId: string) {
  serverLogCache.delete(ticketId)

  if (typeof window === 'undefined') return

  const prefixes = [`${LOG_STORAGE_PREFIX}${ticketId}-`, `${LEGACY_LOG_STORAGE_PREFIX}${ticketId}-`]
  const keysToRemove: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && prefixes.some(prefix => key.startsWith(prefix))) {
      keysToRemove.push(key)
    }
  }
  keysToRemove.forEach(key => localStorage.removeItem(key))
}
