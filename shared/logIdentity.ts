export interface FingerprintedLogLike {
  fingerprint?: string | null
  data?: unknown
}

export interface LogIdentityLike extends FingerprintedLogLike {
  entryId?: string | null
}

function normalizeNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined
}

export function extractLogFingerprint(record: FingerprintedLogLike): string | undefined {
  const direct = normalizeNonEmptyString(record.fingerprint)
  if (direct) return direct

  if (!record.data || typeof record.data !== 'object') return undefined
  return normalizeNonEmptyString((record.data as Record<string, unknown>).fingerprint)
}

export function hasMatchingLogFingerprint(a: FingerprintedLogLike, b: FingerprintedLogLike): boolean {
  const left = extractLogFingerprint(a)
  const right = extractLogFingerprint(b)
  return left !== undefined && left === right
}

export type OpenCodeQuestionLogAction =
  | 'asked'
  | 'replied'
  | 'rejected'
  | 'reply_failed'
  | 'reject_failed'

export function buildOpenCodeQuestionLogIdentity(input: {
  sessionId?: string
  requestId: string
  action: OpenCodeQuestionLogAction
}): { entryId: string; fingerprint: string } {
  const scope = input.sessionId ?? 'no-session'
  const prefix = input.sessionId
    ? `${input.sessionId}:question:${input.requestId}`
    : `opencode-question:${input.requestId}`

  return {
    entryId: `${prefix}:${input.action}`,
    fingerprint: `opencode-question:${scope}:${input.requestId}:${input.action}`,
  }
}
