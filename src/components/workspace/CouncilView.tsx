import { useMemo } from 'react'
import { Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PhaseLogPanel } from './PhaseLogPanel'
import { PhaseArtifactsPanel } from './PhaseArtifactsPanel'
import { getModelIcon, getModelDisplayName, ModelBadge } from '@/components/shared/ModelBadge'
import { useTicketArtifacts } from '@/hooks/useTicketArtifacts'

import type { Ticket } from '@/hooks/useTickets'

interface CouncilViewProps {
  phase: string
  ticket: Ticket
}

interface ModelActivityCard {
  modelName: string
  modelIcon: string
  action: string
  detail?: string
}

const COUNCIL_MEMBER_LABELS = ['Model A', 'Model B', 'Model C']

// Local model utils removed in favor of shared ones

function getStatusEmoji(outcome?: string, action?: string): string {
  if (outcome === 'timed_out') return '⏰'
  if (outcome === 'invalid_output') return '❌'
  if (outcome === 'completed') return '✅'
  if (action === 'drafting') return '✏️'
  if (action === 'scoring') return '⏳'
  if (action === 'refining') return '🔄'
  if (action === 'verifying') return '🔍'
  return '✏️'
}

function getActionLabel(phase: string): string {
  if (phase.includes('DELIBERATING')) return 'drafting'
  if (phase.includes('DRAFTING')) return 'drafting'
  if (phase.includes('VOTING')) return 'scoring'
  if (phase.includes('COMPILING') || phase.includes('REFINING')) return 'refining'
  if (phase.includes('VERIFYING')) return 'verifying'
  return 'working'
}

function getStatusLabel(outcome?: string, action?: string): string {
  if (outcome === 'timed_out') return 'Timed Out'
  if (outcome === 'invalid_output') return 'Invalid Output'
  if (outcome === 'completed') return 'Finished'
  if (action === 'drafting') return 'Drafting'
  if (action === 'scoring') return 'Scoring'
  if (action === 'refining') return 'Refining'
  if (action === 'verifying') return 'Verifying'
  return 'Working'
}

