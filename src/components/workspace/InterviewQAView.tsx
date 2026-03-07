import { useState, useRef, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  useInterviewBatch,
  useSubmitBatch,
  useSubmitAnswers,
  useSkipInterview,
  useSaveTicketUIState,
  useTicketUIState,
} from '@/hooks/useTickets'
import type { Ticket, BatchQuestion, BatchData } from '@/hooks/useTickets'

interface InterviewQAViewProps {
  ticket: Ticket
}

type ViewState = 'loading' | 'batch' | 'processing' | 'complete'

function priorityBadgeVariant(priority: string): 'destructive' | 'default' | 'secondary' | 'outline' {
  switch (priority) {
    case 'critical': return 'destructive'
    case 'high': return 'default'
    case 'medium': return 'secondary'
    default: return 'outline'
  }
}

export function InterviewQAView({ ticket }: InterviewQAViewProps) {
  const { data: batchResponse, isLoading: isBatchLoading } = useInterviewBatch(ticket.id)
  const { mutateAsync: submitBatchMutation, isPending: isSubmitting } = useSubmitBatch()
  const { mutate: submitAllAnswers, isPending: isSubmittingAll } = useSubmitAnswers()
  const { mutate: skipInterview, isPending: isSkipping } = useSkipInterview()
  const { mutate: saveUiState } = useSaveTicketUIState()
  const { data: persistedUiState } = useTicketUIState<{
    answers?: Record<string, string>
    allAnswers?: Record<string, string>
  }>(ticket.id, 'interview_qa', true)

  const [viewState, setViewState] = useState<ViewState>('loading')
  const [currentBatch, setCurrentBatch] = useState<BatchData | null>(null)
  const [batchAnswers, setBatchAnswers] = useState<Record<string, string>>({})
  const [allAnswers, setAllAnswers] = useState<Record<string, string>>({})
  const [showHistory, setShowHistory] = useState(false)
  const [sseFirstBatch, setSseFirstBatch] = useState<BatchData | null>(null)
  const lastSavedRef = useRef('')
  const hydratedRef = useRef(false)

  // Hydrate from persisted state
  useEffect(() => {
    if (hydratedRef.current) return
    const saved = persistedUiState?.data
    if (saved?.allAnswers && typeof saved.allAnswers === 'object') {
      setAllAnswers(saved.allAnswers)
    }
    hydratedRef.current = true
  }, [persistedUiState])

  // Listen for SSE interview_batch events
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'interview_batch' && String(data.ticketId) === String(ticket.id)) {
          setSseFirstBatch(data.batch)
        }
      } catch { /* ignore */ }
    }

    // Listen on the EventSource if available
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [ticket.id])

  // Resolve current batch from SSE push or HTTP fetch
  useEffect(() => {
    if (sseFirstBatch) {
      setCurrentBatch(sseFirstBatch)
      setBatchAnswers({})
      setViewState('batch')
      setSseFirstBatch(null)
      return
    }
    if (isBatchLoading) {
      setViewState('loading')
      return
    }
    if (batchResponse?.batch && !currentBatch) {
      setCurrentBatch(batchResponse.batch)
      setBatchAnswers({})
      setViewState(batchResponse.batch.isComplete ? 'complete' : 'batch')
    }
  }, [sseFirstBatch, isBatchLoading, batchResponse, currentBatch])

  // Debounced UI state save
  useEffect(() => {
    const snapshot = JSON.stringify({ allAnswers })
    if (snapshot === lastSavedRef.current) return
    const timer = window.setTimeout(() => {
      lastSavedRef.current = snapshot
      saveUiState({ ticketId: ticket.id, scope: 'interview_qa', data: { allAnswers } })
    }, 500)
    return () => window.clearTimeout(timer)
  }, [allAnswers, saveUiState, ticket.id])

  const handleBatchAnswer = useCallback((questionId: string, value: string) => {
    setBatchAnswers(prev => ({ ...prev, [questionId]: value }))
  }, [])

  const handleSubmitBatch = useCallback(async () => {
    if (!currentBatch) return
    setViewState('processing')

    // Merge batch answers into all answers
    const merged = { ...allAnswers, ...batchAnswers }
    setAllAnswers(merged)

    try {
      const result = await submitBatchMutation({
        ticketId: ticket.id,
        answers: batchAnswers,
      })

      if (result.isComplete) {
        setCurrentBatch(null)
        setViewState('complete')
      } else {
        setCurrentBatch(result)
        setBatchAnswers({})
        setViewState('batch')
      }
    } catch (err) {
      console.error('Failed to submit batch:', err)
      setViewState('batch')
    }
  }, [currentBatch, batchAnswers, allAnswers, submitBatchMutation, ticket.id])

  const handleSkipAll = useCallback(() => {
    skipInterview({ ticketId: ticket.id, answers: allAnswers })
  }, [skipInterview, ticket.id, allAnswers])

  const handleSubmitAll = useCallback(() => {
    submitAllAnswers({ ticketId: ticket.id, answers: allAnswers })
  }, [submitAllAnswers, ticket.id, allAnswers])

  const isBusy = isSubmitting || isSubmittingAll || isSkipping

  // ─── Loading State ───
  if (viewState === 'loading') {
    return (
      <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
        <div className="text-center space-y-2">
          <div className="animate-pulse">Starting AI interview session…</div>
          <p className="text-[10px]">The winning AI model is preparing questions.</p>
        </div>
      </div>
    )
  }

  // ─── Complete State ───
  if (viewState === 'complete') {
    return (
      <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
        <Card className="max-w-sm">
          <CardContent className="py-6 text-center space-y-2">
            <p className="text-sm font-medium text-foreground">Interview Complete</p>
            <p className="text-xs">The AI has finalized the interview results. Moving to coverage verification…</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  // ─── Processing State ───
  if (viewState === 'processing') {
    return (
      <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
        <div className="text-center space-y-2">
          <div className="animate-pulse">AI is analyzing your answers…</div>
          <p className="text-[10px]">Preparing the next batch of questions.</p>
        </div>
      </div>
    )
  }

  // ─── Batch Display State ───
  const questions: BatchQuestion[] = currentBatch?.questions ?? []
  const progress = currentBatch?.progress ?? { current: 0, total: 0 }
  const aiCommentary = currentBatch?.aiCommentary ?? ''
  const isFinalFreeForm = currentBatch?.isFinalFreeForm ?? false
  const batchNum = currentBatch?.batchNumber ?? 0
  const allBatchAnswersFilled = questions.every(q => batchAnswers[q.id]?.trim())

  const historyEntries = Object.entries(allAnswers)

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
        {/* Previous Q&A history — collapsible */}
        {historyEntries.length > 0 && (
          <div>
            <button
              onClick={() => setShowHistory(h => !h)}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mb-2"
            >
              {showHistory ? '▼' : '▶'} Previous Answers ({historyEntries.length})
            </button>
            {showHistory && (
              <div className="space-y-1 mb-3 max-h-[200px] overflow-y-auto rounded border border-border/50 p-2 bg-muted/20">
                {historyEntries.map(([id, answer]) => (
                  <div key={id} className="text-xs p-1 border-b border-border/30 last:border-0">
                    <span className="font-medium text-muted-foreground">{id}:</span>{' '}
                    <span>{answer.trim() || <span className="italic text-muted-foreground">Skipped</span>}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* AI Commentary */}
        {aiCommentary && (
          <div className="rounded-lg border border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/30 p-3">
            <p className="text-xs text-blue-700 dark:text-blue-300">{aiCommentary}</p>
          </div>
        )}

        {/* Current batch card */}
        <Card>
          <CardHeader className="py-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">
                {isFinalFreeForm ? 'Final Question' : `Interview Q&A — Batch ${batchNum}`}
              </CardTitle>
              <div className="flex items-center gap-2">
                {progress.total > 0 && (
                  <Badge variant="outline" className="text-xs">
                    Q {progress.current}/{progress.total}
                  </Badge>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 pb-3">
            {questions.map((q) => (
              <div key={q.id} className="rounded-lg border border-border p-3 bg-accent/30 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground font-mono">{q.id}</span>
                  {q.phase && (
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                      {q.phase}
                    </span>
                  )}
                  {q.priority && (
                    <Badge variant={priorityBadgeVariant(q.priority)} className="text-[10px] h-4">
                      {q.priority}
                    </Badge>
                  )}
                </div>
                <p className="text-xs font-medium">{q.question}</p>
                {q.rationale && (
                  <p className="text-[10px] text-muted-foreground italic">{q.rationale}</p>
                )}
                <textarea
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs min-h-[60px] focus:outline-none focus:ring-1 focus:ring-ring"
                  placeholder="Type your answer here…"
                  value={batchAnswers[q.id] ?? ''}
                  onChange={e => handleBatchAnswer(q.id, e.target.value)}
                  disabled={isBusy}
                />
              </div>
            ))}

            {/* Action buttons */}
            <div className="flex flex-wrap gap-2 justify-between pt-1">
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSkipAll}
                  disabled={isBusy}
                  className="h-7 text-xs text-muted-foreground"
                >
                  {isSkipping ? 'Skipping…' : 'Skip All'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSubmitAll}
                  disabled={isBusy}
                  className="h-7 text-xs text-muted-foreground"
                >
                  {isSubmittingAll ? 'Submitting…' : 'Submit All Remaining'}
                </Button>
              </div>
              <Button
                size="sm"
                onClick={handleSubmitBatch}
                disabled={isBusy || questions.length === 0}
                className="h-7 text-xs"
              >
                {isSubmitting
                  ? 'Submitting…'
                  : allBatchAnswersFilled
                    ? 'Submit Answers'
                    : 'Submit (with skips)'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Progress bar */}
      {progress.total > 0 && (
        <div className="shrink-0 px-4 pb-1">
          <div className="h-1 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${(progress.current / progress.total) * 100}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
