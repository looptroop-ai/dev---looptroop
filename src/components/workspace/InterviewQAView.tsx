import { useMemo, useRef, useState, useEffect, useCallback } from 'react'
import type { Ticket } from '@/hooks/useTickets'
import { useInterviewQuestions, useEditInterviewAnswer } from '@/hooks/useTickets'
import type {
  InterviewQuestionView,
} from '@shared/interviewSession'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { LoadingText } from '@/components/ui/LoadingText'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PhaseLogPanel } from './PhaseLogPanel'
import { VerticalResizeHandle } from './VerticalResizeHandle'
import { QuestionList } from './QuestionList'
import { AnswerEditor } from './AnswerEditor'
import { useBatchSubmit, getBatchKey } from '@/hooks/useBatchSubmit'

interface InterviewQAViewProps {
  ticket: Ticket
}

const INTERVIEW_FOCUS_EVENT = 'looptroop:interview-focus'

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
  const { mutateAsync: editAnswerMutation, isPending: isEditingAnswer } = useEditInterviewAnswer()
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const [logExpanded, setLogExpanded] = useState(false)
  const [logHeight, setLogHeight] = useState(200)
  const containerRef = useRef<HTMLDivElement>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [showSkipConfirm, setShowSkipConfirm] = useState(false)
  const questionRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const {
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
  } = useBatchSubmit(ticket.id)

  const session = interviewData?.session ?? null
  const currentBatch = (() => {
    if (session?.completedAt && !session.currentBatch) return null
    if (!sseBatch) {
      const apiBatch = session?.currentBatch ?? null
      if (apiBatch && getBatchKey(apiBatch) === submittedBatchKey) return null
      return apiBatch
    }
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

  const batchSkipped = useMemo(
    () => (currentBatchKey ? skippedQuestions[currentBatchKey] ?? new Set<string>() : new Set<string>()),
    [currentBatchKey, skippedQuestions],
  )

  const onBatchAnswer = useCallback((questionId: string, value: string) => {
    handleBatchAnswer(currentBatchKey, questionId, value)
  }, [currentBatchKey, handleBatchAnswer])

  const onSkipQuestion = useCallback((questionId: string) => {
    handleSkipQuestion(currentBatchKey, questionId)
  }, [currentBatchKey, handleSkipQuestion])

  const onUnskipQuestion = useCallback((questionId: string) => {
    handleUnskipQuestion(currentBatchKey, questionId)
  }, [currentBatchKey, handleUnskipQuestion])

  const onSubmitBatch = useCallback(async () => {
    await handleSubmitBatch(currentBatch, currentBatchKey, batchAnswers)
  }, [handleSubmitBatch, currentBatch, currentBatchKey, batchAnswers])

  const onConfirmSkipAll = useCallback(async () => {
    await handleConfirmSkipAll(currentBatch, batchAnswers)
    setShowSkipConfirm(false)
  }, [handleConfirmSkipAll, currentBatch, batchAnswers])

  const handleStartEdit = useCallback((questionId: string, currentAnswer: string) => {
    setEditingQuestionId(questionId)
    setEditingText(currentAnswer)
  }, [])

  const handleCancelEdit = useCallback(() => {
    setEditingQuestionId(null)
    setEditingText('')
  }, [])

  const handleSaveEdit = useCallback(async () => {
    if (!editingQuestionId) return
    try {
      await editAnswerMutation({
        ticketId: ticket.id,
        questionId: editingQuestionId,
        answer: editingText,
      })
      setEditingQuestionId(null)
      setEditingText('')
    } catch (err) {
      console.error('Failed to edit interview answer:', err)
    }
  }, [editingQuestionId, editingText, editAnswerMutation, ticket.id])

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

  const questions = currentBatch?.questions ?? []
  const allBatchAnswersFilled = currentBatch ? questions.every((question) => batchAnswers[question.id]?.trim()) : false
  const isBusy = isSubmitting || isSkipping

  return (
    <div ref={containerRef} className="h-full flex flex-col overflow-hidden">
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
            <Button variant="destructive" size="sm" onClick={onConfirmSkipAll} disabled={isBusy}>
              {isSkipping ? <LoadingText text="Skipping" /> : 'Skip to Approval'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        <QuestionList
          historyGroups={historyGroups}
          showHistory={showHistory}
          onToggleHistory={() => setShowHistory(v => !v)}
          editingQuestionId={editingQuestionId}
          editingText={editingText}
          isEditingAnswer={isEditingAnswer}
          onEditingTextChange={setEditingText}
          onStartEdit={handleStartEdit}
          onCancelEdit={handleCancelEdit}
          onSaveEdit={handleSaveEdit}
          questionRefs={questionRefs}
        />

        {!currentBatch ? (
          <div className="flex items-center justify-center py-12 text-xs text-muted-foreground">
            <div className="text-center space-y-2">
              <LoadingText text={isSubmitting ? "AI is analyzing your answers" : "Preparing interview batch"} className="text-sm font-medium animate-pulse" />
              <p className="text-[10px]">{isSubmitting ? "Preparing the next interview step." : "Waiting for the next interview questions."}</p>
            </div>
          </div>
        ) : (
          <AnswerEditor
            questions={questions}
            batchAnswers={batchAnswers}
            batchSkipped={batchSkipped}
            isBusy={isBusy}
            isSubmitting={isSubmitting}
            allBatchAnswersFilled={allBatchAnswersFilled}
            onBatchAnswer={onBatchAnswer}
            onSkipQuestion={onSkipQuestion}
            onUnskipQuestion={onUnskipQuestion}
            onSubmitBatch={onSubmitBatch}
            onShowSkipConfirm={() => setShowSkipConfirm(true)}
            questionRefs={questionRefs}
            currentBatch={currentBatch}
          />
        )}
      </div>

      {currentBatch && currentBatch.progress.total > 0 && (
        <div className="shrink-0 px-4 pb-1">
          <div className="h-1 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${(currentBatch.progress.current / currentBatch.progress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {logExpanded && <VerticalResizeHandle onResize={setLogHeight} containerRef={containerRef} />}
      <div className="shrink-0 px-4 pb-4 flex flex-col" style={logExpanded ? { height: logHeight, minHeight: 0 } : undefined}>
        <button
          type="button"
          onClick={() => setLogExpanded(v => !v)}
          className="flex items-center gap-1 text-xs font-medium text-muted-foreground uppercase tracking-wider py-1 hover:text-foreground transition-colors"
        >
          <span className="inline-block transition-transform" style={{ transform: logExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
          Log
        </button>
        {logExpanded && <PhaseLogPanel phase={ticket.status} ticket={ticket} />}
      </div>
    </div>
  )
}
