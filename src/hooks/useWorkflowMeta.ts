import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  WORKFLOW_GROUPS,
  WORKFLOW_PHASES,
  type WorkflowGroupMeta,
  type WorkflowPhaseMeta,
} from '@shared/workflowMeta'

interface WorkflowMetaResponse {
  groups: WorkflowGroupMeta[]
  phases: WorkflowPhaseMeta[]
}

async function fetchWorkflowMeta(): Promise<WorkflowMetaResponse> {
  const response = await fetch('/api/workflow/meta')
  if (!response.ok) {
    throw new Error('Failed to fetch workflow metadata')
  }
  return await response.json() as WorkflowMetaResponse
}

export function useWorkflowMeta() {
  const query = useQuery({
    queryKey: ['workflow-meta'],
    queryFn: fetchWorkflowMeta,
    initialData: {
      groups: WORKFLOW_GROUPS,
      phases: WORKFLOW_PHASES,
    },
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  })

  const groups = query.data?.groups ?? WORKFLOW_GROUPS
  const phases = query.data?.phases ?? WORKFLOW_PHASES
  const phaseMap = useMemo(
    () => Object.fromEntries(phases.map((phase) => [phase.id, phase])) as Record<string, WorkflowPhaseMeta>,
    [phases],
  )

  return {
    groups,
    phases,
    phaseMap,
    isLoading: query.isLoading,
  }
}
