import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { HelpCircle, Minus, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getApiUrl, waitForDevBackend } from '@/lib/devApi'
import { SSE_RECONNECT_DELAY_MS } from '@/lib/constants'
import { cn } from '@/lib/utils'
import type { Ticket } from '@/hooks/useTickets'

interface AIQuestionOption {
  label: string
  description?: string
}

interface AIQuestionInfo {
  question: string
  header: string
  options: AIQuestionOption[]
  multiple?: boolean
  custom?: boolean
}

interface AIQuestionPayload {
  type: 'opencode_question' | 'opencode_question_resolved'
  action?: 'asked' | 'replied' | 'rejected'
  ticketId: string
  ticketExternalId?: string
  ticketTitle?: string
  status?: string
  phase?: string
  modelId?: string
  sessionId?: string
  requestId: string
  questions?: AIQuestionInfo[]
  questionCount?: number
  timestamp?: string
}

interface AIQuestionRequestState extends Required<Pick<AIQuestionPayload, 'ticketId' | 'requestId'>> {
  ticketExternalId: string
  ticketTitle: string
  status: string
  phase: string
  modelId?: string
  sessionId?: string
  questions: AIQuestionInfo[]
  answers: Record<number, string[]>
  receivedAt: string
  submitting: boolean
  error?: string
}

interface AIQuestionQueueItem {
  request: AIQuestionRequestState
  question: AIQuestionInfo
  questionIndex: number
  queueIndex: number
  queueTotal: number
}

interface AIQuestionContextValue {
  getPendingCount: (ticketId: string) => number
  openQueue: () => void
}

const AIQuestionContext = createContext<AIQuestionContextValue>({
  getPendingCount: () => 0,
  openQueue: () => undefined,
})

function isTerminalStatus(status: string) {
  return status === 'COMPLETED' || status === 'CANCELED'
}

function normalizeQuestion(question: AIQuestionInfo): AIQuestionInfo {
  return {
    question: question.question || question.header || 'AI question',
    header: question.header || 'AI question',
    options: Array.isArray(question.options) ? question.options : [],
    ...(typeof question.multiple === 'boolean' ? { multiple: question.multiple } : {}),
    ...(typeof question.custom === 'boolean' ? { custom: question.custom } : {}),
  }
}

function parseQuestionPayload(data: Record<string, unknown>): AIQuestionPayload | null {
  if (data.type !== 'opencode_question' && data.type !== 'opencode_question_resolved') return null
  if (typeof data.ticketId !== 'string' || typeof data.requestId !== 'string') return null
  const questions = Array.isArray(data.questions)
    ? data.questions
        .filter((question): question is AIQuestionInfo => Boolean(question) && typeof question === 'object')
        .map(normalizeQuestion)
    : undefined
  return {
    type: data.type,
    action: data.action === 'replied' || data.action === 'rejected' || data.action === 'asked' ? data.action : undefined,
    ticketId: data.ticketId,
    requestId: data.requestId,
    ...(typeof data.ticketExternalId === 'string' ? { ticketExternalId: data.ticketExternalId } : {}),
    ...(typeof data.ticketTitle === 'string' ? { ticketTitle: data.ticketTitle } : {}),
    ...(typeof data.status === 'string' ? { status: data.status } : {}),
    ...(typeof data.phase === 'string' ? { phase: data.phase } : {}),
    ...(typeof data.modelId === 'string' ? { modelId: data.modelId } : {}),
    ...(typeof data.sessionId === 'string' ? { sessionId: data.sessionId } : {}),
    ...(questions ? { questions } : {}),
    ...(typeof data.questionCount === 'number' ? { questionCount: data.questionCount } : {}),
    ...(typeof data.timestamp === 'string' ? { timestamp: data.timestamp } : {}),
  }
}

