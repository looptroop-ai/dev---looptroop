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
    expect(screen.getByText('To Do')).toBeInTheDocument()
    expect(screen.getByText('In Progress')).toBeInTheDocument()
    expect(screen.getByText('Needs Input')).toBeInTheDocument()
    expect(screen.getByText('Done')).toBeInTheDocument()
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
