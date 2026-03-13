import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { ToastProvider } from '@/components/shared/Toast'
import { ProfileSetup } from '../ProfileSetup'
import { OPENCODE_MODELS_QUERY_KEY } from '@/hooks/useOpenCodeModels'

const updateProfileMutate = vi.fn()
const createProfileMutate = vi.fn()

const existingProfile = {
  id: 1,
  username: 'Liv',
  icon: '😀',
  background: 'SRE',
  mainImplementer: 'opencode/big-pickle',
  councilMembers: JSON.stringify(['opencode/big-pickle', 'openai/gpt-5.1-codex']),
  minCouncilQuorum: 1,
  perIterationTimeout: 1_200_000,
  councilResponseTimeout: 300_000,
  interviewQuestions: 50,
  maxIterations: 5,
  disableAnalogies: 0,
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
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: 'ok' }),
    })))
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
          <ToastProvider>
            <ProfileSetup onClose={() => undefined} />
          </ToastProvider>
        </QueryClientProvider>,
      )
      await Promise.resolve()
    })

    expect(screen.getByText('Minimum council votes required (1–4)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    expect(refetchQueriesSpy).toHaveBeenCalledWith({
      queryKey: OPENCODE_MODELS_QUERY_KEY,
      exact: true,
      type: 'active',
    })
  })
})
