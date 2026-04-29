import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelPicker } from '../ModelPicker'
import { useAllOpenCodeModels, useOpenCodeModels, type OpenCodeModel } from '@/hooks/useOpenCodeModels'

vi.mock('@/hooks/useOpenCodeModels', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useOpenCodeModels')>('@/hooks/useOpenCodeModels')
  return {
    ...actual,
    useOpenCodeModels: vi.fn(),
    useAllOpenCodeModels: vi.fn(),
  }
})

const models: OpenCodeModel[] = [
  {
    id: 'gpt-alpha',
    name: 'GPT Alpha',
    fullId: 'openai/gpt-alpha',
    providerID: 'openai',
    providerName: 'OpenAI',
    family: 'gpt',
    costInput: 1,
    costOutput: 2,
    contextWindow: 128_000,
    canReason: true,
    canSeeImages: true,
    canUseTools: true,
    status: 'stable',
  },
  {
    id: 'claude-gpt-bridge',
    name: 'Claude GPT Bridge',
    fullId: 'anthropic/claude-gpt-bridge',
    providerID: 'anthropic',
    providerName: 'Anthropic',
    family: 'claude',
    costInput: 3,
    costOutput: 15,
    contextWindow: 200_000,
    canReason: true,
    canSeeImages: false,
    canUseTools: true,
    status: 'stable',
  },
]

function mockModelsQuery(data: OpenCodeModel[] = models) {
  const result = {
    data,
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
  }

  vi.mocked(useOpenCodeModels).mockReturnValue(result as ReturnType<typeof useOpenCodeModels>)
  vi.mocked(useAllOpenCodeModels).mockReturnValue(result as ReturnType<typeof useAllOpenCodeModels>)
}

describe('ModelPicker', () => {
  beforeEach(() => {
    mockModelsQuery()
  })

  it('allows provider groups to collapse while search is active', () => {
    render(<ModelPicker value="" onChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Pick a model' }))
    fireEvent.change(screen.getByLabelText('Search models'), { target: { value: 'gpt' } })

    expect(screen.getByText('GPT Alpha')).toBeInTheDocument()

    fireEvent.click(screen.getByText('OpenAI'))

    expect(screen.queryByText('GPT Alpha')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('OpenAI'))

    expect(screen.getByText('GPT Alpha')).toBeInTheDocument()
  })
})
