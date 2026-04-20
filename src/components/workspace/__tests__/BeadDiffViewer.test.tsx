import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BeadDiffViewer } from '../BeadDiffViewer'
import { computeLineNumbersWithWordDiff, parseDiffStats } from '../diffUtils'
import { TEST } from '@/test/factories'

function renderBeadDiffViewer() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <BeadDiffViewer ticketId={TEST.ticketId} beadId="bead-1" />
    </QueryClientProvider>,
  )
}

let fetchSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch')
})

afterEach(() => {
  fetchSpy.mockRestore()
})

describe('parseDiffStats', () => {
  it('counts files, additions and deletions from a unified diff', () => {
    const diff = [
      'diff --git a/src/foo.ts b/src/foo.ts',
      'index abc1234..def5678 100644',
      '--- a/src/foo.ts',
      '+++ b/src/foo.ts',
      '@@ -1,3 +1,4 @@',
      ' const a = 1',
      '-const b = 2',
      '+const b = 3',
      '+const c = 4',
      ' const d = 5',
      'diff --git a/src/bar.ts b/src/bar.ts',
      'index abc1234..def5678 100644',
      '--- a/src/bar.ts',
      '+++ b/src/bar.ts',
      '@@ -1,2 +1,1 @@',
      '-old line',
      ' kept line',
    ].join('\n')

    const stats = parseDiffStats(diff)
    expect(stats.files).toBe(2)
    expect(stats.additions).toBe(2)
    expect(stats.deletions).toBe(2)
  })

  it('returns zeros for empty diff', () => {
    expect(parseDiffStats('')).toEqual({ files: 0, additions: 0, deletions: 0 })
  })

  it('does not count --- and +++ header lines', () => {
    const diff = [
      'diff --git a/x.ts b/x.ts',
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ -1 +1 @@',
      '-removed',
      '+added',
    ].join('\n')

    const stats = parseDiffStats(diff)
    expect(stats.additions).toBe(1)
    expect(stats.deletions).toBe(1)
  })

  it('adds word-level segments for paired removed and added lines in a hunk', () => {
    const lines = [
      '@@ -1,2 +1,2 @@',
      '-const status = "draft"',
      '+const status = "refined"',
      ' const untouched = true',
      '-removeWholeLine()',
    ]

    const numbered = computeLineNumbersWithWordDiff(lines)

    expect(numbered[1]?.wordDiffSegments?.filter((segment) => segment.changed).map((segment) => segment.text)).toEqual(['draft'])
    expect(numbered[2]?.wordDiffSegments?.filter((segment) => segment.changed).map((segment) => segment.text)).toEqual(['refined'])
    expect(numbered[4]?.wordDiffSegments).toBeUndefined()
  })
})

describe('BeadDiffViewer', () => {
  it('shows a load error when the diff request fails', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Invalid bead ID' }), { status: 400 }),
    )

    renderBeadDiffViewer()

    expect(await screen.findByText('Could not load diff for this bead.')).toBeInTheDocument()
  })

  it('shows pending capture state only when the backend reports uncaptured diff', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({
        captured: false,
        diff: '',
      }), { status: 200 }),
    )

    renderBeadDiffViewer()

    expect(await screen.findByText('Diff not yet captured for this bead.')).toBeInTheDocument()
  })

  it('shows no code changes when the diff artifact is captured but empty', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({
        captured: true,
        diff: '',
      }), { status: 200 }),
    )

    renderBeadDiffViewer()

    expect(await screen.findByText('No code changes in this bead.')).toBeInTheDocument()
  })

  it('wraps long execution diff lines in the bead changes view', async () => {
    const longLine = '+const extremelyLongDiffIdentifierWithoutNaturalBreaks = "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890"'

    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({
        captured: true,
        diff: [
          'diff --git a/src/feature.ts b/src/feature.ts',
          'index abc1234..def5678 100644',
          '--- a/src/feature.ts',
          '+++ b/src/feature.ts',
          '@@ -1 +1 @@',
          longLine,
        ].join('\n'),
      }), { status: 200 }),
    )

    renderBeadDiffViewer()

    fireEvent.click(await screen.findByRole('button', { name: /src\/feature\.ts/i }))

    expect(screen.getByText(longLine)).toHaveClass('whitespace-pre-wrap', 'break-all')
  })
})
