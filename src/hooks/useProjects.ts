import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { clearPersistedTicketLogs } from '@/context/logUtils'
import { clearErrorTicketSeen } from '@/lib/errorTicketSeen'
import { getTicketArtifactsQueryKey } from './useTicketArtifacts'

interface Project {
  id: number
  name: string
  shortname: string
  icon: string
  color: string
  folderPath: string
  profileId: number | null
  councilMembers: string | null
  maxIterations: number | null
  perIterationTimeout: number | null
  executionSetupTimeout: number | null
  councilResponseTimeout: number | null
  minCouncilQuorum: number | null
  interviewQuestions: number | null
  ticketCounter: number
  createdAt: string
  updatedAt: string
  latestActivityTicketExternalId?: string
}

interface ExistingProjectPreview {
  name: string
  shortname: string
  icon: string | null
  color: string | null
  ticketCounter: number
  ticketCount: number
}

interface CreateProjectInput {
  name: string
  shortname: string
  folderPath: string
  icon?: string
  color?: string
  profileId?: number
  executionSetupTimeout?: number
}

interface CachedProjectTicket {
  id: string
  projectId: number
}

function invalidateProjectQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['projects'] })
  queryClient.invalidateQueries({ queryKey: ['tickets'] })
}

function removeDeletedProjectTicketCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: number,
) {
  const cachedTicketIds = new Set<string>()
  const ticketLists = queryClient.getQueriesData<CachedProjectTicket[]>({ queryKey: ['tickets'] })

  for (const [, tickets] of ticketLists) {
    for (const ticket of tickets ?? []) {
      if (ticket.projectId === projectId) {
        cachedTicketIds.add(ticket.id)
      }
    }
  }

  queryClient.setQueriesData<CachedProjectTicket[]>({ queryKey: ['tickets'] }, (tickets) =>
    tickets?.filter((ticket) => ticket.projectId !== projectId) ?? tickets,
  )

  for (const ticketId of cachedTicketIds) {
    queryClient.removeQueries({ queryKey: ['ticket', ticketId], exact: true })
    queryClient.removeQueries({ queryKey: ['interview', ticketId], exact: true })
    queryClient.removeQueries({ queryKey: ['ticket-ui-state', ticketId] })
    queryClient.removeQueries({ queryKey: getTicketArtifactsQueryKey(ticketId), exact: true })
    clearPersistedTicketLogs(ticketId)
    clearErrorTicketSeen(ticketId)
  }
}

async function fetchProjects(): Promise<Project[]> {
  const res = await fetch('/api/projects')
  if (!res.ok) throw new Error('Failed to fetch projects')
  return res.json()
}

async function createProject(input: CreateProjectInput): Promise<Project> {
  const res = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const err = await res.json()
    const message = [err.error, err.message, err.details].filter(Boolean).join(' — ')
    throw new Error(message || 'Failed to create project')
  }
  return res.json()
}

async function updateProject(id: number, input: Partial<Pick<Project, 'name' | 'icon' | 'color' | 'executionSetupTimeout'>>): Promise<Project> {
  const res = await fetch(`/api/projects/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const err = await res.json()
    const message = [err.error, err.message, err.details].filter(Boolean).join(' — ')
    throw new Error(message || 'Failed to update project')
  }
  return res.json()
}

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: fetchProjects,
  })
}

export function useCreateProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createProject,
    onSuccess: () => {
      invalidateProjectQueries(queryClient)
    },
  })
}

export function useDeleteProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json()
        const message = [err.error, err.details].filter(Boolean).join(' — ')
        throw new Error(message || 'Failed to delete project')
      }
    },
    onSuccess: (_, projectId) => {
      removeDeletedProjectTicketCaches(queryClient, projectId)
      invalidateProjectQueries(queryClient)
    },
  })
}

export function useUpdateProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number } & Partial<Pick<Project, 'name' | 'icon' | 'color' | 'executionSetupTimeout'>>) =>
      updateProject(id, input),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['project', variables.id] })
    },
  })
}

export function useProjectWorktreesSize(projectId: number) {
  return useQuery({
    queryKey: ['project-worktrees-size', projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/worktrees/size`)
      if (!res.ok) throw new Error('Failed to fetch worktrees size')
      return res.json() as Promise<{ bytes: number }>
    },
    enabled: false,
    staleTime: 0,
  })
}

export function useDeleteProjectWorktrees() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/projects/${id}/worktrees`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json()
        const message = [err.error, err.details].filter(Boolean).join(' — ')
        throw new Error(message || 'Failed to delete worktrees')
      }
      return res.json() as Promise<{ success: boolean; freedBytes: number }>
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['tickets'] })
      queryClient.invalidateQueries({ queryKey: ['ticket'] })
    },
  })
}

export type { Project, CreateProjectInput, ExistingProjectPreview }