function AIQuestionTicketStream({
  ticketId,
  onPayload,
}: {
  ticketId: string
  onPayload: (payload: AIQuestionPayload) => void
}) {
  const onPayloadRef = useRef(onPayload)
  const lastEventIdRef = useRef('0')

  useEffect(() => {
    onPayloadRef.current = onPayload
  }, [onPayload])

  useEffect(() => {
    let eventSource: EventSource | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let closed = false

    const connect = () => {
      if (closed || eventSource) return
      void (async () => {
        try {
          await waitForDevBackend()
        } catch {
          if (!closed) reconnectTimer = setTimeout(connect, SSE_RECONNECT_DELAY_MS)
          return
        }
        if (closed || eventSource) return

        const url = new URL(getApiUrl('/api/stream', { directInDevelopment: true }))
        url.searchParams.set('ticketId', ticketId)
        if (lastEventIdRef.current !== '0') url.searchParams.set('lastEventId', lastEventIdRef.current)

        const source = new EventSource(url.toString())
        eventSource = source
        source.addEventListener('needs_input', (event) => {
          lastEventIdRef.current = event.lastEventId || lastEventIdRef.current
          try {
            const parsed = parseQuestionPayload(JSON.parse(event.data) as Record<string, unknown>)
            if (parsed) onPayloadRef.current(parsed)
          } catch {
            // Ignore malformed events from older backends.
          }
        })
        source.onerror = () => {
          source.close()
          eventSource = null
          if (!closed) reconnectTimer = setTimeout(connect, SSE_RECONNECT_DELAY_MS)
        }
      })()
    }

    connect()
    return () => {
      closed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      eventSource?.close()
    }
  }, [ticketId])

  return null
}

function QuestionAnswerForm({
  item,
  disabled,
  onAnswer,
  onReject,
}: {
  item: AIQuestionQueueItem
  disabled: boolean
  onAnswer: (answers: string[]) => void
  onReject: () => void
}) {
  const questionKey = `${item.request.requestId}:${item.questionIndex}`
  const [selected, setSelected] = useState<string[]>([])
  const [custom, setCustom] = useState('')
  const allowsCustom = item.question.custom !== false
  const isMultiple = item.question.multiple === true

  useEffect(() => {
    setSelected([])
    setCustom('')
  }, [questionKey])

  const answers = [...selected, custom.trim()].filter(Boolean)
  const canSubmit = answers.length > 0

  const toggleOption = (label: string) => {
    setSelected((current) => {
      if (!isMultiple) return current.includes(label) ? [] : [label]
      return current.includes(label)
        ? current.filter((candidate) => candidate !== label)
        : [...current, label]
    })
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (canSubmit && !disabled) onAnswer(answers)
      }}
    >
      {item.question.options.length > 0 && (
        <div className="space-y-2">
          {item.question.options.map((option) => {
            const checked = selected.includes(option.label)
            return (
              <label
                key={option.label}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 text-sm transition-colors',
                  checked && 'border-primary bg-accent',
                )}
              >
                <input
                  type={isMultiple ? 'checkbox' : 'radio'}
                  name={questionKey}
                  className="mt-1"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => toggleOption(option.label)}
                />
                <span className="min-w-0">
                  <span className="block font-medium text-foreground">{option.label}</span>
                  {option.description && <span className="block text-xs leading-5 text-muted-foreground">{option.description}</span>}
                </span>
              </label>
            )
          })}
        </div>
      )}

      {allowsCustom && (
        <label className="block space-y-1 text-sm">
          <span className="font-medium text-foreground">{item.question.options.length > 0 ? 'Notes' : 'Answer'}</span>
          <textarea
            value={custom}
            disabled={disabled}
            onChange={(event) => setCustom(event.target.value)}
            className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
          />
        </label>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onReject}>
          Cannot answer
        </Button>
        <Button type="submit" size="sm" disabled={disabled || !canSubmit}>
          Send answer
        </Button>
      </div>
    </form>
  )
}

