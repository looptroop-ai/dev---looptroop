import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

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
  councilResponseTimeout: number | null
  minCouncilQuorum: number | null
  interviewQuestions: number | null
  ticketCounter: number
  createdAt: string
  updatedAt: string
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
}

async function fetchProjects(): Promise<Project[]> {
  const res = await fetch('/api/projects')
  if (!res.ok) throw new Error('Failed to fetch projects')
  return res.json()
}

async function fetchProject(id: number): Promise<Project> {
  const res = await fetch(`/api/projects/${id}`)
  if (!res.ok) throw new Error('Failed to fetch project')
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

async function updateProject(id: number, input: Partial<Pick<Project, 'name' | 'icon' | 'color'>>): Promise<Project> {
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

export function useProject(id: number | null) {
  return useQuery({
    queryKey: ['project', id],
    queryFn: () => fetchProject(id!),
    enabled: id !== null,
  })
}

export function useCreateProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createProject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
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
        throw new Error(err.error || 'Failed to delete project')
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

export function useUpdateProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: number } & Partial<Pick<Project, 'name' | 'icon' | 'color'>>) =>
      updateProject(id, input),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['project', variables.id] })
    },
  })
}

export type { Project, CreateProjectInput, ExistingProjectPreview }
