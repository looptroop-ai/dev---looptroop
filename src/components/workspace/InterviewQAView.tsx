import { useState, useRef, useEffect, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  useInterviewQuestions,
  useSubmitAnswers,
  useSkipInterview,
  useTicketUIState,
  useSaveTicketUIState,
} from '@/hooks/useTickets'
import type { Ticket, InterviewQuestion } from '@/hooks/useTickets'

interface InterviewQAViewProps {
  ticket: Ticket
}

const CATEGORY_ORDER = ['Foundation', 'Structure', 'Assembly']

function categorySort(a: string, b: string) {
  const ai = CATEGORY_ORDER.findIndex(c => a.toLowerCase().includes(c.toLowerCase()))
  const bi = CATEGORY_ORDER.findIndex(c => b.toLowerCase().includes(c.toLowerCase()))
  return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
}

function priorityBadgeVariant(priority: string): 'destructive' | 'default' | 'secondary' | 'outline' {
  switch (priority) {
    case 'critical': return 'destructive'
    case 'high': return 'default'
    case 'medium': return 'secondary'
    default: return 'outline'
  }
}

export function InterviewQAView({ ticket }: InterviewQAViewProps) {
  const { data: interviewData, isLoading } = useInterviewQuestions(ticket.id)
  const { mutate: submitAnswers, isPending: isSubmitting } = useSubmitAnswers()
  const { mutate: skipInterview, isPending: isSkipping } = useSkipInterview()
  const { mutate: saveUiState } = useSaveTicketUIState()
  const { data: persistedUiState } = useTicketUIState<{
    answers?: Record<string, string>
    currentIndex?: number
    submittedIds?: string[]
  }>(ticket.id, 'interview_qa', true)

  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [currentIndex, setCurrentIndex] = useState(0)
  const [submittedIds, setSubmittedIds] = useState<Set<string>>(new Set())
  const [showPrevious, setShowPrevious] = useState(false)
  const currentRef = useRef<HTMLDivElement>(null)
  const hydratedRef = useRef(false)
  const lastSavedSnapshotRef = useRef('')

  const questions: InterviewQuestion[] = interviewData?.questions ?? []
  const totalQuestions = questions.length

  const submittedIdList = useMemo(
    () => Array.from(submittedIds).filter(Boolean).sort(),
    [submittedIds],
  )

  useEffect(() => {
    hydratedRef.current = false
    lastSavedSnapshotRef.current = ''
  }, [ticket.id])

  useEffect(() => {
    if (isLoading || hydratedRef.current) return

    const source = persistedUiState?.data
    const persistedAnswers = source?.answers
    const persistedIndex = source?.currentIndex
    const persistedSubmittedIds = source?.submittedIds

    const nextAnswers = persistedAnswers && typeof persistedAnswers === 'object'
      ? Object.fromEntries(
        Object.entries(persistedAnswers).filter(([, value]) => typeof value === 'string'),
      )
      : {}

    const maxIndex = Math.max(totalQuestions - 1, 0)
    const nextIndexRaw = typeof persistedIndex === 'number' ? persistedIndex : 0
    const nextIndex = Math.min(Math.max(nextIndexRaw, 0), maxIndex)
    const nextSubmitted = Array.isArray(persistedSubmittedIds)
      ? persistedSubmittedIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : []

    setAnswers(nextAnswers)
    setCurrentIndex(nextIndex)
    setSubmittedIds(new Set(nextSubmitted))
    lastSavedSnapshotRef.current = JSON.stringify({
      answers: nextAnswers,
      currentIndex: nextIndex,
      submittedIds: [...new Set(nextSubmitted)].sort(),
    })
    hydratedRef.current = true
  }, [isLoading, persistedUiState, totalQuestions])

  // Determine which questions are answered (non-empty answer text)
  const answeredIds = new Set(
    Object.entries(answers).filter(([, v]) => v.trim() !== '').map(([k]) => k)
  )
  // Skipped = explicitly visited (key exists in answers) but answer is empty
  const skippedIds = new Set(
    Object.entries(answers).filter(([, v]) => v.trim() === '').map(([k]) => k)
  )

  // Group questions by category
  const categories = [...new Set(questions.map(q => q.category))].sort(categorySort)
  const questionsByCategory = categories.reduce<Record<string, InterviewQuestion[]>>((acc, cat) => {
    acc[cat] = questions.filter(q => q.category === cat)
    return acc
  }, {})

  // Current question
  const currentQuestion = questions[currentIndex] ?? null
  const currentPriority = typeof currentQuestion?.priority === 'string'
    ? currentQuestion.priority.trim()
    : ''
  const answeredCount = answeredIds.size + skippedIds.size

  useEffect(() => {
    if (!hydratedRef.current || isLoading) return

    const maxIndex = Math.max(totalQuestions - 1, 0)
    const snapshot = {
      answers,
      currentIndex: Math.min(Math.max(currentIndex, 0), maxIndex),
      submittedIds: submittedIdList,
    }
    const serialized = JSON.stringify(snapshot)

    if (serialized === lastSavedSnapshotRef.current) return

    const timer = window.setTimeout(() => {
      lastSavedSnapshotRef.current = serialized
      saveUiState({
        ticketId: ticket.id,
        scope: 'interview_qa',
        data: snapshot,
      })
    }, 350)

    return () => window.clearTimeout(timer)
  }, [
    answers,
    currentIndex,
    submittedIdList,
    isLoading,
    totalQuestions,
    saveUiState,
    ticket.id,
  ])

  // Auto-scroll to current question
  useEffect(() => {
    currentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [currentIndex])

  const handleAnswer = (questionId: string, value: string) => {
    setAnswers(prev => ({ ...prev, [questionId]: value }))
  }

  const handleSkipQuestion = () => {
    if (!currentQuestion) return
    setAnswers(prev => ({ ...prev, [currentQuestion.id]: '' }))
    setSubmittedIds(prev => new Set(prev).add(currentQuestion.id))
    if (currentIndex < totalQuestions - 1) {
      setCurrentIndex(i => i + 1)
    }
  }

  const handleAnswerAndNext = () => {
    if (!currentQuestion) return
    setSubmittedIds(prev => new Set(prev).add(currentQuestion.id))
    if (currentIndex < totalQuestions - 1) {
      setCurrentIndex(i => i + 1)
    }
  }

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(i => i - 1)
    }
  }

  const handleSubmitAll = () => {
    submitAnswers({ ticketId: ticket.id, answers })
  }

  const handleSkipAll = () => {
    skipInterview({ ticketId: ticket.id, answers })
  }

  const isBusy = isSubmitting || isSkipping

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
        Loading interview questions…
      </div>
    )
  }

  if (totalQuestions === 0) {
    return (
      <div className="h-full flex flex-col overflow-hidden">
        <div className="p-4 space-y-3 shrink-0">
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm">Interview Q&A</CardTitle>
            </CardHeader>
            <CardContent className="pb-3">
              <p className="text-xs text-muted-foreground">
                Interview questions will be generated by the council and presented here.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Previous answers — collapsible */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
        {submittedIds.size > 0 && (
          <div>
            <button
              onClick={() => setShowPrevious(p => !p)}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mb-2"
            >
              {showPrevious ? '▼' : '▶'} Previous Answers ({submittedIds.size})
            </button>
            {showPrevious && categories.map(cat => {
              const catQuestions = questionsByCategory[cat] ?? []
              const submittedInCat = catQuestions.filter(q => submittedIds.has(q.id))
              if (submittedInCat.length === 0) return null
              return (
                <div key={cat} className="space-y-1 mb-2">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">{cat}</div>
                  {submittedInCat.map(q => (
                    <div key={q.id} className="rounded border border-border/50 p-2 bg-muted/30 text-xs">
                      <div className="flex items-start gap-2">
                        <span className="font-medium text-muted-foreground shrink-0">Q:</span>
                        <span className="text-muted-foreground">{q.question}</span>
                      </div>
                      <div className="flex items-start gap-2 mt-1">
                        <span className="font-medium text-green-600 shrink-0">A:</span>
                        <span>{answers[q.id]?.trim() || <span className="italic text-muted-foreground">Skipped</span>}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        )}

        {/* Current question card */}
        {currentQuestion && (
          <div ref={currentRef}>
            <Card>
              <CardHeader className="py-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">Interview Q&A</CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      Q {currentIndex + 1}/{totalQuestions}
                    </Badge>
                    <Badge variant="secondary" className="text-xs">
                      {answeredCount} answered
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 pb-3">
                <div className="rounded-lg border border-border p-3 bg-accent/30">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                      {currentQuestion.category}
                    </span>
                    {currentPriority && (
                      <Badge variant={priorityBadgeVariant(currentPriority)} className="text-[10px] h-4">
                        {currentPriority}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs font-medium">{currentQuestion.question}</p>
                  {currentQuestion.rationale && (
                    <p className="text-[10px] text-muted-foreground mt-1 italic">{currentQuestion.rationale}</p>
                  )}
                </div>

                <textarea
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs min-h-[60px] focus:outline-none focus:ring-1 focus:ring-ring"
                  placeholder="Type your answer here…"
                  value={answers[currentQuestion.id] ?? ''}
                  onChange={e => handleAnswer(currentQuestion.id, e.target.value)}
                  disabled={isBusy}
                />

                <div className="flex gap-2 justify-between">
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handlePrev}
                      disabled={currentIndex === 0 || isBusy}
                      className="h-7 text-xs"
                    >
                      ← Prev
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleAnswerAndNext}
                      disabled={currentIndex >= totalQuestions - 1 || isBusy}
                      className="h-7 text-xs"
                    >
                      Next →
                    </Button>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleSkipQuestion}
                      disabled={isBusy}
                      className="h-7 text-xs"
                    >
                      Skip
                    </Button>
                    {currentIndex === totalQuestions - 1 ? (
                      <Button
                        size="sm"
                        onClick={handleSubmitAll}
                        disabled={isBusy}
                        className="h-7 text-xs"
                      >
                        {isSubmitting ? 'Submitting…' : 'Submit All'}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={handleAnswerAndNext}
                        disabled={!answers[currentQuestion.id]?.trim() || isBusy}
                        className="h-7 text-xs"
                      >
                        Answer & Next
                      </Button>
                    )}
                  </div>
                </div>

                <div className="flex gap-2 justify-end border-t border-border pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSkipAll}
                    disabled={isBusy}
                    className="h-7 text-xs text-muted-foreground"
                  >
                    {isSkipping ? 'Skipping…' : 'Skip All Questions'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div className="shrink-0 px-4 pb-1">
        <div className="h-1 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${totalQuestions > 0 ? ((currentIndex + 1) / totalQuestions) * 100 : 0}%` }}
          />
        </div>
      </div>

    </div>
  )
}
