import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

export type StartupStorageKind = 'fresh' | 'empty_existing' | 'restored'
export type StartupStorageSource = 'default' | 'LOOPTROOP_CONFIG_DIR' | 'LOOPTROOP_APP_DB_PATH'

export interface StartupStatus {
  storage: {
    kind: StartupStorageKind
    dbPath: string
    configDir: string
    source: StartupStorageSource
    profileRestored: boolean
    restoredProjectCount: number
    restoredProjects: Array<{
      name: string
      shortname: string
      folderPath: string
    }>
  }
  ui: {
    restoreNotice: {
      shouldShow: boolean
      dismissedAt: string | null
    }
  }
}

export interface DismissStartupRestoreNoticeResponse {
  success: true
  dismissedAt: string | null
}

export const STARTUP_STATUS_QUERY_KEY = ['startup-status'] as const

async function fetchStartupStatus(): Promise<StartupStatus> {
  const res = await fetch('/api/health/startup')
  if (!res.ok) throw new Error('Failed to fetch startup status')
  return res.json()
}

async function dismissStartupRestoreNotice(): Promise<DismissStartupRestoreNoticeResponse> {
  const res = await fetch('/api/health/startup/restore-notice/dismiss', {
    method: 'POST',
  })
  if (!res.ok) throw new Error('Failed to dismiss restore notice')
  return res.json()
}

export function useStartupStatus() {
  return useQuery({
    queryKey: STARTUP_STATUS_QUERY_KEY,
    queryFn: fetchStartupStatus,
    staleTime: Infinity,
  })
}

export function useDismissStartupRestoreNotice() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: dismissStartupRestoreNotice,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: STARTUP_STATUS_QUERY_KEY })
    },
  })
}
