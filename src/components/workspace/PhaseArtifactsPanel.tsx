import { useCallback, useEffect, useMemo, useState } from 'react'
import { encode } from 'gpt-tokenizer'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Loader2 } from 'lucide-react'
import { getModelDisplayName } from '@/components/shared/modelBadgeUtils'
import { normalizeTicketArtifact, useTicketArtifacts, type DBartifact } from '@/hooks/useTicketArtifacts'
import {
  buildCouncilMemberArtifacts,
  getCouncilAction,
} from './councilArtifacts'
import type { ArtifactDef, CouncilOutcome, ViewingArtifact, ViewingArtifactSelection } from './phaseArtifactTypes'
import {
  tryParseCouncilResult,
  extractDraftDetail,
  extractCompiledInterviewDetail,
  extractCanonicalInterviewDetail,
  buildFinalInterviewArtifactContent,
  resolveStaticArtifact,
  shouldCollapseVotingMemberArtifacts,
} from './phaseArtifactTypes'
import { ArtifactContent, RawContentView, InterviewAnswersView, PrdDraftView } from './ArtifactContentViewer'
import { ArtifactList } from './ArtifactList'
import { ArtifactTypeFilter } from './ArtifactTypeFilter'
import { getSupplementalArtifacts } from './supplementalArtifacts'

// Re-export viewer components so existing imports from this module continue to work
export { RawContentView, InterviewAnswersView, PrdDraftView }

interface PhaseArtifactsPanelProps {
  phase: string
  isCompleted: boolean
  ticketId?: string
  councilMemberCount?: number
  councilMemberNames?: string[]
  prefixElement?: React.ReactNode
  preloadedArtifacts?: DBartifact[]
}

