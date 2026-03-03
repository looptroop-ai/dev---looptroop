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
  category: string
  question: string
  priority: 'critical' | 'high' | 'medium' | 'low'
  rationale: string
}

interface InterviewData {
  questions: InterviewQuestion[]
  raw: string | null
}

async function fetchInterview(ticketId: number): Promise<InterviewData> {
  const res = await fetch(`/api/tickets/${ticketId}/interview`)
  if (!res.ok) throw new Error('Failed to fetch interview data')
  return res.json()
}

async function submitAnswers(ticketId: number, answers: Record<string, string>): Promise<{ message: string }> {
  const res = await fetch(`/api/tickets/${ticketId}/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers }),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error || 'Failed to submit answers')
  }
  return res.json()
}

async function skipInterview(ticketId: number): Promise<{ message: string }> {
  const res = await fetch(`/api/tickets/${ticketId}/skip`, { method: 'POST' })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error || 'Failed to skip')
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
  return useQuery({
    queryKey: ['ticket', id],
    queryFn: () => fetchTicket(id!),
    enabled: id !== null,
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
      submitAnswers(ticketId, answers),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] })
      queryClient.invalidateQueries({ queryKey: ['ticket', variables.ticketId] })
      queryClient.invalidateQueries({ queryKey: ['interview', variables.ticketId] })
    },
  })
}

export function useSkipInterview() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ ticketId }: { ticketId: number }) =>
      skipInterview(ticketId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] })
      queryClient.invalidateQueries({ queryKey: ['ticket', variables.ticketId] })
      queryClient.invalidateQueries({ queryKey: ['interview', variables.ticketId] })
    },
  })
}

export type { Ticket, CreateTicketInput, InterviewQuestion, InterviewData }
