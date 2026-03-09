import type { ReactNode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/components/shared/Toast'
import { ProjectForm } from '../ProjectForm'

const createProjectMutate = vi.fn()

vi.mock('@/hooks/useProjects', () => ({
  useCreateProject: () => ({
    mutate: createProjectMutate,
    isPending: false,
    error: null,
  }),
  useUpdateProject: () => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  }),
  useDeleteProject: () => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  }),
}))

vi.mock('@/components/project/FolderPicker', () => ({
  FolderPicker: () => null,
}))

vi.mock('@/components/shared/DropdownPicker', () => ({
  DropdownPicker: ({ trigger }: { trigger: ReactNode }) => <>{trigger}</>,
}))

describe('ProjectForm', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    createProjectMutate.mockReset()
    vi.stubGlobal('fetch', vi.fn(async () => ({
      json: async () => ({
        isGit: true,
        status: 'valid',
        scope: 'root',
        repoRoot: '/tmp/existing-project',
        hasLoopTroopState: true,
        message: 'Existing LoopTroop project found at repository root',
        existingProject: {
          name: 'Stored Project',
          shortname: 'STR',
          icon: '📁',
          color: '#2563eb',
          ticketCounter: 4,
          ticketCount: 2,
        },
      }),
    })))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('switches to restore mode and warns about restored values', async () => {
    createProjectMutate.mockImplementation((_input, options) => {
      options?.onSuccess?.()
    })

    render(
      <ToastProvider>
        <ProjectForm onClose={() => {}} />
      </ToastProvider>,
    )

    fireEvent.change(screen.getByLabelText('Project Name'), { target: { value: 'Temporary Name' } })
    fireEvent.change(screen.getByLabelText('Short Name'), { target: { value: 'TMP' } })
    fireEvent.change(screen.getByLabelText(/Project Folder/), { target: { value: '/tmp/existing-project' } })

    await act(async () => {
      vi.advanceTimersByTime(600)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByText('Existing LoopTroop project detected')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Stored Project')).toBeInTheDocument()
    expect(screen.getAllByText('STR')).toHaveLength(2)
    expect(screen.getByText('Existing tickets: 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restore Project' })).toBeInTheDocument()

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Project Name'), { target: { value: 'Merged Project Name' } })
      fireEvent.click(screen.getByRole('button', { name: 'Restore Project' }))
      await Promise.resolve()
    })

    expect(createProjectMutate).toHaveBeenCalledWith(
      {
        name: 'Merged Project Name',
        shortname: 'STR',
        folderPath: '/tmp/existing-project',
        icon: '📁',
        color: '#2563eb',
      },
      expect.objectContaining({
        onSuccess: expect.any(Function),
      }),
    )

    expect(screen.getByText('Project restored from existing LoopTroop data.')).toBeInTheDocument()
  })
})
