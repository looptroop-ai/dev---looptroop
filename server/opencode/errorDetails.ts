export interface ModelErrorInfo {
  name?: string
  message?: string
  statusCode?: number
  url?: string
  isRetryable?: boolean
  requestModel?: string
  responseErrorType?: string
  responseErrorTitle?: string
  responseErrorMessage?: string
  responseBodyPreview?: string
}

export interface ModelErrorSummary {
  message: string
  details?: ModelErrorInfo
}

const MAX_ERROR_PREVIEW_LENGTH = 280

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value) return undefined
  if (value instanceof Error) {
    const record: Record<string, unknown> = {
      name: value.name,
      message: value.message,
    }
    for (const key of Object.getOwnPropertyNames(value)) {
      record[key] = (value as Error & Record<string, unknown>)[key]
    }
    return record
  }
  if (typeof value === 'object') {
    return value as Record<string, unknown>
  }
  return undefined
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function getNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function getBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function trimQuotes(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2) {
    const first = trimmed[0]
    const last = trimmed[trimmed.length - 1]
    if ((first === '"' && last === '"') || (first === '\'' && last === '\'')) {
      return trimmed.slice(1, -1).trim()
    }
  }
  return trimmed
}

function cleanMessage(value: string | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = trimQuotes(value)
  return trimmed.length > 0 ? trimmed : undefined
}

function truncate(value: string | undefined, maxLength = MAX_ERROR_PREVIEW_LENGTH): string | undefined {
  const cleaned = cleanMessage(value)
  if (!cleaned) return undefined
  if (cleaned.length <= maxLength) return cleaned
  return `${cleaned.slice(0, maxLength - 3)}...`
}

function parseJsonRecord(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value)
    return toRecord(parsed)
  } catch {
    return undefined
  }
}

function unwrapErrorRecord(error: unknown): Record<string, unknown> | undefined {
  const outer = toRecord(error)
  if (!outer) return undefined

  const inner = toRecord(outer.error)
  if (!inner) return outer

  return {
    ...outer,
    ...inner,
  }
}

export function extractModelErrorInfo(error: unknown): ModelErrorInfo | undefined {
  const record = unwrapErrorRecord(error)
  const fallbackMessage = typeof error === 'string'
    ? cleanMessage(error)
    : error instanceof Error
      ? cleanMessage(error.message)
      : undefined

  const data = toRecord(record?.data)
  const dataError = toRecord(data?.error)
  const responseBody = truncate(getString(record?.responseBody))
  const responseBodyRecord = parseJsonRecord(getString(record?.responseBody))
  const responseBodyError = toRecord(responseBodyRecord?.error)

  const info: ModelErrorInfo = {
    name: cleanMessage(getString(record?.name)),
    message: cleanMessage(
      getString(record?.message)
      ?? getString(dataError?.message)
      ?? fallbackMessage,
    ),
    statusCode: getNumber(record?.statusCode),
    url: getString(record?.url),
    isRetryable: getBoolean(record?.isRetryable),
    requestModel: cleanMessage(
      getString(record?.requestModel)
      ?? getString(toRecord(record?.requestBodyValues)?.model),
    ),
    responseErrorType: cleanMessage(
      getString(record?.responseErrorType)
      ?? getString(dataError?.type)
      ?? getString(responseBodyError?.type)
      ?? getString(responseBodyRecord?.type),
    ),
    responseErrorTitle: cleanMessage(
      getString(record?.responseErrorTitle)
      ?? getString(dataError?.title)
      ?? getString(responseBodyError?.title)
      ?? getString(responseBodyRecord?.title),
    ),
    responseErrorMessage: cleanMessage(
      getString(record?.responseErrorMessage)
      ?? getString(dataError?.message)
      ?? getString(responseBodyError?.message)
      ?? getString(responseBodyRecord?.message),
    ),
    responseBodyPreview: truncate(getString(record?.responseBodyPreview)) ?? responseBody,
  }

  return Object.values(info).some((value) => value !== undefined) ? info : undefined
}

export function hasRichModelErrorInfo(info: ModelErrorInfo | undefined): boolean {
  if (!info) return false
  return [
    info.statusCode,
    info.url,
    info.requestModel,
    info.responseErrorType,
    info.responseErrorTitle,
    info.responseErrorMessage,
    info.responseBodyPreview,
  ].some((value) => value !== undefined)
}

export function summarizeModelErrorForLog(error: unknown, fallbackMessage?: string): ModelErrorSummary {
  const details = extractModelErrorInfo(error)
  const baseMessage = details?.responseErrorTitle && details.responseErrorMessage
    ? `${details.responseErrorTitle}: ${details.responseErrorMessage}`
    : details?.responseErrorType && details.responseErrorMessage
      ? `${details.responseErrorType}: ${details.responseErrorMessage}`
      : details?.responseErrorMessage
        ?? details?.message
        ?? cleanMessage(fallbackMessage)
        ?? 'Model error'

  const metaParts: string[] = []
  if (details?.statusCode !== undefined) {
    metaParts.push(`HTTP ${details.statusCode}`)
  }
  if (details?.requestModel) {
    metaParts.push(`requestModel=${details.requestModel}`)
  }

  return {
    message: metaParts.length > 0 ? `${baseMessage} (${metaParts.join(', ')})` : baseMessage,
    ...(details ? { details } : {}),
  }
}
