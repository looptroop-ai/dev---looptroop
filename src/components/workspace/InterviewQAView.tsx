import { useMemo, useRef, useState, useEffect, useCallback } from 'react'
import type { Ticket } from '@/hooks/useTickets'
import { useInterviewQuestions, useSkipInterview, useSubmitBatch } from '@/hooks/useTickets'
import type {
  InterviewQuestionStatus,
  InterviewQuestionView,
  PersistedInterviewBatch,
} from '@shared/interviewSession'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { LoadingText } from '@/components/ui/LoadingText'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface InterviewQAViewProps {
  ticket: Ticket
}

const INTERVIEW_FOCUS_EVENT = 'looptroop:interview-focus'

function getBatchKey(batch: PersistedInterviewBatch | null | undefined) {
  if (!batch) return null
  return [batch.source, batch.roundNumber ?? 0, batch.batchNumber].join(':')
}

function priorityBadgeVariant(priority: string): 'destructive' | 'default' | 'secondary' | 'outline' {
  switch (priority) {
    case 'critical': return 'destructive'
    case 'high': return 'default'
    case 'medium': return 'secondary'
    default: return 'outline'
  }
}

function statusBadgeVariant(status: InterviewQuestionStatus): 'default' | 'secondary' | 'outline' {
  switch (status) {
    case 'answered': return 'default'
    case 'skipped': return 'secondary'
    case 'current': return 'outline'
    default: return 'outline'
  }
}

function groupHistory(questions: InterviewQuestionView[]) {
  const groups = new Map<string, InterviewQuestionView[]>()
  for (const question of questions) {
    if (question.status !== 'answered' && question.status !== 'skipped') continue
    const key = question.source === 'coverage_follow_up'
      ? `Coverage Follow-ups${question.roundNumber ? ` · Round ${question.roundNumber}` : ''}`
      : question.source === 'prompt_follow_up'
        ? `PROM4 Follow-ups${question.roundNumber ? ` · Round ${question.roundNumber}` : ''}`
        : question.source === 'final_free_form'
          ? 'Final Free-Form'
          : question.phase
    const bucket = groups.get(key) ?? []
    bucket.push(question)
    groups.set(key, bucket)
  }
  return Array.from(groups.entries())
}

