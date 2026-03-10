import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PhaseArtifactsPanel } from '../PhaseArtifactsPanel'

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  const view = render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>,
  )

  return {
    ...view,
    queryClient,
    rerenderWithProviders(nextUi: React.ReactElement) {
      view.rerender(
        <QueryClientProvider client={queryClient}>
          {nextUi}
        </QueryClientProvider>,
      )
    },
  }
}

describe('PhaseArtifactsPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('shows a single draft chip row with mixed live statuses and details', async () => {
    renderWithProviders(
      <PhaseArtifactsPanel
        phase="COUNCIL_DELIBERATING"
        isCompleted={false}
        ticketId="7:KRPI4-7"
        councilMemberNames={[
          'openai/codex-mini-latest',
          'anthropic/claude-sonnet-4',
          'google/gemini-2.5-pro',
          'openai/gpt-5-mini',
        ]}
        preloadedArtifacts={[
          {
            id: 1,
            ticketId: '7:KRPI4-7',
            phase: 'COUNCIL_DELIBERATING',
            artifactType: 'interview_drafts',
            filePath: null,
            createdAt: '2026-03-10T08:28:07.962Z',
            content: JSON.stringify({
              drafts: [
                {
                  memberId: 'openai/codex-mini-latest',
                  outcome: 'completed',
                  content: '1. Why now?\n2. How will users adopt it?\n3. What will break?',
                },
                {
                  memberId: 'anthropic/claude-sonnet-4',
                  outcome: 'failed',
                  error: 'provider offline',
                },
                {
                  memberId: 'google/gemini-2.5-pro',
                  outcome: 'timed_out',
                },
                {
                  memberId: 'openai/gpt-5-mini',
                  outcome: 'pending',
                },
              ],
            }),
          },
        ]}
      />,
    )

    expect(screen.getByRole('button', { name: /codex-mini-latest/i })).toHaveTextContent('Finished')
    expect(screen.getByRole('button', { name: /codex-mini-latest/i })).toHaveTextContent('proposed 3 questions')
    expect(screen.getByRole('button', { name: /claude-sonnet-4/i })).toHaveTextContent('Failed')
    expect(screen.getByRole('button', { name: /claude-sonnet-4/i })).toHaveTextContent('provider offline')
    expect(screen.getByRole('button', { name: /gemini-2.5-pro/i })).toHaveTextContent('Timed Out')
    expect(screen.getByRole('button', { name: /gemini-2.5-pro/i })).toHaveTextContent('no response received')
    expect(screen.getByRole('button', { name: /gpt-5-mini/i })).toHaveTextContent('Drafting')
    expect(screen.getByRole('button', { name: /gpt-5-mini/i })).toHaveTextContent('waiting for response')

    fireEvent.click(screen.getByRole('button', { name: /claude-sonnet-4/i }))
    expect(within(await screen.findByRole('dialog')).getByText('provider offline')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /close/i }))

    fireEvent.click(screen.getByRole('button', { name: /gpt-5-mini/i }))
    expect(await screen.findByText('Artifact is still being generated for this member.')).toBeInTheDocument()
  })

  it('keeps the selected council artifact synced when live artifacts update', async () => {
    const { rerenderWithProviders } = renderWithProviders(
      <PhaseArtifactsPanel
        phase="COUNCIL_DELIBERATING"
        isCompleted={false}
        ticketId="7:KRPI4-7"
        councilMemberNames={['openai/gpt-5-mini']}
        preloadedArtifacts={[
          {
            id: 1,
            ticketId: '7:KRPI4-7',
            phase: 'COUNCIL_DELIBERATING',
            artifactType: 'interview_drafts',
            filePath: null,
            createdAt: '2026-03-10T08:28:07.962Z',
            content: JSON.stringify({
              drafts: [
                {
                  memberId: 'openai/gpt-5-mini',
                  outcome: 'pending',
                  content: '',
                },
              ],
            }),
          },
        ]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /gpt-5-mini/i }))
    expect(await screen.findByText('Artifact is still being generated for this member.')).toBeInTheDocument()

    rerenderWithProviders(
      <PhaseArtifactsPanel
        phase="COUNCIL_DELIBERATING"
        isCompleted={false}
        ticketId="7:KRPI4-7"
        councilMemberNames={['openai/gpt-5-mini']}
        preloadedArtifacts={[
          {
            id: 1,
            ticketId: '7:KRPI4-7',
            phase: 'COUNCIL_DELIBERATING',
            artifactType: 'interview_drafts',
            filePath: null,
            createdAt: '2026-03-10T08:28:07.962Z',
            content: JSON.stringify({
              drafts: [
                {
                  memberId: 'openai/gpt-5-mini',
                  outcome: 'completed',
                  content: '1. What problem are we solving?\n2. How should success be measured?',
                },
              ],
            }),
          },
        ]}
      />,
    )

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('✅ Completed')).toBeInTheDocument()
    expect(within(dialog).getByText('What problem are we solving?')).toBeInTheDocument()
    expect(within(dialog).getByText('How should success be measured?')).toBeInTheDocument()
  })

  it('shows voting chips with mixed voter outcomes and keeps the winning draft accessible', async () => {
    renderWithProviders(
      <PhaseArtifactsPanel
        phase="COUNCIL_VOTING_PRD"
        isCompleted={false}
        ticketId="7:KRPI4-7"
        councilMemberNames={[
          'openai/gpt-5',
          'anthropic/claude-sonnet-4',
          'google/gemini-2.5-pro',
        ]}
        preloadedArtifacts={[
          {
            id: 2,
            ticketId: '7:KRPI4-7',
            phase: 'COUNCIL_VOTING_PRD',
            artifactType: 'prd_votes',
            filePath: null,
            createdAt: '2026-03-10T08:40:00.000Z',
            content: JSON.stringify({
              drafts: [
                { memberId: 'anthropic/claude-sonnet-4', outcome: 'completed', content: '# Winner candidate' },
                { memberId: 'google/gemini-2.5-pro', outcome: 'completed', content: '# Runner up' },
              ],
              votes: [
                {
                  voterId: 'openai/gpt-5',
                  draftId: 'anthropic/claude-sonnet-4',
                  totalScore: 9,
                  scores: [{ category: 'clarity', score: 9 }],
                },
              ],
              voterOutcomes: {
                'openai/gpt-5': 'completed',
                'anthropic/claude-sonnet-4': 'failed',
                'google/gemini-2.5-pro': 'pending',
              },
            }),
          },
        ]}
      />,
    )

    expect(screen.getByText('scored 1 drafts')).toBeInTheDocument()
    expect(screen.getByText('vote failed')).toBeInTheDocument()
    expect(screen.getByText('waiting for scores')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Winning PRD Draft/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /gpt-5/i }))

    expect(screen.getAllByText(/Failed/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Scoring/).length).toBeGreaterThan(0)
  })

  it('shows the winner refining and keeps non-winner drafts finished', () => {
    renderWithProviders(
      <PhaseArtifactsPanel
        phase="REFINING_PRD"
        isCompleted={false}
        ticketId="7:KRPI4-7"
        councilMemberNames={[
          'anthropic/claude-sonnet-4',
          'openai/gpt-5',
        ]}
        preloadedArtifacts={[
          {
            id: 2,
            ticketId: '7:KRPI4-7',
            phase: 'COUNCIL_VOTING_PRD',
            artifactType: 'prd_votes',
            filePath: null,
            createdAt: '2026-03-10T08:40:00.000Z',
            content: JSON.stringify({
              winnerId: 'anthropic/claude-sonnet-4',
              drafts: [
                { memberId: 'anthropic/claude-sonnet-4', outcome: 'completed', content: '# Winning PRD\n## Scope' },
                { memberId: 'openai/gpt-5', outcome: 'completed', content: '# Runner up PRD\n## Risks' },
              ],
              votes: [],
              voterOutcomes: {
                'anthropic/claude-sonnet-4': 'completed',
                'openai/gpt-5': 'completed',
              },
            }),
          },
          {
            id: 3,
            ticketId: '7:KRPI4-7',
            phase: 'REFINING_PRD',
            artifactType: 'prd_refined',
            filePath: null,
            createdAt: '2026-03-10T08:41:00.000Z',
            content: JSON.stringify({
              winnerId: 'anthropic/claude-sonnet-4',
              refinedContent: '# Refined PRD\n## Scope',
            }),
          },
        ]}
      />,
    )

    expect(screen.getByRole('button', { name: /claude-sonnet-4/i })).toHaveTextContent('Refining')
    expect(screen.getByRole('button', { name: /claude-sonnet-4/i })).toHaveTextContent('Winner — refining draft')
    expect(screen.getByRole('button', { name: /gpt-5/i })).toHaveTextContent('Finished')
    expect(screen.getByRole('button', { name: /gpt-5/i })).toHaveTextContent('lines generated')
  })

  it('shows the verifying winner chip and preserves coverage input artifacts', async () => {
    renderWithProviders(
      <PhaseArtifactsPanel
        phase="VERIFYING_PRD_COVERAGE"
        isCompleted={false}
        ticketId="7:KRPI4-7"
        councilMemberNames={['anthropic/claude-sonnet-4']}
        preloadedArtifacts={[
          {
            id: 3,
            ticketId: '7:KRPI4-7',
            phase: 'REFINING_PRD',
            artifactType: 'prd_refined',
            filePath: null,
            createdAt: '2026-03-10T08:41:00.000Z',
            content: JSON.stringify({
              winnerId: 'anthropic/claude-sonnet-4',
              refinedContent: '# Refined PRD\n## Scope',
            }),
          },
          {
            id: 4,
            ticketId: '7:KRPI4-7',
            phase: 'VERIFYING_PRD_COVERAGE',
            artifactType: 'prd_coverage_input',
            filePath: null,
            createdAt: '2026-03-10T08:42:00.000Z',
            content: JSON.stringify({
              prd: '# Prior PRD',
              refinedContent: '# Refined PRD',
            }),
          },
          {
            id: 5,
            ticketId: '7:KRPI4-7',
            phase: 'VERIFYING_PRD_COVERAGE',
            artifactType: 'prd_coverage',
            filePath: null,
            createdAt: '2026-03-10T08:43:00.000Z',
            content: JSON.stringify({
              winnerId: 'anthropic/claude-sonnet-4',
              response: 'Coverage complete.\nAll requirements covered.',
              hasGaps: false,
            }),
          },
        ]}
      />,
    )

    expect(screen.getByRole('button', { name: /claude-sonnet-4/i })).toHaveTextContent('Finished')
    expect(screen.getByRole('button', { name: /claude-sonnet-4/i })).toHaveTextContent('coverage complete')
    expect(screen.getByRole('button', { name: /Refined PRD/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /claude-sonnet-4/i }))
    expect(await screen.findByText('Coverage complete')).toBeInTheDocument()
    expect(screen.getByText('All requirements covered.')).toBeInTheDocument()
  })

  it('falls back to pending council members before artifacts are parseable', () => {
    renderWithProviders(
      <PhaseArtifactsPanel
        phase="DRAFTING_PRD"
        isCompleted={false}
        ticketId="7:KRPI4-7"
        councilMemberNames={[
          'anthropic/claude-sonnet-4',
          'openai/gpt-5',
        ]}
        preloadedArtifacts={[]}
      />,
    )

    expect(screen.getByRole('button', { name: /claude-sonnet-4/i })).toHaveTextContent('Drafting')
    expect(screen.getByRole('button', { name: /claude-sonnet-4/i })).toHaveTextContent('waiting for response')
    expect(screen.getByRole('button', { name: /gpt-5/i })).toHaveTextContent('Drafting')
    expect(screen.getByRole('button', { name: /gpt-5/i })).toHaveTextContent('waiting for response')
  })

  it('resolves non-council supplemental artifacts with explicit backend mappings', async () => {
    const { rerenderWithProviders } = renderWithProviders(
      <PhaseArtifactsPanel
        phase="PRE_FLIGHT_CHECK"
        isCompleted={false}
        ticketId="7:KRPI4-7"
        preloadedArtifacts={[
          {
            id: 10,
            ticketId: '7:KRPI4-7',
            phase: 'PRE_FLIGHT_CHECK',
            artifactType: 'preflight_report',
            filePath: null,
            createdAt: '2026-03-10T09:00:00.000Z',
            content: 'Doctor report ready',
          },
        ]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Doctor Diagnostics/i }))
    expect(await screen.findByText('Doctor report ready')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /close/i }))

    rerenderWithProviders(
      <PhaseArtifactsPanel
        phase="CODING"
        isCompleted={false}
        ticketId="7:KRPI4-7"
        preloadedArtifacts={[
          {
            id: 11,
            ticketId: '7:KRPI4-7',
            phase: 'CODING',
            artifactType: 'bead_execution:BEAD-1',
            filePath: null,
            createdAt: '2026-03-10T09:01:00.000Z',
            content: 'Older bead execution',
          },
          {
            id: 12,
            ticketId: '7:KRPI4-7',
            phase: 'CODING',
            artifactType: 'bead_execution:BEAD-2',
            filePath: null,
            createdAt: '2026-03-10T09:02:00.000Z',
            content: 'Latest bead execution',
          },
        ]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Bead Commits/i }))
    expect(await screen.findByText('Latest bead execution')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /close/i }))

    rerenderWithProviders(
      <PhaseArtifactsPanel
        phase="RUNNING_FINAL_TEST"
        isCompleted={false}
        ticketId="7:KRPI4-7"
        preloadedArtifacts={[
          {
            id: 13,
            ticketId: '7:KRPI4-7',
            phase: 'RUNNING_FINAL_TEST',
            artifactType: 'final_test_report',
            filePath: null,
            createdAt: '2026-03-10T09:03:00.000Z',
            content: 'Full test suite passed',
          },
        ]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Test Results/i }))
    expect(await screen.findByText('Full test suite passed')).toBeInTheDocument()
  })
})