export function PhaseArtifactsPanel({ phase, isCompleted, ticketId, councilMemberCount = 3, councilMemberNames, prefixElement, preloadedArtifacts }: PhaseArtifactsPanelProps) {
  const supplementalArtifacts = useMemo(() => getSupplementalArtifacts(phase), [phase])
  const [viewingSelection, setViewingSelection] = useState<ViewingArtifactSelection | null>(null)
  const [fallbackArtifacts, setFallbackArtifacts] = useState<DBartifact[]>([])
  const hasPreloadedArtifacts = Boolean(preloadedArtifacts && preloadedArtifacts.length > 0)
  const { artifacts: cachedArtifacts, isLoading: isLoadingArtifacts } = useTicketArtifacts(ticketId, { skipFetch: hasPreloadedArtifacts })
  const normalizedCachedArtifacts = useMemo(() => cachedArtifacts ?? [], [cachedArtifacts])

  useEffect(() => {
    if (!ticketId || hasPreloadedArtifacts || normalizedCachedArtifacts.length > 0) return

    let cancelled = false
    void fetch(`/api/tickets/${ticketId}/artifacts`)
      .then(async (res) => {
        if (!res.ok) return []
        const payload = await res.json()
        if (!Array.isArray(payload)) return []
        return payload
          .map((artifact) => normalizeTicketArtifact(artifact, ticketId))
          .filter((artifact): artifact is DBartifact => artifact !== null)
      })
      .then((artifacts) => {
        if (!cancelled) setFallbackArtifacts(artifacts)
      })
      .catch(() => {
        if (!cancelled) setFallbackArtifacts([])
      })

    return () => {
      cancelled = true
    }
  }, [hasPreloadedArtifacts, normalizedCachedArtifacts.length, ticketId])

  const dbArtifacts = useMemo(
    () => (hasPreloadedArtifacts
      ? (preloadedArtifacts ?? [])
      : normalizedCachedArtifacts.length > 0
        ? normalizedCachedArtifacts
        : fallbackArtifacts),
    [fallbackArtifacts, hasPreloadedArtifacts, normalizedCachedArtifacts, preloadedArtifacts],
  )
  const reversedArtifacts = useMemo(() => [...dbArtifacts].reverse(), [dbArtifacts])
  const configuredMembers = useMemo(() => councilMemberNames ?? [], [councilMemberNames])
  const memberArtifacts = useMemo(
    () => buildCouncilMemberArtifacts(phase, dbArtifacts, configuredMembers, isCompleted, councilMemberCount),
    [configuredMembers, councilMemberCount, dbArtifacts, isCompleted, phase],
  )
  const action = getCouncilAction(phase)
  const collapseVotingMemberArtifacts = shouldCollapseVotingMemberArtifacts(phase)
  const prominentSupplementalArtifacts = collapseVotingMemberArtifacts ? supplementalArtifacts : []
  const inlineSupplementalArtifacts = collapseVotingMemberArtifacts ? [] : supplementalArtifacts

  const findDbContent = useCallback((artifactDef: ArtifactDef): string | null => {
    if (artifactDef.id === 'final-interview') {
      const finalInterviewArtifact = resolveStaticArtifact(artifactDef, phase, reversedArtifacts)
      if (finalInterviewArtifact?.artifactType === 'interview_coverage_input') {
        return finalInterviewArtifact.content
      }
      const voteArtifact = reversedArtifacts.find((artifact) => artifact.phase === 'COUNCIL_VOTING_INTERVIEW' && artifact.artifactType === 'interview_votes')
      const compiledArtifact = reversedArtifacts.find((artifact) => artifact.artifactType === 'interview_compiled')
      return buildFinalInterviewArtifactContent(voteArtifact?.content, compiledArtifact?.content)
    }
    const match = resolveStaticArtifact(artifactDef, phase, reversedArtifacts)
    return match?.content ?? null
  }, [phase, reversedArtifacts])

  function getArtifactState(artifact: ArtifactDef): { outcome?: CouncilOutcome; detail?: string } {
    const content = findDbContent(artifact)
    if (!content) return {}
    const council = tryParseCouncilResult(content)

    if (artifact.id === 'relevant-files-scan') {
      const tokenCount = encode(content).length
      return { outcome: isCompleted ? 'completed' : 'pending', detail: `${tokenCount.toLocaleString()} tokens` }
    }

    if (artifact.id.includes('winner')) {
      const winnerId = council?.winnerId
      return winnerId ? { outcome: 'completed', detail: `winner: ${getModelDisplayName(winnerId)}` } : {}
    }

    if (artifact.id.includes('vote')) {
      const voterCount = Object.keys(council?.voterOutcomes ?? {}).length
        || new Set((council?.votes ?? []).map((vote) => vote.voterId)).size
      const draftCount = new Set((council?.votes ?? []).map((vote) => vote.draftId)).size
      const detailParts: string[] = []
      if (voterCount > 0) detailParts.push(`${voterCount} voter${voterCount === 1 ? '' : 's'}`)
      if (draftCount > 0) detailParts.push(`${draftCount} draft${draftCount === 1 ? '' : 's'}`)
      return {
        outcome: council ? (council.winnerId ? 'completed' : 'pending') : undefined,
        detail: detailParts.join(' · ') || undefined,
      }
    }

    if (artifact.id === 'final-interview') {
      return {
        outcome: 'completed',
        detail: extractCompiledInterviewDetail(content) || extractCanonicalInterviewDetail(content) || undefined,
      }
    }

    if (artifact.id.includes('refined') || artifact.id.includes('answers')) {
      return { outcome: isCompleted ? 'completed' : 'pending' }
    }

    const detail = extractDraftDetail(content)
    return detail ? { detail } : {}
  }

  const viewingArtifact = useMemo<ViewingArtifact | null>(() => {
    if (!viewingSelection) return null

    if (viewingSelection.kind === 'member') {
      return memberArtifacts.find((artifact) => artifact.key === viewingSelection.key)?.viewer ?? null
    }

    const artifact = supplementalArtifacts.find((item) => item.id === viewingSelection.id)
    if (!artifact) return null

    return {
      id: artifact.id,
      label: artifact.label,
      description: artifact.description,
      content: findDbContent(artifact) ?? '',
      icon: artifact.icon,
    }
  }, [findDbContent, memberArtifacts, supplementalArtifacts, viewingSelection])

  const visibleMemberArtifacts = collapseVotingMemberArtifacts ? [] : memberArtifacts
  const compactInterviewArtifacts = phase === 'COMPILING_INTERVIEW'
  const hasTopArtifactRow = visibleMemberArtifacts.length > 0 || prominentSupplementalArtifacts.length > 0
  const hasArtifacts = hasTopArtifactRow || inlineSupplementalArtifacts.length > 0 || Boolean(prefixElement)
  if (!hasArtifacts) return null

  return (
    <>
      <div>
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-1">Artifacts</span>

        {hasTopArtifactRow && (
          <div className="flex flex-row flex-wrap gap-2 mt-1">
            <ArtifactList
              memberArtifacts={visibleMemberArtifacts}
              compactInterviewArtifacts={compactInterviewArtifacts}
              onSelectMember={(key) => setViewingSelection({ kind: 'member', key })}
            />
            <ArtifactTypeFilter
              artifacts={prominentSupplementalArtifacts}
              getArtifactState={getArtifactState}
              action={action}
              isCompleted={isCompleted}
              onSelect={(id) => setViewingSelection({ kind: 'supplemental', id })}
              variant="prominent"
            />
          </div>
        )}

        {(inlineSupplementalArtifacts.length > 0 || prefixElement) && (
          <div className={`flex flex-row flex-wrap gap-2 ${hasTopArtifactRow ? 'mt-2' : 'mt-1'}`}>
            <ArtifactTypeFilter
              artifacts={inlineSupplementalArtifacts}
              getArtifactState={getArtifactState}
              action={action}
              isCompleted={isCompleted}
              onSelect={(id) => setViewingSelection({ kind: 'supplemental', id })}
              variant="inline"
            />
            {prefixElement}
          </div>
        )}
      </div>

      <Dialog open={!!viewingArtifact} onOpenChange={(open) => !open && setViewingSelection(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              {viewingArtifact?.icon ?? null}
              {viewingArtifact?.label}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {viewingArtifact?.description ?? 'Artifact details for the current council phase.'}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="bg-muted rounded-md p-4">
              {isLoadingArtifacts ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <ArtifactContent
                  artifactId={viewingArtifact?.id}
                  content={viewingArtifact
                    ? (viewingArtifact.content || `# ${viewingArtifact.label}\n\n${viewingArtifact.description}\n\nNo content available yet — artifact will be generated during this phase.`)
                    : ''}
                  phase={phase}
                />
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  )
}