function ModelActivityCards({ phase, artifacts }: { phase: string; artifacts: any[] }) {
  const isVerifying = phase.includes('VERIFYING')
  const isDeliberating = phase.includes('DELIBERATING')

  const { councilResult, fallbackModels } = useMemo(() => {
    if (isVerifying) return { councilResult: null, fallbackModels: [] }

    const phaseArtifact = artifacts.find(a => a.phase === phase && a.content) || artifacts.find(a => (a.artifactType?.includes('votes') || a.artifactType?.includes('drafts')) && a.content)
    let result: any = null
    if (phaseArtifact?.content) {
      try {
        const parsed = JSON.parse(phaseArtifact.content)
        if (parsed.drafts || parsed.votes) result = parsed
      } catch { /* not JSON */ }
    }

    if (!result?.drafts) {
      const models = artifacts
        .filter(a => a.phase === phase)
        .map(a => {
          const content = a.content || ''
          const modelMatch = content.match(/(?:Draft|PRD Draft|Beads Breakdown)\s*—\s*(.+)/i)
          const modelName = modelMatch?.[1] || 'Unknown Model'
          const questionMatch = content.match(/(\d+)\s*(?:questions|Q)/i)
          const scoreMatch = content.match(/(\d+\.?\d*)\s*\/\s*10/i)
          let detail = ''
          if (questionMatch) detail = `proposed ${questionMatch[1]} questions`
          if (scoreMatch) detail = `scored ${scoreMatch[1]}/10`
          return {
            modelName,
            modelIcon: getModelIcon(modelName),
            action: getActionLabel(phase),
            detail,
          } satisfies ModelActivityCard
        })
      return { councilResult: null, fallbackModels: models }
    }

    return { councilResult: result, fallbackModels: [] }
  }, [phase, artifacts, isVerifying])

  // In coverage verification, do not show the council voting history cards.
  if (isVerifying) return null

  if (!councilResult?.drafts) {
    if (fallbackModels.length === 0) return null
    return (
      <div className="flex flex-wrap gap-3 mb-4">
        {fallbackModels.map((m, i) => (
          <div key={i} className="min-w-[180px] flex">
            <ModelBadge
              modelId={m.modelName}
              className="px-3 py-2 h-auto flex-1 items-start gap-2"
            >
              <div className="text-left flex-1 min-w-0">
                <div className="text-xs font-medium truncate">{m.modelName}</div>
                <div className="text-[10px] opacity-80 mt-0.5">
                  {getStatusEmoji(undefined, m.action)} {getStatusLabel(undefined, m.action)}
                </div>
                {!isDeliberating && m.detail && <div className="text-[10px] text-blue-400 mt-0.5">{m.detail}</div>}
              </div>
            </ModelBadge>
          </div>
        ))}
      </div>
    )
  }

  // Render structured model cards from CouncilResult
  const action = getActionLabel(phase)
  return (
    <div className="flex flex-wrap gap-3 mb-4">
      {councilResult.drafts.map((draft: any, i: number) => {
        const name = getModelDisplayName(draft.memberId)
        const isWinner = !isDeliberating && draft.memberId === councilResult.winnerId
        const questionCount = (draft.content?.match(/\?/g) || []).length
        const lineCount = (draft.content?.split('\n').filter((l: string) => l.trim()).length) ?? 0

        let detail = ''
        if (draft.outcome === 'timed_out') detail = 'no response received'
        else if (draft.outcome === 'invalid_output') detail = 'malformed response'
        else if (questionCount > 2) detail = `proposed ${questionCount} questions`
        else if (lineCount > 0) detail = `${lineCount} lines generated`

        // Check if this model has voting scores
        if (!isDeliberating) {
          const modelVotes = councilResult.votes?.filter((v: any) => v.draftId === draft.memberId)
          const totalVoteScore = modelVotes?.reduce((s: number, v: any) => s + v.totalScore, 0)
          if (totalVoteScore) {
            const avgScore = (totalVoteScore / (modelVotes?.length || 1)).toFixed(1)
            detail = `scored draft with ${avgScore}/10`
          }

          if (isWinner && draft.outcome === 'completed') detail = 'Winner — refining draft'
        }

        // During deliberating, only show error outcomes, not content details
        if (isDeliberating && draft.outcome !== 'timed_out' && draft.outcome !== 'invalid_output') {
          detail = ''
        }

        return (
          <div key={i} className="min-w-[180px] flex">
            <ModelBadge
              modelId={draft.memberId}
              active={isWinner}
              className="px-3 py-2 h-auto flex-1 items-start gap-2"
            >
              <div className="min-w-0 text-left flex-1">
                <div className="text-xs font-medium truncate">{name}</div>
                <div className="text-[10px] opacity-80 mt-0.5">{getStatusEmoji(draft.outcome, action)} {getStatusLabel(draft.outcome, action)}</div>
                {detail && <div className={`text-[10px] mt-0.5 ${(isWinner && draft.outcome === 'completed') ? 'text-primary-foreground/80' : 'text-blue-400'}`}>{detail}</div>}
                {isWinner && <div className="text-[10px] font-bold mt-0.5 text-primary-foreground/90">🏆 Winner</div>}
              </div>
            </ModelBadge>
          </div>
        )
      })}
    </div>
  )
}

function getCouncilStepLabel(phase: string): string {
  if (phase.includes('DELIBERATING') || phase.includes('DRAFTING')) return 'Drafting'
  if (phase.includes('VOTING')) return 'Voting'
  if (phase.includes('COMPILING') || phase.includes('REFINING')) return 'Refining'
  if (phase.includes('VERIFYING')) return 'Verifying Coverage'
  return 'Processing'
}

function getCouncilDomain(phase: string): string {
  if (phase.includes('INTERVIEW') || phase === 'COUNCIL_DELIBERATING' || phase === 'COMPILING_INTERVIEW' || phase === 'VERIFYING_INTERVIEW_COVERAGE') return 'Interview'
  if (phase.includes('PRD')) return 'PRD'
  if (phase.includes('BEADS')) return 'Beads'
  return ''
}

