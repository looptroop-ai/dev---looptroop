import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

interface Ticket {
  id: number
  externalId: string
  projectId: number
  title: string
  description: string | null
  priority: number
  status: string
  xstateSnapshot: string | null
  branchName: string | null
  currentBead: number | null
  totalBeads: number | null
  percentComplete: number | null
  errorMessage: string | null
  lockedMainImplementer: string | null
  lockedCouncilMembers: string | null
  startedAt: string | null
  plannedDate: string | null
  createdAt: string
  updatedAt: string
}

interface CreateTicketInput {
  projectId: number
  title: string
  description?: string
  priority?: number
}

async function fetchTickets(projectId?: number): Promise<Ticket[]> {
  const url = projectId ? `/api/tickets?projectId=${projectId}` : '/api/tickets'
  const res = await fetch(url)
  if (!res.ok) throw new Error('Failed to fetch tickets')
  return res.json()
}

async function fetchTicket(id: number): Promise<Ticket> {
  const res = await fetch(`/api/tickets/${id}`)
  if (!res.ok) throw new Error('Failed to fetch ticket')
  return res.json()
}

async function createTicket(input: CreateTicketInput): Promise<Ticket> {
  const res = await fetch('/api/tickets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error || 'Failed to create ticket')
  }
  return res.json()
}

async function updateTicket(id: number, input: Partial<Pick<Ticket, 'title' | 'description' | 'priority'>>): Promise<Ticket> {
  const res = await fetch(`/api/tickets/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error || 'Failed to update ticket')
  }
  return res.json()
}

async function ticketAction(id: number, action: 'start' | 'approve' | 'cancel' | 'retry'): Promise<{ message: string }> {
  const res = await fetch(`/api/tickets/${id}/${action}`, { method: 'POST' })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error || `Failed to ${action} ticket`)
  }
  return res.json()
}

interface InterviewQuestion {
  id: string
  phase: string
  question: string
  priority: 'critical' | 'high' | 'medium' | 'low'
  rationale: string
}

interface InterviewData {
  questions: InterviewQuestion[]
  raw: string | null
  draft: {
    answers: Record<string, string>
  }
  draftUpdatedAt: string | null
}

async function fetchInterview(ticketId: number): Promise<InterviewData> {
  const res = await fetch(`/api/tickets/${ticketId}/interview`)
  if (!res.ok) throw new Error('Failed to fetch interview data')
  return res.json()
}

async function submitAnswers(
  ticketId: number,
  payload: { answers: Record<string, string> },
): Promise<{ message: string }> {
  const res = await fetch(`/api/tickets/${ticketId}/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error || 'Failed to submit answers')
  }
  return res.json()
}

async function skipInterview(
  ticketId: number,
  payload: { answers: Record<string, string> } = { answers: {} },
): Promise<{ message: string }> {
  const res = await fetch(`/api/tickets/${ticketId}/skip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error || 'Failed to skip')
  }
  return res.json()
}

interface TicketUIStateResponse<T = unknown> {
  scope: string
  exists: boolean
  data: T | null
  updatedAt: string | null
}

async function fetchTicketUIState<T = unknown>(
  ticketId: number,
  scope: string,
): Promise<TicketUIStateResponse<T>> {
  const params = new URLSearchParams({ scope })
  const res = await fetch(`/api/tickets/${ticketId}/ui-state?${params.toString()}`)
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error || 'Failed to fetch ticket UI state')
  }
  return res.json()
}

async function saveTicketUIState(
  ticketId: number,
  scope: string,
  data: unknown,
): Promise<{ success: boolean; scope: string; updatedAt: string }> {
  const res = await fetch(`/api/tickets/${ticketId}/ui-state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope, data }),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error || 'Failed to save ticket UI state')
  }
  return res.json()
}

export function useTickets(projectId?: number) {
  return useQuery({
    queryKey: projectId ? ['tickets', { projectId }] : ['tickets'],
    queryFn: () => fetchTickets(projectId),
  })
}

export function useTicket(id: number | null) {
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: ['ticket', id],
    queryFn: () => fetchTicket(id!),
    enabled: id !== null,
    initialData: () => {
      const allTicketLists = queryClient.getQueriesData<Ticket[]>({ queryKey: ['tickets'] })
      for (const [, tickets] of allTicketLists) {
        const ticket = tickets?.find(t => t.id === id)
        if (ticket) return ticket
      }
      return undefined
    },
  })
}

export function useCreateTicket() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createTicket,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] })
    },
  })
}

