import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { UIProvider } from '@/context/UIContext'
import { KanbanBoard } from '../KanbanBoard'
import { renderWithProviders as sharedRenderWithProviders } from '@/test/renderHelpers'

function renderWithProviders(ui: React.ReactElement) {
  return sharedRenderWithProviders(<UIProvider>{ui}</UIProvider>)
}

describe('KanbanBoard', () => {
  it('renders 4 columns', () => {
    renderWithProviders(<KanbanBoard />)
    const todo = screen.getByText('To Do')
    const needsInput = screen.getByText('Needs Input')
    const inProgress = screen.getByText('In Progress')
    const done = screen.getByText('Done')

    expect(todo).toBeInTheDocument()
    expect(needsInput).toBeInTheDocument()
    expect(inProgress).toBeInTheDocument()
    expect(done).toBeInTheDocument()
    expect(todo.compareDocumentPosition(needsInput) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(needsInput.compareDocumentPosition(inProgress) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(inProgress.compareDocumentPosition(done) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows "No tickets" in empty columns', () => {
    renderWithProviders(<KanbanBoard />)
    const noTickets = screen.getAllByText('No tickets')
    expect(noTickets.length).toBe(4)
  })

  it('shows correct column descriptions', () => {
    renderWithProviders(<KanbanBoard />)
    expect(screen.getByText('Backlog')).toBeInTheDocument()
    expect(screen.getByText('Active workflow')).toBeInTheDocument()
    expect(screen.getByText('Waiting for user')).toBeInTheDocument()
    expect(screen.getByText('Completed tickets')).toBeInTheDocument()
  })
})
