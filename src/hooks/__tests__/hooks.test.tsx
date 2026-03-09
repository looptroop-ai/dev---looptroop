import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { UIProvider, useUI } from '@/context/UIContext'
import type { ReactNode } from 'react'

function wrapper({ children }: { children: ReactNode }) {
  return <UIProvider>{children}</UIProvider>
}

describe('UIContext', () => {
  it('provides default state', () => {
    const { result } = renderHook(() => useUI(), { wrapper })
    expect(result.current.state.activeView).toBe('kanban')
    expect(result.current.state.selectedTicketId).toBeNull()
    expect(result.current.state.sidebarOpen).toBe(true)
  })

  it('handles SELECT_TICKET action', () => {
    const { result } = renderHook(() => useUI(), { wrapper })
    act(() => {
      result.current.dispatch({ type: 'SELECT_TICKET', ticketId: '1:TEST-1' })
    })
    expect(result.current.state.selectedTicketId).toBe('1:TEST-1')
    expect(result.current.state.activeView).toBe('ticket')
  })

  it('handles CLOSE_TICKET action', () => {
    const { result } = renderHook(() => useUI(), { wrapper })
    act(() => {
      result.current.dispatch({ type: 'SELECT_TICKET', ticketId: '1:TEST-1' })
    })
    act(() => {
      result.current.dispatch({ type: 'CLOSE_TICKET' })
    })
    expect(result.current.state.selectedTicketId).toBeNull()
    expect(result.current.state.activeView).toBe('kanban')
  })

  it('handles TOGGLE_SIDEBAR action', () => {
    const { result } = renderHook(() => useUI(), { wrapper })
    act(() => {
      result.current.dispatch({ type: 'TOGGLE_SIDEBAR' })
    })
    expect(result.current.state.sidebarOpen).toBe(false)
  })

  it('handles SET_VIEW action', () => {
    const { result } = renderHook(() => useUI(), { wrapper })
    act(() => {
      result.current.dispatch({ type: 'SET_VIEW', view: 'config' })
    })
    expect(result.current.state.activeView).toBe('config')
  })

  it('handles SET_FILTER action', () => {
    const { result } = renderHook(() => useUI(), { wrapper })
    act(() => {
      result.current.dispatch({ type: 'SET_FILTER', filter: { search: 'test' } })
    })
    expect(result.current.state.filters.search).toBe('test')
  })

  it('handles SET_THEME action', () => {
    const { result } = renderHook(() => useUI(), { wrapper })
    act(() => {
      result.current.dispatch({ type: 'SET_THEME', theme: 'dark' })
    })
    expect(result.current.state.theme).toBe('dark')
  })

  it('throws when used outside provider', () => {
    expect(() => {
      renderHook(() => useUI())
    }).toThrow('useUI must be used within UIProvider')
  })
})