function AIQuestionPopup({
  item,
  onMinimize,
  onAnswer,
  onReject,
}: {
  item: AIQuestionQueueItem
  onMinimize: () => void
  onAnswer: (answers: string[]) => void
  onReject: () => void
}) {
  const sessionLabel = item.request.sessionId ? item.request.sessionId.slice(0, 10) : null
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 p-4">
      <section className="w-full max-w-xl rounded-lg border border-border bg-background p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="gap-1.5 text-xs">
                <HelpCircle className="h-3 w-3" />
                AI question
              </Badge>
              <Badge variant="outline" className="text-xs">
                {item.queueIndex + 1} of {item.queueTotal}
              </Badge>
            </div>
            <h2 className="text-base font-semibold leading-6 text-foreground">{item.question.header}</h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={onMinimize}
              aria-label="Minimize AI question"
            >
              <Minus className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="mt-3 grid gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground sm:grid-cols-2">
          <div><span className="font-medium text-foreground">Ticket:</span> {item.request.ticketExternalId} · {item.request.ticketTitle}</div>
          <div><span className="font-medium text-foreground">Status:</span> {item.request.status}</div>
          <div><span className="font-medium text-foreground">Model:</span> {item.request.modelId ?? 'OpenCode'}</div>
          <div><span className="font-medium text-foreground">Session:</span> {sessionLabel ?? 'unknown'}</div>
        </div>

        <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-foreground">{item.question.question}</p>
        {item.request.error && (
          <p className="mt-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {item.request.error}
          </p>
        )}
        <div className="mt-4">
          <QuestionAnswerForm
            item={item}
            disabled={item.request.submitting}
            onAnswer={onAnswer}
            onReject={onReject}
          />
        </div>
      </section>
    </div>
  )
}

