import { useState, useEffect, useMemo } from 'react'
import { Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PhaseLogPanel } from './PhaseLogPanel'
import { PhaseArtifactsPanel } from './PhaseArtifactsPanel'
import { useProfile } from '@/hooks/useProfile'
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

function getModelIcon(name: string): string {
  const n = name.toLowerCase()
  if (n.includes('claude')) return '🟣'
  if (n.includes('gpt')) return '🟢'
  if (n.includes('gemini')) return '🔵'
  return '⚪'
}

function getModelDisplayName(id: string): string {
  return id.split('/').pop() ?? id
}

function getActionLabel(phase: string): string {
  if (phase.includes('DELIBERATING')) return 'drafting'
  if (phase.includes('DRAFTING')) return 'drafting'
  if (phase.includes('VOTING')) return 'scoring'
  if (phase.includes('COMPILING') || phase.includes('REFINING')) return 'refining'
  if (phase.includes('VERIFYING')) return 'verifying'
  return 'working'
}

function ModelActivityCards({ phase, artifacts }: { phase: string; artifacts: any[] }) {
  // Try to parse CouncilResult from artifacts for this phase
  const phaseArtifact = artifacts.find(a => a.phase === phase || a.content)
  let councilResult: any = null
  if (phaseArtifact?.content) {
    try {
      const parsed = JSON.parse(phaseArtifact.content)
      if (parsed.drafts || parsed.votes) councilResult = parsed
    } catch { /* not JSON */ }
  }

  if (!councilResult?.drafts) {
    // Fall back to regex-based extraction from raw content
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
    if (models.length === 0) return null
    return (
      <div className="flex flex-wrap gap-3 mb-4">
        {models.map((m, i) => (
          <div key={i} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 min-w-[160px]">
            <span className="text-lg">{m.modelIcon}</span>
            <div>
              <div className="text-xs font-medium">{m.modelName}</div>
              <div className="text-xs text-muted-foreground">{m.action}</div>
              {m.detail && <div className="text-xs text-blue-500">{m.detail}</div>}
            </div>
          </div>
        ))}
      </div>
    )
  }

  // Render structured model cards from CouncilResult
  const actionLabel = getActionLabel(phase)
  return (
    <div className="flex flex-wrap gap-3 mb-4">
      {councilResult.drafts.map((draft: any, i: number) => {
        const name = getModelDisplayName(draft.memberId)
        const icon = getModelIcon(draft.memberId)
        const isWinner = draft.memberId === councilResult.winnerId
        const questionCount = (draft.content?.match(/\?/g) || []).length
        const lineCount = (draft.content?.split('\n').filter((l: string) => l.trim()).length) ?? 0

        let detail = ''
        if (draft.outcome === 'timed_out') detail = 'timed out'
        else if (draft.outcome === 'invalid_output') detail = 'invalid output'
        else if (questionCount > 2) detail = `proposed ${questionCount} questions`
        else if (lineCount > 0) detail = `${lineCount} lines`

        // Check if this model has voting scores
        const modelVotes = councilResult.votes?.filter((v: any) => v.draftId === draft.memberId)
        const totalVoteScore = modelVotes?.reduce((s: number, v: any) => s + v.totalScore, 0)
        if (totalVoteScore) detail = `scored ${totalVoteScore}pts`

        return (
          <div key={i} className={`flex items-center gap-2 rounded-lg border px-3 py-2 min-w-[160px] ${isWinner ? 'border-yellow-400 dark:border-yellow-600 bg-yellow-50/50 dark:bg-yellow-950/30' : 'border-border'}`}>
            <span className="text-lg">{icon}</span>
            <div className="min-w-0">
              <div className="text-xs font-medium truncate">{name}</div>
              <div className="text-xs text-muted-foreground">{actionLabel}{draft.outcome === 'timed_out' ? ' · ⏰' : ''}</div>
              {detail && <div className="text-xs text-blue-500">{detail}</div>}
              {isWinner && <div className="text-[10px] text-yellow-600">🏆 Winner</div>}
            </div>
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
  const [phaseArtifacts, setPhaseArtifacts] = useState<any[]>([])
  const { data: profile } = useProfile()
  const councilMemberNames = useMemo(() => {
    try { return profile?.councilMembers ? JSON.parse(profile.councilMembers) as string[] : [] }
    catch { return [] }
  }, [profile?.councilMembers])
  const councilMemberCount = councilMemberNames.length || 3

  useEffect(() => {
    if (!ticket.id) return
    fetch(`/api/tickets/${ticket.id}/artifacts`)
      .then(r => r.ok ? r.json() : [])
      .then(setPhaseArtifacts)
      .catch(() => {})
  }, [ticket.id, phase])

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
              {step === 'Verifying Coverage' && `AI verifies ${domain.toLowerCase()} covers all requirements.`}
            </p>
            <div className="flex gap-2">
              {(councilMemberNames.length > 0 ? councilMemberNames : COUNCIL_MEMBER_LABELS).map((member) => (
                <div key={member} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 flex-1">
                  <span className="text-sm">{getModelIcon(member)}</span>
                  <span className="text-xs font-medium truncate">{getModelDisplayName(member)}</span>
                  <Badge variant="outline" className="text-[10px] ml-auto">
                    {isDrafting ? 'Drafting' : isVoting ? 'Scoring' : 'Working'}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <PhaseArtifactsPanel phase={phase} isCompleted={false} ticketId={ticket.id} councilMemberCount={councilMemberCount} councilMemberNames={councilMemberNames.length > 0 ? councilMemberNames : undefined} />
      </div>

      <div className="flex-1 min-h-0 px-4 pb-4 flex flex-col">
        <ModelActivityCards phase={phase} artifacts={phaseArtifacts} />
        <PhaseLogPanel phase={phase} />
      </div>
    </div>
  )
}
