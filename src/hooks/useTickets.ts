import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { clearPersistedTicketLogs } from '@/context/logUtils'
import { clearTicketArtifactsCache } from './useTicketArtifacts'
import { mergeTicketInCache, patchTicketStatusInCache } from './ticketStatusCache'
import type { WorkflowAction } from '@shared/workflowMeta'
import type { InterviewSessionSnapshot, InterviewSessionView, PersistedInterviewBatch } from '@shared/interviewSession'
import { clearErrorTicketSeen } from '@/lib/errorTicketSeen'
import type { TicketErrorOccurrence } from '@/lib/errorOccurrences'

interface TicketRuntime {
  baseBranch: string
  currentBead: number
  completedBeads: number
  totalBeads: number
  percentComplete: number
  iterationCount: number
  maxIterations: number | null
  maxIterationsPerBead: number | null
  activeBeadId: string | null
  activeBeadIteration: number | null
  lastFailedBeadId: string | null
  artifactRoot: string
  beads?: Array<{
    id: string
    title: string
    status: string
    iteration: number
    notes?: string
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
  errorSeenSignature?: string | null
  errorOccurrences?: TicketErrorOccurrence[]
  activeErrorOccurrenceId?: string | null
  hasPastErrors?: boolean
  lockedMainImplementer: string | null
  lockedMainImplementerVariant?: string | null
  lockedInterviewQuestions?: number | null
  lockedCoverageFollowUpBudgetPercent?: number | null
  lockedMaxCoveragePasses?: number | null
  lockedCouncilMembers: string[]
  lockedCouncilMemberVariants?: Record<string, string> | null
  availableActions: WorkflowAction[]
  previousStatus?: string | null
  reviewCutoffStatus: string | null
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
  ticket?: Ticket
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

async function deleteTicket(id: string): Promise<{ success: boolean; ticketId: string }> {
  const res = await fetch(`/api/tickets/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error || 'Failed to delete ticket')
  }
  return res.json()
}

async function fetchInterview(ticketId: string): Promise<InterviewSessionView> {
  const res = await fetch(`/api/tickets/${ticketId}/interview`)
  if (!res.ok) throw new Error('Failed to fetch interview data')
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
  fetchImpl: typeof fetch = fetch,
): Promise<{ success: boolean; scope: string; updatedAt: string }> {
  const res = await fetchImpl(`/api/tickets/${ticketId}/ui-state`, {
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
      if (result.ticket) {
        mergeTicketInCache<Ticket>(queryClient, result.ticket)
      }

      const nextStatus = result.state ?? result.status
      if (nextStatus) {
        const ticketId = result.ticketId || variables.id
        patchTicketStatusInCache<Ticket>(queryClient, ticketId, nextStatus)
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
      queryClient.removeQueries({ queryKey: ['ticket-ui-state', ticketId] })
      queryClient.invalidateQueries({ queryKey: ['tickets'] })

      clearTicketArtifactsCache(ticketId)
      clearPersistedTicketLogs(ticketId)

      clearErrorTicketSeen(ticketId)
    },
  })
}

export function useInterviewQuestions(ticketId: string) {
  return useQuery({
    queryKey: ['interview', ticketId],
    queryFn: () => fetchInterview(ticketId),
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
  const fetchImpl = globalThis.fetch
  return useMutation({
    mutationFn: ({ ticketId, scope, data }: { ticketId: string; scope: string; data: unknown }) =>
      saveTicketUIState(ticketId, scope, data, fetchImpl),
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

async function submitBatch(
  ticketId: string,
  answers: Record<string, string>,
  selectedOptions: Record<string, string[]> = {},
): Promise<PersistedInterviewBatch | { accepted: boolean }> {
  const res = await fetch(`/api/tickets/${ticketId}/answer-batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers, selectedOptions }),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error || 'Failed to submit batch')
  }
  return res.json()
}

async function editInterviewAnswer(
  ticketId: string,
  questionId: string,
  answer: string,
): Promise<{ success: boolean; questions: unknown[] }> {
  const res = await fetch(`/api/tickets/${ticketId}/edit-answer`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ questionId, answer }),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error || 'Failed to edit answer')
  }
  return res.json()
}

async function skipInterview(
  ticketId: string,
  answers: Record<string, string>,
): Promise<TicketActionResponse> {
  const res = await fetch(`/api/tickets/${ticketId}/skip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers }),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error || 'Failed to skip remaining interview questions')
  }
  return res.json()
}

export function useSubmitBatch() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ ticketId, answers, selectedOptions }: { ticketId: string; answers: Record<string, string>; selectedOptions?: Record<string, string[]> }) =>
      submitBatch(ticketId, answers, selectedOptions ?? {}),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] })
      queryClient.invalidateQueries({ queryKey: ['ticket', variables.ticketId] })
      queryClient.invalidateQueries({ queryKey: ['interview', variables.ticketId] })
    },
  })
}

export function useEditInterviewAnswer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ ticketId, questionId, answer }: { ticketId: string; questionId: string; answer: string }) =>
      editInterviewAnswer(ticketId, questionId, answer),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['interview', variables.ticketId] })
    },
  })
}

export function useSkipInterview() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ ticketId, answers }: { ticketId: string; answers: Record<string, string> }) =>
      skipInterview(ticketId, answers),
    onSuccess: (result, variables) => {
      if (result.ticket) {
        mergeTicketInCache<Ticket>(queryClient, result.ticket)
      }

      const nextStatus = result.state ?? result.status
      if (nextStatus) {
        patchTicketStatusInCache<Ticket>(queryClient, variables.ticketId, nextStatus)
      }

      queryClient.invalidateQueries({ queryKey: ['tickets'] })
      queryClient.invalidateQueries({ queryKey: ['ticket', variables.ticketId] })
      queryClient.invalidateQueries({ queryKey: ['interview', variables.ticketId] })
    },
  })
}

export type { CreateTicketInput, InterviewSessionSnapshot, InterviewSessionView, TicketUIStateResponse, PersistedInterviewBatch }
