import { useCallback, useState, useEffect, useRef } from 'react'
import { useSubmitBatch, useSkipInterview, useTicketUIState, useSaveTicketUIState } from '@/hooks/useTickets'
import type { PersistedInterviewBatch } from '@shared/interviewSession'

const INTERVIEW_DRAFTS_SCOPE = 'interview-drafts'
const DRAFT_SAVE_DEBOUNCE_MS = 350

export interface PersistedInterviewDrafts {
  draftAnswers: Record<string, Record<string, string>>
  skippedQuestions: Record<string, string[]>
}

function serializeSkipped(map: Record<string, Set<string>>): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  for (const [key, set] of Object.entries(map)) {
    result[key] = [...set]
  }
  return result
}

function deserializeSkipped(map: Record<string, string[]>): Record<string, Set<string>> {
  const result: Record<string, Set<string>> = {}
  for (const [key, arr] of Object.entries(map)) {
    result[key] = new Set(arr)
  }
  return result
}

export function getBatchKey(batch: PersistedInterviewBatch | null | undefined) {
  if (!batch) return null
  return [batch.source, batch.roundNumber ?? 0, batch.batchNumber].join(':')
}

export function useBatchSubmit(ticketId: string) {
  const { mutateAsync: submitBatchMutation, isPending: isSubmitting } = useSubmitBatch()
  const { mutateAsync: skipInterviewMutation, isPending: isSkipping } = useSkipInterview()
  const { data: persistedDrafts } = useTicketUIState<PersistedInterviewDrafts>(ticketId, INTERVIEW_DRAFTS_SCOPE)
  const { mutate: saveUiState } = useSaveTicketUIState()

  const [draftAnswers, setDraftAnswers] = useState<Record<string, Record<string, string>>>({})
  const [skippedQuestions, setSkippedQuestions] = useState<Record<string, Set<string>>>({})
  const [submittedBatchKey, setSubmittedBatchKey] = useState<string | null>(null)
  const [sseBatch, setSseBatch] = useState<PersistedInterviewBatch | null>(null)
  const [processingError, setProcessingError] = useState<string | null>(null)

  const restoredDraftRef = useRef(false)
  const lastSavedSnapshotRef = useRef('')

  useEffect(() => {
    restoredDraftRef.current = false
    lastSavedSnapshotRef.current = ''
  }, [ticketId])

  // Restore persisted drafts once on mount / ticket change
  useEffect(() => {
    if (restoredDraftRef.current || !persistedDrafts) return

    const persisted = persistedDrafts.data
    const frame = requestAnimationFrame(() => {
      if (persisted) {
        if (persisted.draftAnswers && Object.keys(persisted.draftAnswers).length > 0) {
          setDraftAnswers(persisted.draftAnswers)
        }
        if (persisted.skippedQuestions && Object.keys(persisted.skippedQuestions).length > 0) {
          setSkippedQuestions(deserializeSkipped(persisted.skippedQuestions))
        }
      }

      const snapshot: PersistedInterviewDrafts = {
        draftAnswers: persisted?.draftAnswers ?? {},
        skippedQuestions: persisted?.skippedQuestions ?? {},
      }
      lastSavedSnapshotRef.current = JSON.stringify(snapshot)
      restoredDraftRef.current = true
    })
    return () => cancelAnimationFrame(frame)
  }, [persistedDrafts])

  // SSE handler
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as { type?: string; ticketId?: string; batch?: PersistedInterviewBatch; error?: string }
        if (String(data.ticketId) !== String(ticketId)) return
        if (data.type === 'interview_batch' && data.batch) {
          setSseBatch(data.batch)
          setSubmittedBatchKey(null)
          setProcessingError(null)
        }
        if (data.type === 'interview_error') {
          setProcessingError(data.error ?? 'Failed to process interview batch')
        }
      } catch {
        // Ignore malformed messages.
      }
    }

    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [ticketId])

  // Auto-save drafts with debounce
  useEffect(() => {
    if (!restoredDraftRef.current) return

    const snapshot: PersistedInterviewDrafts = {
      draftAnswers,
      skippedQuestions: serializeSkipped(skippedQuestions),
    }
    const serialized = JSON.stringify(snapshot)
    if (serialized === lastSavedSnapshotRef.current) return

    const timer = window.setTimeout(() => {
      lastSavedSnapshotRef.current = serialized
      saveUiState({
        ticketId,
        scope: INTERVIEW_DRAFTS_SCOPE,
        data: snapshot,
      })
    }, DRAFT_SAVE_DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [draftAnswers, skippedQuestions, saveUiState, ticketId])

  const handleBatchAnswer = useCallback((currentBatchKey: string | null, questionId: string, value: string) => {
    if (!currentBatchKey) return
    setDraftAnswers((current) => ({
      ...current,
      [currentBatchKey]: {
        ...(current[currentBatchKey] ?? {}),
        [questionId]: value,
      },
    }))
    if (value.trim()) {
      setSkippedQuestions((current) => {
        const prev = current[currentBatchKey]
        if (!prev?.has(questionId)) return current
        const next = new Set(prev)
        next.delete(questionId)
        return { ...current, [currentBatchKey]: next }
      })
    }
  }, [])

  const handleSkipQuestion = useCallback((currentBatchKey: string | null, questionId: string) => {
    if (!currentBatchKey) return
    setDraftAnswers((current) => ({
      ...current,
      [currentBatchKey]: {
        ...(current[currentBatchKey] ?? {}),
        [questionId]: '',
      },
    }))
    setSkippedQuestions((current) => {
      const prev = current[currentBatchKey] ?? new Set<string>()
      const next = new Set(prev)
      next.add(questionId)
      return { ...current, [currentBatchKey]: next }
    })
  }, [])

  const handleUnskipQuestion = useCallback((currentBatchKey: string | null, questionId: string) => {
    if (!currentBatchKey) return
    setSkippedQuestions((current) => {
      const prev = current[currentBatchKey]
      if (!prev?.has(questionId)) return current
      const next = new Set(prev)
      next.delete(questionId)
      return { ...current, [currentBatchKey]: next }
    })
  }, [])

  const handleSubmitBatch = useCallback(async (
    currentBatch: PersistedInterviewBatch | null,
    currentBatchKey: string | null,
    batchAnswers: Record<string, string>,
  ) => {
    if (!currentBatch || !currentBatchKey) return

    try {
      await submitBatchMutation({
        ticketId,
        answers: batchAnswers,
      })
      setDraftAnswers((current) => {
        if (!(currentBatchKey in current)) return current
        const next = { ...current }
        delete next[currentBatchKey]
        return next
      })
      setSkippedQuestions((current) => {
        if (!(currentBatchKey in current)) return current
        const next = { ...current }
        delete next[currentBatchKey]
        return next
      })
      setSubmittedBatchKey(currentBatchKey)
      setSseBatch(null)
    } catch (err) {
      console.error('Failed to submit interview batch:', err)
    }
  }, [submitBatchMutation, ticketId])

  const handleConfirmSkipAll = useCallback(async (
    currentBatch: PersistedInterviewBatch | null,
    batchAnswers: Record<string, string>,
  ) => {
    if (!currentBatch) return

    try {
      await skipInterviewMutation({
        ticketId,
        answers: batchAnswers,
      })
      setDraftAnswers({})
      setSkippedQuestions({})
      const emptySnapshot: PersistedInterviewDrafts = { draftAnswers: {}, skippedQuestions: {} }
      lastSavedSnapshotRef.current = JSON.stringify(emptySnapshot)
      saveUiState({ ticketId, scope: INTERVIEW_DRAFTS_SCOPE, data: emptySnapshot })
      setSseBatch(null)
    } catch (err) {
      console.error('Failed to skip remaining interview questions:', err)
    }
  }, [skipInterviewMutation, saveUiState, ticketId])

  return {
    draftAnswers,
    skippedQuestions,
    sseBatch,
    processingError,
    submittedBatchKey,
    isSubmitting,
    isSkipping,
    setProcessingError,
    handleBatchAnswer,
    handleSkipQuestion,
    handleUnskipQuestion,
    handleSubmitBatch,
    handleConfirmSkipAll,
  }
}