export function CouncilView({ phase, ticket }: CouncilViewProps) {
  const step = getCouncilStepLabel(phase)
  const domain = getCouncilDomain(phase)
  const isDrafting = step === 'Drafting'
  const isVoting = step === 'Voting'
  const { artifacts: phaseArtifacts, isLoading: isLoadingArtifacts } = useTicketArtifacts(ticket.id)
  const isVerifying = step === 'Verifying Coverage'
  const councilMemberNames = useMemo(() => {
    try { return ticket.lockedCouncilMembers ? JSON.parse(ticket.lockedCouncilMembers) as string[] : [] }
    catch { return [] }
  }, [ticket.lockedCouncilMembers])
  const councilMemberCount = councilMemberNames.length || 3

  // For coverage verification, extract winnerId from artifacts (only winner participates)
  const coverageWinnerId = useMemo(() => {
    if (!isVerifying) return null
    // Try phase-specific winner artifacts
    const winnerArtifactTypes = domain === 'Interview'
      ? ['interview_winner', 'interview_compiled', 'interview_coverage']
      : domain === 'PRD'
        ? ['prd_votes', 'prd_coverage']
        : ['beads_votes', 'beads_coverage']
    for (const art of phaseArtifacts) {
      if (winnerArtifactTypes.includes(art.artifactType)) {
        try {
          const parsed = JSON.parse(art.content!) as { winnerId?: string }
          if (parsed.winnerId) return parsed.winnerId
        } catch { /* ignore */ }
      }
    }
    return null
  }, [isVerifying, domain, phaseArtifacts])

  if (isLoadingArtifacts) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="p-4 space-y-3 shrink-0">
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              AI Council — {domain} {step}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pb-3">
            <p className="text-xs text-muted-foreground">
              {isDrafting && `Each council model is independently generating a ${domain.toLowerCase()} draft.`}
              {isVoting && `Council members are scoring all ${domain.toLowerCase()} drafts.`}
              {step === 'Refining' && `Winning model incorporates best ideas from other drafts.`}
              {step === 'Verifying Coverage' && `Winning model verifies ${domain.toLowerCase()} covers all requirements.`}
            </p>
            <div className="flex flex-wrap gap-2">
              {(isVerifying
                ? [coverageWinnerId || 'winner-resolving']
                : councilMemberNames.length > 0 ? councilMemberNames : COUNCIL_MEMBER_LABELS
              ).map((member) => {
                const memberAction = isDrafting ? 'drafting' : isVoting ? 'scoring' : step === 'Refining' ? 'refining' : isVerifying ? 'verifying' : 'drafting'
                const displayName = member === 'winner-resolving' ? 'Determining winner...' : getModelDisplayName(member)
                const isUnknown = member === 'winner-resolving'
                return (
                  <ModelBadge
                    key={member}
                    modelId={member}
                    active={isVerifying}
                    className="flex-1 min-w-[200px] px-2.5 py-1.5 h-auto items-center"
                  >
                    <span className="text-xs font-medium truncate flex-1 text-left">{displayName}</span>
                    <Badge variant="outline" className={`text-[10px] ml-auto shrink-0 whitespace-nowrap border-border/30 bg-background/20 ${isVerifying ? 'text-primary-foreground' : 'text-secondary-foreground'}`}>
                      <span className={memberAction === 'drafting' || memberAction === 'refining' ? 'inline-block animate-wiggle' : memberAction === 'scoring' || memberAction === 'verifying' ? 'inline-block animate-pulse-scale' : ''}>
                        {getStatusEmoji(undefined, memberAction)}
                      </span>
                      {' '}{getStatusLabel(undefined, memberAction)}
                    </Badge>
                    {isVerifying && !isUnknown && <div className="text-[10px] font-bold text-primary-foreground/90 ml-1">🏆</div>}
                  </ModelBadge>
                )
              })}
            </div>
          </CardContent>
        </Card>

        <PhaseArtifactsPanel
          phase={phase}
          isCompleted={false}
          ticketId={ticket.id}
          councilMemberCount={isVerifying ? 1 : councilMemberCount}
          councilMemberNames={isVerifying ? (coverageWinnerId ? [coverageWinnerId] : []) : councilMemberNames.length > 0 ? councilMemberNames : undefined}
          preloadedArtifacts={phaseArtifacts}
        />
      </div>

      <div className="flex-1 min-h-0 px-4 pb-4 flex flex-col">
        <ModelActivityCards phase={phase} artifacts={phaseArtifacts} />
        <PhaseLogPanel phase={phase} ticket={ticket} />
      </div>
    </div>
  )
}