export function useUpdateTicket() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number } & Partial<Pick<Ticket, 'title' | 'description' | 'priority'>>) =>
      updateTicket(id, input),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] })
      queryClient.invalidateQueries({ queryKey: ['ticket', variables.id] })
    },
  })
}

export function useTicketAction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, action }: { id: number; action: 'start' | 'approve' | 'cancel' | 'retry' }) =>
      ticketAction(id, action),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] })
      queryClient.invalidateQueries({ queryKey: ['ticket', variables.id] })
    },
  })
}

export function useInterviewQuestions(ticketId: number) {
  return useQuery({
    queryKey: ['interview', ticketId],
    queryFn: () => fetchInterview(ticketId),
  })
}

export function useSubmitAnswers() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ ticketId, answers }: { ticketId: number; answers: Record<string, string> }) =>
      submitAnswers(ticketId, { answers }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] })
      queryClient.invalidateQueries({ queryKey: ['ticket', variables.ticketId] })
      queryClient.invalidateQueries({ queryKey: ['interview', variables.ticketId] })
      queryClient.invalidateQueries({ queryKey: ['ticket-ui-state', variables.ticketId, 'interview_qa'] })
    },
  })
}

export function useSkipInterview() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ ticketId, answers = {} }: { ticketId: number; answers?: Record<string, string> }) =>
      skipInterview(ticketId, { answers }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] })
      queryClient.invalidateQueries({ queryKey: ['ticket', variables.ticketId] })
      queryClient.invalidateQueries({ queryKey: ['interview', variables.ticketId] })
      queryClient.invalidateQueries({ queryKey: ['ticket-ui-state', variables.ticketId, 'interview_qa'] })
    },
  })
}

export function useTicketUIState<T = unknown>(ticketId: number, scope: string, enabled: boolean = true) {
  return useQuery({
    queryKey: ['ticket-ui-state', ticketId, scope],
    queryFn: () => fetchTicketUIState<T>(ticketId, scope),
    enabled,
  })
}

export function useSaveTicketUIState() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ ticketId, scope, data }: { ticketId: number; scope: string; data: unknown }) =>
      saveTicketUIState(ticketId, scope, data),
    onSuccess: (result, variables) => {
      queryClient.setQueryData<TicketUIStateResponse<unknown>>(
        ['ticket-ui-state', variables.ticketId, variables.scope],
        () => ({
          scope: variables.scope,
          exists: true,
          data: variables.data,
          updatedAt: result.updatedAt,
        }),
      )
    },
  })
}

// ─── Interview Batch Types & Hooks ───

interface BatchQuestion {
  id: string
  question: string
  phase?: string
  priority?: string
  rationale?: string
}

interface BatchData {
  questions: BatchQuestion[]
  progress: { current: number; total: number }
  isComplete: boolean
  isFinalFreeForm: boolean
  aiCommentary: string
  batchNumber: number
}

interface InterviewBatchResponse {
  batch: BatchData | null
  status: 'ok' | 'no_batch' | 'parse_error'
}

async function fetchInterviewBatch(ticketId: number): Promise<InterviewBatchResponse> {
  const res = await fetch(`/api/tickets/${ticketId}/interview-batch`)
  if (!res.ok) throw new Error('Failed to fetch interview batch')
  return res.json()
}

async function submitBatch(
  ticketId: number,
  answers: Record<string, string>,
): Promise<BatchData> {
  const res = await fetch(`/api/tickets/${ticketId}/answer-batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers }),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error || 'Failed to submit batch')
  }
  return res.json()
}

export function useInterviewBatch(ticketId: number) {
  return useQuery({
    queryKey: ['interview-batch', ticketId],
    queryFn: () => fetchInterviewBatch(ticketId),
  })
}

export function useSubmitBatch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ ticketId, answers }: { ticketId: number; answers: Record<string, string> }) =>
      submitBatch(ticketId, answers),
    onSuccess: (data, variables) => {
      // Update batch cache with returned data
      queryClient.setQueryData<InterviewBatchResponse>(
        ['interview-batch', variables.ticketId],
        { batch: data, status: 'ok' },
      )
      queryClient.invalidateQueries({ queryKey: ['tickets'] })
      queryClient.invalidateQueries({ queryKey: ['ticket', variables.ticketId] })
      queryClient.invalidateQueries({ queryKey: ['ticket-ui-state', variables.ticketId, 'interview_qa'] })
    },
  })
}

export type { Ticket, CreateTicketInput, InterviewQuestion, InterviewData, TicketUIStateResponse, BatchQuestion, BatchData }