export function AIQuestionProvider({ tickets, children }: { tickets: Ticket[]; children: ReactNode }) {
  const [requests, setRequests] = useState<Record<string, AIQuestionRequestState>>({})
  const [minimized, setMinimized] = useState(false)
  const ticketsById = useMemo(() => new Map(tickets.map((ticket) => [ticket.id, ticket])), [tickets])
  const activeTickets = useMemo(() => tickets.filter((ticket) => !isTerminalStatus(ticket.status)), [tickets])
  const activeTicketKey = activeTickets.map((ticket) => ticket.id).join('|')

  const removeRequest = useCallback((requestId: string) => {
    setRequests((current) => {
      if (!current[requestId]) return current
      const next = { ...current }
      delete next[requestId]
      return next
    })
  }, [])

  const ingestPayload = useCallback((payload: AIQuestionPayload) => {
    if (payload.type === 'opencode_question_resolved') {
      removeRequest(payload.requestId)
      return
    }
    if (!payload.questions || payload.questions.length === 0) return
    const questions = payload.questions
    const ticket = ticketsById.get(payload.ticketId)
    setRequests((current) => {
      if (current[payload.requestId]) return current
      return {
        ...current,
        [payload.requestId]: {
          ticketId: payload.ticketId,
          ticketExternalId: payload.ticketExternalId ?? ticket?.externalId ?? payload.ticketId,
          ticketTitle: payload.ticketTitle ?? ticket?.title ?? 'Ticket',
          status: payload.status ?? ticket?.status ?? payload.phase ?? 'UNKNOWN',
          phase: payload.phase ?? payload.status ?? ticket?.status ?? 'UNKNOWN',
          ...(payload.modelId ? { modelId: payload.modelId } : {}),
          ...(payload.sessionId ? { sessionId: payload.sessionId } : {}),
          requestId: payload.requestId,
          questions: questions.map(normalizeQuestion),
          answers: {},
          receivedAt: payload.timestamp ?? new Date().toISOString(),
          submitting: false,
        },
      }
    })
    setMinimized(false)
  }, [removeRequest, ticketsById])

  useEffect(() => {
    let cancelled = false

    const recover = async () => {
      await Promise.all(activeTickets.map(async (ticket) => {
        try {
          const res = await fetch(`/api/tickets/${ticket.id}/opencode/questions`)
          if (!res.ok) return
          const body = await res.json() as { questions?: Array<Record<string, unknown>> }
          if (cancelled || !Array.isArray(body.questions)) return
          for (const raw of body.questions) {
            const payload = parseQuestionPayload(raw)
            if (payload) ingestPayload(payload)
          }
        } catch {
          // Best-effort recovery; live SSE remains authoritative while connected.
        }
      }))
    }

    void recover()
    const interval = setInterval(() => void recover(), 30_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [activeTicketKey, activeTickets, ingestPayload])

  const queue = useMemo<AIQuestionQueueItem[]>(() => {
    const items = Object.values(requests)
      .sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt))
      .flatMap((request) => request.questions
        .map((question, questionIndex) => ({ request, question, questionIndex }))
        .filter((item) => !request.answers[item.questionIndex]))
    return items.map((item, queueIndex) => ({ ...item, queueIndex, queueTotal: items.length }))
  }, [requests])

  const activeItem = queue[0] ?? null

  const answerActiveQuestion = useCallback((answers: string[]) => {
    if (!activeItem) return
    const request = requests[activeItem.request.requestId]
    if (!request) return
    const nextAnswers = {
      ...request.answers,
      [activeItem.questionIndex]: answers,
    }
    const complete = request.questions.every((_, index) => Array.isArray(nextAnswers[index]) && nextAnswers[index]!.length > 0)

    if (!complete) {
      setRequests((current) => ({
        ...current,
        [request.requestId]: { ...request, answers: nextAnswers, error: undefined },
      }))
      return
    }

    setRequests((current) => ({
      ...current,
      [request.requestId]: { ...request, answers: nextAnswers, submitting: true, error: undefined },
    }))

    void fetch(`/api/tickets/${request.ticketId}/opencode/questions/${request.requestId}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: request.questions.map((_, index) => nextAnswers[index] ?? []) }),
    }).then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string; details?: string }
        throw new Error(body.details ?? body.error ?? 'Failed to answer question')
      }
      removeRequest(request.requestId)
    }).catch((error: unknown) => {
      setRequests((current) => {
        const latest = current[request.requestId]
        if (!latest) return current
        return {
          ...current,
          [request.requestId]: {
            ...latest,
            submitting: false,
            error: error instanceof Error ? error.message : String(error),
          },
        }
      })
    })
  }, [activeItem, removeRequest, requests])

  const rejectActiveQuestion = useCallback(() => {
    if (!activeItem) return
    const request = requests[activeItem.request.requestId]
    if (!request) return
    setRequests((current) => ({
      ...current,
      [request.requestId]: { ...request, submitting: true, error: undefined },
    }))
    void fetch(`/api/tickets/${request.ticketId}/opencode/questions/${request.requestId}/reject`, {
      method: 'POST',
    }).then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string; details?: string }
        throw new Error(body.details ?? body.error ?? 'Failed to reject question')
      }
      removeRequest(request.requestId)
    }).catch((error: unknown) => {
      setRequests((current) => {
        const latest = current[request.requestId]
        if (!latest) return current
        return {
          ...current,
          [request.requestId]: {
            ...latest,
            submitting: false,
            error: error instanceof Error ? error.message : String(error),
          },
        }
      })
    })
  }, [activeItem, removeRequest, requests])

  const getPendingCount = useCallback((ticketId: string) => {
    return Object.values(requests)
      .filter((request) => request.ticketId === ticketId)
      .reduce((count, request) => count + request.questions.filter((_, index) => !request.answers[index]).length, 0)
  }, [requests])

  const value = useMemo<AIQuestionContextValue>(() => ({
    getPendingCount,
    openQueue: () => setMinimized(false),
  }), [getPendingCount])

  return (
    <AIQuestionContext.Provider value={value}>
      {children}
      {activeTickets.map((ticket) => (
        <AIQuestionTicketStream key={ticket.id} ticketId={ticket.id} onPayload={ingestPayload} />
      ))}
      {activeItem && !minimized && (
        <AIQuestionPopup
          item={activeItem}
          onMinimize={() => setMinimized(true)}
          onAnswer={answerActiveQuestion}
          onReject={rejectActiveQuestion}
        />
      )}
      {activeItem && minimized && (
        <button
          type="button"
          className="fixed bottom-4 right-4 z-[90] flex max-w-xs items-center gap-3 rounded-lg border border-border bg-background px-4 py-3 text-left text-sm shadow-xl hover:bg-accent"
          onClick={() => setMinimized(false)}
        >
          <HelpCircle className="h-5 w-5 text-primary" />
          <span className="min-w-0">
            <span className="block font-medium text-foreground">AI question waiting</span>
            <span className="block truncate text-xs text-muted-foreground">{activeItem.request.ticketExternalId} · {activeItem.queueTotal} pending</span>
          </span>
          <X className="h-4 w-4 text-muted-foreground" />
        </button>
      )}
    </AIQuestionContext.Provider>
  )
}

export function useAIQuestions() {
  return useContext(AIQuestionContext)
}
