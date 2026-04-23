import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ToastProvider } from '@/components/shared/Toast'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ProfileSetup } from '../ProfileSetup'
import { OPENCODE_MODELS_QUERY_KEY } from '@/hooks/useOpenCodeModels'

const updateProfileMutate = vi.fn()
const createProfileMutate = vi.fn()

const existingProfile = {
  id: 1,
  mainImplementer: 'opencode/big-pickle',
  councilMembers: JSON.stringify(['opencode/big-pickle', 'openai/gpt-5.1-codex']),
  minCouncilQuorum: 1,
  perIterationTimeout: 1_200_000,
  executionSetupTimeout: 1_500_000,
  councilResponseTimeout: 1_200_000,
  interviewQuestions: 50,
  coverageFollowUpBudgetPercent: 20,
  maxCoveragePasses: 2,
  maxPrdCoveragePasses: 5,
  maxBeadsCoveragePasses: 5,
  maxIterations: 5,
  createdAt: '2026-03-08T14:28:53.309Z',
  updatedAt: '2026-03-11T10:49:38.623Z',
}

vi.mock('@/hooks/useProfile', () => ({
  useProfile: () => ({ data: existingProfile }),
  useCreateProfile: () => ({
    mutate: createProfileMutate,
    isPending: false,
    error: null,
  }),
  useUpdateProfile: () => ({
    mutate: updateProfileMutate,
    isPending: false,
    error: null,
  }),
}))

vi.mock('../ModelPicker', () => ({
  ModelPicker: ({ value, placeholder = 'Search models…' }: { value?: string; placeholder?: string }) => (
    <button type="button">{value || placeholder}</button>
  ),
}))

vi.mock('@/components/shared/DropdownPicker', () => ({
  DropdownPicker: ({ trigger }: { trigger: ReactNode }) => <>{trigger}</>,
}))

describe('ProfileSetup', () => {
  beforeEach(() => {
    updateProfileMutate.mockReset()
    createProfileMutate.mockReset()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url

      if (url === '/api/health/opencode') {
        return {
          ok: true,
          json: async () => ({ status: 'ok' }),
        }
      }

      return {
        ok: true,
        json: async () => ({
          models: [{ fullId: 'opencode/big-pickle' }],
          allModels: [{ fullId: 'opencode/big-pickle' }],
          connectedProviders: ['opencode'],
          defaultModels: {},
        }),
      }
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps single-member quorum profiles editable and shows a Save action', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity },
        mutations: { retry: false, gcTime: Infinity },
      },
    })
    const refetchQueriesSpy = vi.spyOn(queryClient, 'refetchQueries').mockResolvedValue()

    await act(async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <ToastProvider>
              <ProfileSetup onClose={() => undefined} />
            </ToastProvider>
          </TooltipProvider>
        </QueryClientProvider>,
      )
      await Promise.resolve()
    })

    expect(screen.getByText('Minimum council votes required (1–4)')).toBeInTheDocument()
    expect(screen.getByText('Coverage')).toBeInTheDocument()
    expect(screen.getByText('Coverage Follow-Up Budget (%)')).toBeInTheDocument()
    expect(screen.getByText('Interview Coverage Passes')).toBeInTheDocument()
    expect(screen.getByText('PRD Coverage Passes')).toBeInTheDocument()
    expect(screen.getByText('Beads Coverage Passes')).toBeInTheDocument()
    expect(screen.getByText('Execution Setup Timeout (s)')).toBeInTheDocument()
    expect(screen.queryByText('Profile')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Username')).not.toBeInTheDocument()
    expect(screen.queryByText('Icon')).not.toBeInTheDocument()
    expect(screen.queryByText('Background')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    await waitFor(() => {
      expect(screen.getByText('OpenCode connected and working')).toBeInTheDocument()
    })
    expect(refetchQueriesSpy).toHaveBeenCalledWith({
      queryKey: OPENCODE_MODELS_QUERY_KEY,
      exact: true,
      type: 'active',
    })
  })

  it('validates PRD and beads coverage pass inputs', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity },
        mutations: { retry: false, gcTime: Infinity },
      },
    })

    await act(async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <ToastProvider>
              <ProfileSetup onClose={() => undefined} />
            </ToastProvider>
          </TooltipProvider>
        </QueryClientProvider>,
      )
      await Promise.resolve()
    })

    const prdInput = screen.getByLabelText('PRD Coverage Passes') as HTMLInputElement
    const beadsInput = screen.getByLabelText('Beads Coverage Passes') as HTMLInputElement

    fireEvent.change(prdInput, { target: { value: '1' } })
    fireEvent.change(beadsInput, { target: { value: '21' } })

    expect(screen.getByText('Minimum is 2')).toBeInTheDocument()
    expect(screen.getByText('Maximum is 20')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })
})
