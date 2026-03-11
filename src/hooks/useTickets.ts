import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { clearPersistedTicketLogs } from '@/context/LogContext'
import { clearTicketArtifactsCache } from './useTicketArtifacts'
import type { WorkflowAction } from '@shared/workflowMeta'

export interface TicketRuntime {
  baseBranch: string
  currentBead: number
  completedBeads: number
  totalBeads: number
  percentComplete: number
  iterationCount: number
  maxIterations: number | null
  artifactRoot: string
  beads?: Array<{
    id: string
    title: string
    status: string
    iteration: number
  }>
  candidateCommitSha: string | null
  preSquashHead: string | null
  finalTestStatus: 'passed' | 'failed' | 'pending'
}

export interface Ticket {
  id: string
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
  lockedCouncilMembers: string[]
  availableActions: WorkflowAction[]
  previousStatus?: string | null
  runtime: TicketRuntime
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

interface TicketActionResponse {
  message: string
  ticketId: string
  status?: string
  state?: string
}

async function fetchTickets(projectId?: number): Promise<Ticket[]> {
  const url = projectId ? `/api/tickets?projectId=${projectId}` : '/api/tickets'
  const res = await fetch(url)
  if (!res.ok) throw new Error('Failed to fetch tickets')
  return res.json()
}

async function fetchTicket(id: string): Promise<Ticket> {
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

async function updateTicket(id: string, input: Partial<Pick<Ticket, 'title' | 'description' | 'priority'>>): Promise<Ticket> {
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

async function ticketAction(id: string, action: 'start' | 'approve' | 'cancel' | 'retry' | 'verify'): Promise<TicketActionResponse> {
  const res = await fetch(`/api/tickets/${id}/${action}`, { method: 'POST' })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error || `Failed to ${action} ticket`)
  }
  return res.json()
}

function patchTicketStatus(ticket: Ticket, ticketId: string, status: string): Ticket {
  if (ticket.id !== ticketId || ticket.status === status) return ticket
  return { ...ticket, status }
}

async function deleteTicket(id: string): Promise<{ success: boolean; ticketId: string }> {
  const res = await fetch(`/api/tickets/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error || 'Failed to delete ticket')
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

async function fetchInterview(ticketId: string): Promise<InterviewData> {
  const res = await fetch(`/api/tickets/${ticketId}/interview`)
  if (!res.ok) throw new Error('Failed to fetch interview data')
  return res.json()
}

async function submitAnswers(
  ticketId: string,
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
  ticketId: string,
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
  ticketId: string,
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
  ticketId: string,
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

export function useTicket(id: string | null) {
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
    mutationFn: ({ id, ...input }: { id: string } & Partial<Pick<Ticket, 'title' | 'description' | 'priority'>>) =>
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
    mutationFn: ({ id, action }: { id: string; action: 'start' | 'approve' | 'cancel' | 'retry' | 'verify' }) =>
      ticketAction(id, action),
    onSuccess: (result, variables) => {
      const nextStatus = result.state ?? result.status
      if (nextStatus) {
        const ticketId = result.ticketId || variables.id
        const status = nextStatus

        queryClient.setQueryData<Ticket | undefined>(['ticket', ticketId], (ticket) =>
          ticket ? patchTicketStatus(ticket, ticketId, status) : ticket,
        )

        queryClient.setQueriesData<Ticket[]>({ queryKey: ['tickets'] }, (tickets) => {
          if (!tickets) return tickets

          let changed = false
          const nextTickets = tickets.map((ticket) => {
            const nextTicket = patchTicketStatus(ticket, ticketId, status)
            if (nextTicket !== ticket) changed = true
            return nextTicket
          })

          return changed ? nextTickets : tickets
        })
      }

      queryClient.invalidateQueries({ queryKey: ['tickets'] })
      queryClient.invalidateQueries({ queryKey: ['ticket', variables.id] })
    },
  })
}

export function useDeleteTicket() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteTicket,
    onSuccess: (_, ticketId) => {
      queryClient.setQueriesData<Ticket[]>({ queryKey: ['tickets'] }, (tickets) =>
        tickets?.filter(ticket => ticket.id !== ticketId) ?? tickets,
      )
      queryClient.removeQueries({ queryKey: ['ticket', ticketId], exact: true })
      queryClient.removeQueries({ queryKey: ['interview', ticketId], exact: true })
      queryClient.removeQueries({ queryKey: ['interview-batch', ticketId], exact: true })
      queryClient.removeQueries({ queryKey: ['ticket-ui-state', ticketId] })
      queryClient.invalidateQueries({ queryKey: ['tickets'] })

      clearTicketArtifactsCache(ticketId)
      clearPersistedTicketLogs(ticketId)

      if (typeof window !== 'undefined') {
        localStorage.removeItem(`error-seen-${ticketId}`)
      }
    },
  })
}

export function useInterviewQuestions(ticketId: string) {
  return useQuery({
    queryKey: ['interview', ticketId],
    queryFn: () => fetchInterview(ticketId),
  })
}

export function useSubmitAnswers() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ ticketId, answers }: { ticketId: string; answers: Record<string, string> }) =>
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
    mutationFn: ({ ticketId, answers = {} }: { ticketId: string; answers?: Record<string, string> }) =>
      skipInterview(ticketId, { answers }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] })
      queryClient.invalidateQueries({ queryKey: ['ticket', variables.ticketId] })
      queryClient.invalidateQueries({ queryKey: ['interview', variables.ticketId] })
      queryClient.invalidateQueries({ queryKey: ['ticket-ui-state', variables.ticketId, 'interview_qa'] })
    },
  })
}

export function useTicketUIState<T = unknown>(ticketId: string, scope: string, enabled: boolean = true) {
  return useQuery({
    queryKey: ['ticket-ui-state', ticketId, scope],
    queryFn: () => fetchTicketUIState<T>(ticketId, scope),
    enabled,
  })
}

export function useSaveTicketUIState() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ ticketId, scope, data }: { ticketId: string; scope: string; data: unknown }) =>
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

async function fetchInterviewBatch(ticketId: string): Promise<InterviewBatchResponse> {
  const res = await fetch(`/api/tickets/${ticketId}/interview-batch`)
  if (!res.ok) throw new Error('Failed to fetch interview batch')
  return res.json()
}

async function submitBatch(
  ticketId: string,
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

export function useInterviewBatch(ticketId: string) {
  return useQuery({
    queryKey: ['interview-batch', ticketId],
    queryFn: () => fetchInterviewBatch(ticketId),
  })
}

export function useSubmitBatch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ ticketId, answers }: { ticketId: string; answers: Record<string, string> }) =>
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

export type { CreateTicketInput, InterviewQuestion, InterviewData, TicketUIStateResponse, BatchQuestion, BatchData }
