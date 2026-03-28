import type { Ticket } from '@/hooks/useTickets'
import { getStatusUserLabel } from '@/lib/workflowMeta'

export interface TicketErrorOccurrence {
  id: string
  occurrenceNumber: number
  blockedFromStatus: string
  errorMessage: string
  errorCodes: string[]
  occurredAt: string
  resolvedAt: string | null
  resolutionStatus: 'RETRIED' | 'CANCELED' | null
  resumedToStatus: string | null
}

type TicketErrorSource = Pick<
  Ticket,
  'id' | 'status' | 'previousStatus' | 'updatedAt' | 'errorOccurrences' | 'activeErrorOccurrenceId'
> & {
  errorMessage?: string | null | undefined
}

type TicketErrorOccurrenceInput = Partial<TicketErrorOccurrence> & {
  id?: string | number
}

function normalizeCodeList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function normalizeErrorOccurrence(
  occurrence: TicketErrorOccurrenceInput,
  fallbackNumber: number,
): TicketErrorOccurrence {
  const occurrenceNumber = typeof occurrence.occurrenceNumber === 'number' && occurrence.occurrenceNumber > 0
    ? occurrence.occurrenceNumber
    : fallbackNumber
  const fallbackId = `error-${fallbackNumber}`
  return {
    id: typeof occurrence.id === 'string'
      ? (occurrence.id.trim().length > 0 ? occurrence.id : fallbackId)
      : typeof occurrence.id === 'number'
        ? String(occurrence.id)
        : fallbackId,
    occurrenceNumber,
    blockedFromStatus: typeof occurrence.blockedFromStatus === 'string' && occurrence.blockedFromStatus.trim().length > 0
      ? occurrence.blockedFromStatus
      : 'BLOCKED_ERROR',
    errorMessage: typeof occurrence.errorMessage === 'string' ? occurrence.errorMessage : '',
    errorCodes: normalizeCodeList(occurrence.errorCodes),
    occurredAt: typeof occurrence.occurredAt === 'string' && occurrence.occurredAt.length > 0
      ? occurrence.occurredAt
      : new Date().toISOString(),
    resolvedAt: typeof occurrence.resolvedAt === 'string' && occurrence.resolvedAt.length > 0
      ? occurrence.resolvedAt
      : null,
    resolutionStatus: occurrence.resolutionStatus === 'RETRIED' || occurrence.resolutionStatus === 'CANCELED'
      ? occurrence.resolutionStatus
      : null,
    resumedToStatus: typeof occurrence.resumedToStatus === 'string' && occurrence.resumedToStatus.length > 0
      ? occurrence.resumedToStatus
      : null,
  }
}

function buildSyntheticCurrentOccurrence(ticket: TicketErrorSource): TicketErrorOccurrence {
  const parsedUpdatedAt = Date.parse(ticket.updatedAt)
  const syntheticId = Number.isFinite(parsedUpdatedAt) ? `synthetic-${parsedUpdatedAt}` : 'synthetic-current'

  return {
    id: syntheticId,
    occurrenceNumber: 1,
    blockedFromStatus: ticket.previousStatus && ticket.previousStatus !== 'BLOCKED_ERROR'
      ? ticket.previousStatus
      : 'BLOCKED_ERROR',
    errorMessage: ticket.errorMessage ?? '',
    errorCodes: [],
    occurredAt: ticket.updatedAt,
    resolvedAt: null,
    resolutionStatus: null,
    resumedToStatus: null,
  }
}

export function getTicketErrorOccurrences(ticket: TicketErrorSource): TicketErrorOccurrence[] {
  const rawOccurrences = Array.isArray(ticket.errorOccurrences) ? ticket.errorOccurrences : []
  const normalized = rawOccurrences
    .map((occurrence, index) => normalizeErrorOccurrence(
      occurrence && typeof occurrence === 'object'
        ? occurrence as TicketErrorOccurrenceInput
        : { id: `error-${index + 1}` },
      index + 1,
    ))
    .sort((left, right) => {
      const leftTime = Date.parse(left.occurredAt)
      const rightTime = Date.parse(right.occurredAt)
      if (Number.isNaN(leftTime) && Number.isNaN(rightTime)) return left.occurrenceNumber - right.occurrenceNumber
      if (Number.isNaN(leftTime)) return 1
      if (Number.isNaN(rightTime)) return -1
      if (leftTime !== rightTime) return leftTime - rightTime
      return left.occurrenceNumber - right.occurrenceNumber
    })

  if (normalized.length > 0) return normalized
  if (ticket.status !== 'BLOCKED_ERROR') return []
  return [buildSyntheticCurrentOccurrence(ticket)]
}

export function getActiveErrorOccurrence(ticket: TicketErrorSource): TicketErrorOccurrence | null {
  const occurrences = getTicketErrorOccurrences(ticket)
  if (occurrences.length === 0) return null

  if (ticket.activeErrorOccurrenceId != null) {
    const activeOccurrenceId = String(ticket.activeErrorOccurrenceId)
    const matched = occurrences.find((occurrence) => occurrence.id === activeOccurrenceId)
    if (matched) return matched
  }

  if (ticket.status !== 'BLOCKED_ERROR') return null

  const openOccurrence = [...occurrences].reverse().find((occurrence) => occurrence.resolvedAt === null)
  return openOccurrence ?? occurrences.at(-1) ?? null
}

export function formatErrorOccurrenceLabel(occurrence: TicketErrorOccurrence, fallbackIndex: number): string {
  const occurrenceLabel = Number.isInteger(occurrence.occurrenceNumber) && occurrence.occurrenceNumber > 0
    ? occurrence.occurrenceNumber
    : fallbackIndex
  const phaseLabel = getStatusUserLabel(occurrence.blockedFromStatus)
  return `Error ${occurrenceLabel} — ${phaseLabel}`
}

export function formatErrorOccurrenceStatus(occurrence: TicketErrorOccurrence): string {
  if (occurrence.resolutionStatus === 'RETRIED') {
    return occurrence.resumedToStatus ? `Retried to ${getStatusUserLabel(occurrence.resumedToStatus)}` : 'Retried'
  }
  if (occurrence.resolutionStatus === 'CANCELED') return 'Canceled'
  if (occurrence.resolvedAt) return 'Resolved'
  return 'Active error'
}
