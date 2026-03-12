import { useMemo } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { useInterviewQuestions } from '@/hooks/useTickets'
import type { InterviewQuestionStatus, InterviewQuestionView } from '@shared/interviewSession'

const INTERVIEW_FOCUS_EVENT = 'looptroop:interview-focus'

function groupQuestions(questions: InterviewQuestionView[]) {
  const groups = new Map<string, InterviewQuestionView[]>()
  for (const question of questions) {
    const label = question.source === 'coverage_follow_up'
      ? `Coverage Follow-ups${question.roundNumber ? ` · Round ${question.roundNumber}` : ''}`
      : question.source === 'prompt_follow_up'
        ? `PROM4 Follow-ups${question.roundNumber ? ` · Round ${question.roundNumber}` : ''}`
        : question.source === 'final_free_form'
          ? 'Final Free-Form'
          : question.phase
    const bucket = groups.get(label) ?? []
    bucket.push(question)
    groups.set(label, bucket)
  }

  return Array.from(groups.entries())
}

function statusLabel(status: InterviewQuestionStatus): string {
  switch (status) {
    case 'answered': return 'done'
    case 'skipped': return 'skip'
    case 'current': return 'now'
    default: return 'pending'
  }
}

function statusClass(status: InterviewQuestionStatus): string {
  switch (status) {
    case 'answered': return 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
    case 'skipped': return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
    case 'current': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'
    default: return ''
  }
}

export function InterviewNavigator({ ticketId }: { ticketId: string }) {
  const { data, isLoading } = useInterviewQuestions(ticketId)
  const groups = useMemo(() => groupQuestions(data?.questions ?? []), [data?.questions])

  const handleSelectQuestion = (questionId: string) => {
    window.dispatchEvent(new CustomEvent(INTERVIEW_FOCUS_EVENT, {
      detail: { ticketId, questionId },
    }))
  }

  return (
    <div className="p-2 border-t border-border">
      <div className="px-2 pb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        Interview Navigator
      </div>
      <ScrollArea className="max-h-[260px]">
        <div className="space-y-3 pr-2">
          {isLoading && (
            <div className="px-2 py-1 text-xs text-muted-foreground">Loading interview questions…</div>
          )}
          {!isLoading && groups.length === 0 && (
            <div className="px-2 py-1 text-xs text-muted-foreground">Questions will appear once the interview session is ready.</div>
          )}
          {groups.map(([label, questions]) => (
            <div key={label} className="space-y-1">
              <div className="px-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
              {questions.map((question) => (
                <button
                  key={question.id}
                  onClick={() => handleSelectQuestion(question.id)}
                  className="w-full rounded-md border border-border/70 bg-background px-2 py-2 text-left hover:bg-accent/40 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-muted-foreground">{question.id}</span>
                    <Badge variant="outline" className={`h-4 text-[10px] ${statusClass(question.status)}`}>
                      {statusLabel(question.status)}
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs leading-snug text-foreground/90">{question.question}</div>
                </button>
              ))}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
