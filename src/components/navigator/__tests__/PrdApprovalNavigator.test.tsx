import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { buildPrdDocumentYaml, getPrdUserStoryAnchorId } from '@/lib/prdDocument'
import { makePrdDocument, TEST } from '@/test/factories'
import { renderWithProviders, createTestQueryClient } from '@/test/renderHelpers'
import { PrdApprovalNavigator } from '../PrdApprovalNavigator'

function renderNavigatorWithContent(ui: React.ReactElement, content: string) {
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(['artifact', TEST.ticketId, 'prd'], content)

  return renderWithProviders(ui, { queryClient })
}

describe('PrdApprovalNavigator', () => {
  it('renders the PRD outline, removes interview shortcuts, and dispatches PRD focus events', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
    const content = buildPrdDocumentYaml(makePrdDocument())

    renderNavigatorWithContent(<PrdApprovalNavigator ticketId={TEST.ticketId} />, content)

    await waitFor(() => {
      expect(screen.getByText('Product')).toBeInTheDocument()
    })

    expect(screen.getByText(`${TEST.epicId} · Test epic`)).toBeInTheDocument()
    expect(screen.getByText(`${TEST.storyId} · As a user, I can perform the test action.`)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Interview summary/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Foundation$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Structure$/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Product').closest('button')!)

    const prdFocusEvent = dispatchSpy.mock.calls
      .map(([event]) => event)
      .find((event) => event.type === 'looptroop:prd-approval-focus') as CustomEvent<{ ticketId: string; anchorId: string }> | undefined

    expect(prdFocusEvent?.detail).toEqual({
      ticketId: TEST.ticketId,
      anchorId: 'prd-product',
    })

    fireEvent.click(screen.getByText(`${TEST.storyId} · As a user, I can perform the test action.`).closest('button')!)

    const prdStoryFocusEvent = dispatchSpy.mock.calls
      .map(([event]) => event)
      .find((event) => event.type === 'looptroop:prd-approval-focus' && (event as CustomEvent<{ ticketId: string; anchorId: string }>).detail.anchorId !== 'prd-product') as CustomEvent<{ ticketId: string; anchorId: string }> | undefined

    expect(prdStoryFocusEvent?.detail).toEqual({
      ticketId: TEST.ticketId,
      anchorId: getPrdUserStoryAnchorId(TEST.epicId, TEST.storyId),
    })
  })
})