export function InterviewQAView({ ticket }: InterviewQAViewProps) {
  const { data: interviewData, isLoading } = useInterviewQuestions(ticket.id)
  const { mutateAsync: submitBatchMutation, isPending: isSubmitting } = useSubmitBatch()
  const { mutateAsync: skipInterviewMutation, isPending: isSkipping } = useSkipInterview()
  const [draftAnswers, setDraftAnswers] = useState<Record<string, Record<string, string>>>({})
  const [showHistory, setShowHistory] = useState(true)
  const [showSkipConfirm, setShowSkipConfirm] = useState(false)
  const [sseBatch, setSseBatch] = useState<PersistedInterviewBatch | null>(null)
  const [processingError, setProcessingError] = useState<string | null>(null)
  const questionRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const session = interviewData?.session ?? null
  const currentBatch = (() => {
    if (session?.completedAt && !session.currentBatch) return null
    if (!sseBatch) return session?.currentBatch ?? null
    if (!session?.currentBatch) return sseBatch

    return getBatchKey(sseBatch) === getBatchKey(session.currentBatch)
      ? session.currentBatch
      : sseBatch
  })()
  const currentBatchKey = getBatchKey(currentBatch)
  const batchAnswers = useMemo(
    () => (currentBatchKey ? draftAnswers[currentBatchKey] ?? {} : {}),
    [currentBatchKey, draftAnswers],
  )
  const questionViews = useMemo(
    () => interviewData?.questions ?? [],
    [interviewData?.questions],
  )
  const historyGroups = useMemo(() => groupHistory(questionViews), [questionViews])

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as { type?: string; ticketId?: string; batch?: PersistedInterviewBatch; error?: string }
        if (String(data.ticketId) !== String(ticket.id)) return
        if (data.type === 'interview_batch' && data.batch) {
          setSseBatch(data.batch)
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
  }, [ticket.id])

  const focusQuestion = useCallback((questionId: string) => {
    const element = questionRefs.current[questionId]
    if (!element) return
    element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const textarea = element.querySelector('textarea')
    if (textarea instanceof HTMLTextAreaElement) {
      textarea.focus()
    }
  }, [])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ ticketId?: string; questionId?: string }>).detail
      if (!detail?.questionId || String(detail.ticketId) !== String(ticket.id)) return
      setShowHistory(true)
      window.requestAnimationFrame(() => focusQuestion(detail.questionId!))
    }

    window.addEventListener(INTERVIEW_FOCUS_EVENT, handler as EventListener)
    return () => window.removeEventListener(INTERVIEW_FOCUS_EVENT, handler as EventListener)
  }, [focusQuestion, ticket.id])

  const handleBatchAnswer = useCallback((questionId: string, value: string) => {
    if (!currentBatchKey) return
    setDraftAnswers((current) => ({
      ...current,
      [currentBatchKey]: {
        ...(current[currentBatchKey] ?? {}),
        [questionId]: value,
      },
    }))
  }, [currentBatchKey])

  const handleSubmitBatch = useCallback(async () => {
    if (!currentBatch || !currentBatchKey) return

    try {
      await submitBatchMutation({
        ticketId: ticket.id,
        answers: batchAnswers,
      })
      setDraftAnswers((current) => {
        if (!(currentBatchKey in current)) return current
        const next = { ...current }
        delete next[currentBatchKey]
        return next
      })
      setSseBatch(null)
    } catch (err) {
      console.error('Failed to submit interview batch:', err)
    }
  }, [batchAnswers, currentBatch, currentBatchKey, submitBatchMutation, ticket.id])

  const handleConfirmSkipAll = useCallback(async () => {
    if (!currentBatch) return

    try {
      await skipInterviewMutation({
        ticketId: ticket.id,
        answers: batchAnswers,
      })
      setShowSkipConfirm(false)
      setSseBatch(null)
    } catch (err) {
      console.error('Failed to skip remaining interview questions:', err)
    }
  }, [batchAnswers, currentBatch, skipInterviewMutation, ticket.id])

  if (isLoading && !currentBatch) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
        <div className="text-center space-y-2">
          <LoadingText text="Starting AI interview session" className="text-sm font-medium animate-pulse" />
          <p className="text-[10px]">The winning AI model is preparing questions.</p>
        </div>
      </div>
    )
  }

  if (isSubmitting && !currentBatch) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
        <div className="text-center space-y-2">
          <LoadingText text="AI is analyzing your answers" className="text-sm font-medium animate-pulse" />
          <p className="text-[10px]">Preparing the next interview step.</p>
        </div>
      </div>
    )
  }

  if (session?.completedAt && !currentBatch) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
        <Card className="max-w-sm">
          <CardContent className="py-6 text-center space-y-2">
            <p className="text-sm font-medium text-foreground">Interview Complete</p>
            <p className="text-xs">The normalized interview artifact is ready. Moving to coverage verification…</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (processingError && !currentBatch) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
        <Card className="max-w-sm border-destructive/40">
          <CardContent className="py-6 text-center space-y-3">
            <p className="text-sm font-medium text-destructive">Processing Error</p>
            <p className="text-xs text-muted-foreground">{processingError}</p>
            <p className="text-[10px] text-muted-foreground">
              The batch has been restored — you can re-submit your answers.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => setProcessingError(null)}
            >
              Dismiss
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!currentBatch) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
        <div className="text-center space-y-2">
          <LoadingText text="Preparing interview batch" className="text-sm font-medium animate-pulse" />
          <p className="text-[10px]">Waiting for the next interview questions.</p>
        </div>
      </div>
    )
  }

  const questions = currentBatch.questions
  const allBatchAnswersFilled = questions.every((question) => batchAnswers[question.id]?.trim())
  const isBusy = isSubmitting || isSkipping

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <Dialog open={showSkipConfirm} onOpenChange={setShowSkipConfirm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Skip Remaining Interview Questions</DialogTitle>
            <DialogDescription>
              This keeps the answers you already submitted, preserves anything currently typed in this batch,
              marks every other unanswered interview question as skipped, and moves the ticket to Interview Approval.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowSkipConfirm(false)} disabled={isBusy}>
              Keep Interview
            </Button>
            <Button variant="destructive" size="sm" onClick={handleConfirmSkipAll} disabled={isBusy}>
              {isSkipping ? <LoadingText text="Skipping" /> : 'Skip to Approval'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {historyGroups.length > 0 && (
          <div className="rounded-lg border border-border/70 bg-muted/10 p-3">
            <button
              onClick={() => setShowHistory((value) => !value)}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              {showHistory ? '▼' : '▶'} Interview History ({historyGroups.reduce((sum, [, items]) => sum + items.length, 0)})
            </button>
            {showHistory && (
              <div className="mt-3 space-y-4">
                {historyGroups.map(([label, items]) => (
                  <div key={label} className="space-y-2">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
                    {items.map((question) => (
                      <div
                        key={question.id}
                        ref={(node) => { questionRefs.current[question.id] = node }}
                        className="rounded-lg border border-border bg-background p-3 space-y-2"
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] text-muted-foreground font-mono">{question.id}</span>
                          <Badge variant={statusBadgeVariant(question.status)} className="text-[10px] h-4">
                            {question.status}
                          </Badge>
                          {question.priority && (
                            <Badge variant={priorityBadgeVariant(question.priority)} className="text-[10px] h-4">
                              {question.priority}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs font-medium">{question.question}</p>
                        {question.rationale && (
                          <p className="text-[10px] text-muted-foreground italic">{question.rationale}</p>
                        )}
                        {question.status === 'skipped'
                          ? <p className="text-[11px] italic text-muted-foreground">Skipped</p>
                          : <p className="text-xs whitespace-pre-wrap text-foreground/90">{question.answer}</p>}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {currentBatch.aiCommentary && (
          <div className="rounded-lg border border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/30 p-3">
            <p className="text-xs text-blue-700 dark:text-blue-300">{currentBatch.aiCommentary}</p>
          </div>
        )}

        <Card>
          <CardHeader className="py-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-sm">
                {currentBatch.source === 'coverage'
                  ? `Coverage Follow-up${currentBatch.roundNumber ? ` · Round ${currentBatch.roundNumber}` : ''}`
                  : currentBatch.isFinalFreeForm
                    ? 'Final Question'
                    : `Interview Q&A — Batch ${currentBatch.batchNumber}`}
              </CardTitle>
              {currentBatch.progress.total > 0 && (
                <Badge variant="outline" className="text-xs whitespace-nowrap">
                  Q {currentBatch.progress.current}/{currentBatch.progress.total}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3 pb-3">
            <p className="text-[11px] text-muted-foreground">
              Submit the batch when ready. Blank answers are treated as skips and preserved explicitly.
            </p>
            {questions.map((question) => (
              <div
                key={question.id}
                ref={(node) => { questionRefs.current[question.id] = node }}
                className="rounded-lg border border-border p-3 bg-accent/30 space-y-2"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] text-muted-foreground font-mono">{question.id}</span>
                  <Badge variant={statusBadgeVariant('current')} className="text-[10px] h-4">
                    current
                  </Badge>
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    {question.source === 'coverage_follow_up'
                      ? 'Coverage Follow-up'
                      : question.source === 'prompt_follow_up'
                        ? 'PROM4 Follow-up'
                        : question.source === 'final_free_form'
                          ? 'Final Free-Form'
                          : question.phase}
                  </span>
                  {question.priority && (
                    <Badge variant={priorityBadgeVariant(question.priority)} className="text-[10px] h-4">
                      {question.priority}
                    </Badge>
                  )}
                </div>
                <p className="text-xs font-medium">{question.question}</p>
                {question.rationale && (
                  <p className="text-[10px] text-muted-foreground italic">{question.rationale}</p>
                )}
                <textarea
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs min-h-[72px] focus:outline-none focus:ring-1 focus:ring-ring"
                  placeholder="Type your answer here. Leave blank to skip this question."
                  value={batchAnswers[question.id] ?? ''}
                  onChange={(event) => handleBatchAnswer(question.id, event.target.value)}
                  disabled={isBusy}
                />
              </div>
            ))}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowSkipConfirm(true)}
                disabled={isBusy || questions.length === 0}
                className="h-8 text-xs"
              >
                Skip All Questions
              </Button>
              <Button
                size="sm"
                onClick={handleSubmitBatch}
                disabled={isBusy || questions.length === 0}
                className="h-8 text-xs"
              >
                {isSubmitting
                  ? <LoadingText text="Submitting" />
                  : allBatchAnswersFilled
                    ? 'Submit Answers'
                    : 'Submit Batch'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {currentBatch.progress.total > 0 && (
        <div className="shrink-0 px-4 pb-1">
          <div className="h-1 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${(currentBatch.progress.current / currentBatch.progress.total) * 100}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
