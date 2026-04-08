import { useCallback, useEffect, useMemo, useState } from 'react'
import { encode } from 'gpt-tokenizer'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { FileText, Loader2 } from 'lucide-react'
import { ErrorBoundary } from '@/components/shared/ErrorBoundary'
import { getModelDisplayName } from '@/components/shared/modelBadgeUtils'
import { normalizeTicketArtifact, useTicketArtifacts, type DBartifact } from '@/hooks/useTicketArtifacts'
import {
  buildCouncilMemberArtifacts,
  buildFullAnswerMemberArtifacts,
  getCouncilAction,
} from './councilArtifacts'
import type { ArtifactDef, CouncilOutcome, ViewingArtifact, ViewingArtifactSelection } from './phaseArtifactTypes'
import {
  tryParseCouncilResult,
  extractDraftDetail,
  extractCompiledInterviewDetail,
  extractCanonicalInterviewDetail,
  buildFinalInterviewArtifactContent,
  buildFinalRefinementArtifactContent,
  buildCoverageArtifactContent,
  getArtifactTargetPhases,
  parseRefinementArtifact,
  resolveStaticArtifact,
  shouldCollapseVotingMemberArtifacts,
} from './phaseArtifactTypes'
import {
  buildUiArtifactCompanionArtifactType,
} from '@shared/artifactCompanions'
import {
  mergeDraftArtifactContent,
  mergeVoteArtifactContent,
  unwrapArtifactCompanionPayloadContent,
} from './artifactCompanionUtils'
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
  const supplementalArtifacts = useMemo(() => getSupplementalArtifacts(phase, isCompleted), [phase, isCompleted])
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
  const fullAnswerArtifacts = useMemo(
    () => buildFullAnswerMemberArtifacts(phase, dbArtifacts, configuredMembers, councilMemberCount),
    [configuredMembers, councilMemberCount, dbArtifacts, phase],
  )
  const action = getCouncilAction(phase)
  const collapseVotingMemberArtifacts = shouldCollapseVotingMemberArtifacts(phase)
  const targetPhases = useMemo(() => getArtifactTargetPhases(phase), [phase])
  const findExactArtifact = useCallback((artifactType: string, phases: string[] = targetPhases) => (
    reversedArtifacts.find((artifact) => phases.includes(artifact.phase) && artifact.artifactType === artifactType)
  ), [reversedArtifacts, targetPhases])
  const findCompanionArtifact = useCallback((baseArtifactType: string, phases: string[] = targetPhases) => (
    reversedArtifacts.find((artifact) => (
      phases.includes(artifact.phase)
      && artifact.artifactType === buildUiArtifactCompanionArtifactType(baseArtifactType)
    ))
      ?? reversedArtifacts.find((artifact) => artifact.artifactType === buildUiArtifactCompanionArtifactType(baseArtifactType))
  ), [reversedArtifacts, targetPhases])

  const findDbContent = useCallback((artifactDef: ArtifactDef): string | null => {
    if (artifactDef.id === 'winner-draft') {
      const voteArtifact = findExactArtifact('interview_votes')
      const voteCompanion = findCompanionArtifact('interview_votes')
      const draftArtifact = findExactArtifact('interview_drafts')
      const draftCompanion = findCompanionArtifact('interview_drafts')
      const mergedDraftContent = mergeDraftArtifactContent(draftArtifact?.content, draftCompanion?.content)
      return mergeVoteArtifactContent(voteArtifact?.content, voteCompanion?.content, mergedDraftContent)
        ?? voteArtifact?.content
        ?? null
    }

    if (artifactDef.id === 'winner-prd-draft') {
      const voteArtifact = findExactArtifact('prd_votes')
      const voteCompanion = findCompanionArtifact('prd_votes')
      const draftArtifact = findExactArtifact('prd_drafts')
      const draftCompanion = findCompanionArtifact('prd_drafts')
      const mergedDraftContent = mergeDraftArtifactContent(draftArtifact?.content, draftCompanion?.content)
      return mergeVoteArtifactContent(voteArtifact?.content, voteCompanion?.content, mergedDraftContent)
        ?? voteArtifact?.content
        ?? null
    }

    if (artifactDef.id === 'winner-beads-draft') {
      const voteArtifact = findExactArtifact('beads_votes')
      const voteCompanion = findCompanionArtifact('beads_votes')
      const draftArtifact = findExactArtifact('beads_drafts')
      const draftCompanion = findCompanionArtifact('beads_drafts')
      const mergedDraftContent = mergeDraftArtifactContent(draftArtifact?.content, draftCompanion?.content)
      return mergeVoteArtifactContent(voteArtifact?.content, voteCompanion?.content, mergedDraftContent)
        ?? voteArtifact?.content
        ?? null
    }

    if (artifactDef.id === 'vote-details') {
      const baseArtifactType = phase.includes('PRD')
        ? 'prd_votes'
        : phase.includes('BEADS')
          ? 'beads_votes'
          : 'interview_votes'
      const draftArtifactType = phase.includes('PRD')
        ? 'prd_drafts'
        : phase.includes('BEADS')
          ? 'beads_drafts'
          : 'interview_drafts'
      const voteArtifact = findExactArtifact(baseArtifactType)
      const voteCompanion = findCompanionArtifact(baseArtifactType)
      const draftArtifact = findExactArtifact(draftArtifactType)
      const draftCompanion = findCompanionArtifact(draftArtifactType)
      const mergedDraftContent = mergeDraftArtifactContent(draftArtifact?.content, draftCompanion?.content)
      return mergeVoteArtifactContent(voteArtifact?.content, voteCompanion?.content, mergedDraftContent)
        ?? voteArtifact?.content
        ?? null
    }

    if (artifactDef.id === 'final-interview') {
      if (phase === 'VERIFYING_INTERVIEW_COVERAGE' || phase === 'WAITING_INTERVIEW_APPROVAL') {
        const coverageInputArtifact = findExactArtifact('interview_coverage_input')
        const coverageInputCompanion = findCompanionArtifact('interview_coverage_input')
        const coverageInputContent = unwrapArtifactCompanionPayloadContent(coverageInputCompanion?.content, 'interview_coverage_input')
          ?? coverageInputArtifact?.content
        if (coverageInputContent) {
          return coverageInputContent
        }
      }
      const voteArtifact = reversedArtifacts.find((artifact) => artifact.phase === 'COUNCIL_VOTING_INTERVIEW' && artifact.artifactType === 'interview_votes')
      const voteCompanion = reversedArtifacts.find((artifact) => artifact.phase === 'COUNCIL_VOTING_INTERVIEW' && artifact.artifactType === buildUiArtifactCompanionArtifactType('interview_votes'))
      const draftArtifact = reversedArtifacts.find((artifact) => artifact.phase === 'COUNCIL_DELIBERATING' && artifact.artifactType === 'interview_drafts')
      const draftCompanion = reversedArtifacts.find((artifact) => artifact.phase === 'COUNCIL_DELIBERATING' && artifact.artifactType === buildUiArtifactCompanionArtifactType('interview_drafts'))
      const mergedDraftContent = mergeDraftArtifactContent(draftArtifact?.content, draftCompanion?.content)
      const mergedVoteContent = mergeVoteArtifactContent(voteArtifact?.content, voteCompanion?.content, mergedDraftContent)
      const compiledArtifact = reversedArtifacts.find((artifact) => artifact.artifactType === 'interview_compiled')
      const compiledCompanion = reversedArtifacts.find((artifact) => artifact.artifactType === buildUiArtifactCompanionArtifactType('interview_compiled'))
      const winnerArtifact = reversedArtifacts.find((artifact) => artifact.artifactType === 'interview_winner')
      const uiDiffArtifact = reversedArtifacts.find((artifact) => artifact.artifactType === 'ui_refinement_diff:interview')
      return buildFinalInterviewArtifactContent(
        mergedVoteContent ?? voteArtifact?.content,
        compiledArtifact?.content,
        uiDiffArtifact?.content,
        compiledCompanion?.content,
        winnerArtifact?.content,
      )
    }

    if (artifactDef.id === 'refined-prd') {
      const coverageArtifact = findExactArtifact('prd_coverage_input')
      const coverageCompanion = findCompanionArtifact('prd_coverage_input')
      const coverageReviewArtifact = findExactArtifact('prd_coverage')
      const coverageReviewCompanion = findCompanionArtifact('prd_coverage')
      const revisionArtifact = findExactArtifact('prd_coverage_revision')
      const revisionCompanion = findCompanionArtifact('prd_coverage_revision')
      const refinedArtifact = findExactArtifact('prd_refined')
      const refinedCompanion = findCompanionArtifact('prd_refined')
      const winnerArtifact = findExactArtifact('prd_winner')
      const uiDiffArtifact = findExactArtifact('ui_refinement_diff:prd')
      const coverageInputContent = unwrapArtifactCompanionPayloadContent(coverageCompanion?.content, 'prd_coverage_input')
        ?? coverageArtifact?.content
      const coverageReviewContent = buildCoverageArtifactContent(coverageReviewArtifact?.content, coverageReviewCompanion?.content)
        ?? coverageReviewArtifact?.content
      const latestRevisionContent = unwrapArtifactCompanionPayloadContent(revisionCompanion?.content, 'prd_coverage_revision')
        ?? revisionArtifact?.content
      return buildFinalRefinementArtifactContent(
        refinedArtifact?.content,
        uiDiffArtifact?.content,
        coverageInputContent,
        refinedCompanion?.content,
        winnerArtifact?.content,
        latestRevisionContent,
        coverageReviewContent,
      )
        ?? latestRevisionContent
        ?? coverageInputContent
        ?? refinedArtifact?.content
        ?? null
    }

    if (artifactDef.id === 'final-prd-draft') {
      const refinedArtifact = findExactArtifact('prd_refined')
      const refinedCompanion = findCompanionArtifact('prd_refined')
      const winnerArtifact = findExactArtifact('prd_winner')
      const uiDiffArtifact = findExactArtifact('ui_refinement_diff:prd')
      return buildFinalRefinementArtifactContent(
        refinedArtifact?.content,
        uiDiffArtifact?.content,
        undefined,
        refinedCompanion?.content,
        winnerArtifact?.content,
      )
        ?? refinedArtifact?.content
        ?? null
    }

    if (artifactDef.id === 'coverage-report') {
      const baseArtifactType = phase.includes('BEADS') ? 'beads_coverage' : 'prd_coverage'
      const coverageArtifact = findExactArtifact(baseArtifactType)
      const coverageCompanion = findCompanionArtifact(baseArtifactType)
      return buildCoverageArtifactContent(coverageArtifact?.content, coverageCompanion?.content)
        ?? coverageArtifact?.content
        ?? null
    }

    if (artifactDef.id === 'refined-beads') {
      const coverageArtifact = findExactArtifact('beads_coverage_input')
      const coverageCompanion = findCompanionArtifact('beads_coverage_input')
      const coverageReviewArtifact = findExactArtifact('beads_coverage')
      const coverageReviewCompanion = findCompanionArtifact('beads_coverage')
      const revisionArtifact = findExactArtifact('beads_coverage_revision')
      const revisionCompanion = findCompanionArtifact('beads_coverage_revision')
      const refinedArtifact = findExactArtifact('beads_expanded') ?? findExactArtifact('beads_refined')
      const refinedCompanion = findCompanionArtifact('beads_expanded') ?? findCompanionArtifact('beads_refined')
      const winnerArtifact = findExactArtifact('beads_winner')
      const uiDiffArtifact = findExactArtifact('ui_refinement_diff:beads')
      const coverageInputContent = unwrapArtifactCompanionPayloadContent(coverageCompanion?.content, 'beads_coverage_input')
        ?? coverageArtifact?.content
      const coverageReviewContent = buildCoverageArtifactContent(coverageReviewArtifact?.content, coverageReviewCompanion?.content)
        ?? coverageReviewArtifact?.content
      const latestRevisionContent = unwrapArtifactCompanionPayloadContent(revisionCompanion?.content, 'beads_coverage_revision')
        ?? revisionArtifact?.content
      return buildFinalRefinementArtifactContent(
        refinedArtifact?.content,
        uiDiffArtifact?.content,
        coverageInputContent,
        refinedCompanion?.content,
        winnerArtifact?.content,
        latestRevisionContent,
        coverageReviewContent,
      )
        ?? latestRevisionContent
        ?? coverageInputContent
        ?? refinedArtifact?.content
        ?? null
    }

    if (artifactDef.id === 'final-beads-draft') {
      const refinedArtifact = findExactArtifact('beads_expanded') ?? findExactArtifact('beads_refined')
      const refinedCompanion = findCompanionArtifact('beads_expanded') ?? findCompanionArtifact('beads_refined')
      const winnerArtifact = findExactArtifact('beads_winner')
      const uiDiffArtifact = findExactArtifact('ui_refinement_diff:beads')
      return buildFinalRefinementArtifactContent(
        refinedArtifact?.content,
        uiDiffArtifact?.content,
        undefined,
        refinedCompanion?.content,
        winnerArtifact?.content,
      )
        ?? refinedArtifact?.content
        ?? null
    }
    const match = resolveStaticArtifact(artifactDef, phase, reversedArtifacts)
    return match?.content ?? null
  }, [findCompanionArtifact, findExactArtifact, phase, reversedArtifacts])

  const displayedSupplementalArtifacts = useMemo(() => {
    const baseArtifacts = supplementalArtifacts.map((artifact) => {
      if (artifact.id === 'final-prd-draft') {
        return {
          ...artifact,
          label: 'PRD Candidate v1',
          description: 'Initial PRD candidate consolidated from the winning draft',
        }
      }

      if (artifact.id === 'refined-prd') {
        const content = findDbContent(artifact)
        const candidateVersion = content ? parseRefinementArtifact(content)?.candidateVersion ?? 1 : 1
        return {
          ...artifact,
          label: `PRD Candidate v${candidateVersion}`,
          description: phase === 'VERIFYING_PRD_COVERAGE'
            ? 'The PRD version currently being checked.'
            : 'Latest PRD candidate awaiting approval',
        }
      }

      if (artifact.id === 'refined-beads') {
        const content = findDbContent(artifact)
        const candidateVersion = content ? parseRefinementArtifact(content)?.candidateVersion ?? 1 : 1
        return {
          ...artifact,
          label: `Implementation Plan v${candidateVersion}`,
          description: phase === 'VERIFYING_BEADS_COVERAGE'
            ? 'The implementation plan version currently being checked.'
            : 'Latest implementation plan awaiting approval',
        }
      }

      return artifact
    })

    if (phase !== 'VERIFYING_PRD_COVERAGE' && phase !== 'VERIFYING_BEADS_COVERAGE') {
      return baseArtifacts
    }

    const isBeadsCoveragePhase = phase === 'VERIFYING_BEADS_COVERAGE'
    const baseArtifactType = isBeadsCoveragePhase ? 'beads_coverage' : 'prd_coverage'
    const revisionArtifactType = isBeadsCoveragePhase ? 'beads_coverage_revision' : 'prd_coverage_revision'
    const hasCoverageReview = !!findExactArtifact(baseArtifactType)
    const hasRevision = !!findExactArtifact(revisionArtifactType) || !!findCompanionArtifact(revisionArtifactType)

    return [
      ...baseArtifacts,
      ...((hasCoverageReview || hasRevision)
        ? [{
            id: 'coverage-report',
            label: 'Coverage Report',
            description: 'Shows what each coverage pass found, what changed, and why.',
            icon: <FileText className="h-3.5 w-3.5" />,
          } satisfies ArtifactDef]
        : []),
    ]
  }, [findCompanionArtifact, findDbContent, findExactArtifact, phase, supplementalArtifacts])

  const prominentSupplementalArtifacts = collapseVotingMemberArtifacts ? displayedSupplementalArtifacts : []
  const inlineSupplementalArtifacts = collapseVotingMemberArtifacts ? [] : displayedSupplementalArtifacts

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

    if (artifact.id === 'final-prd-draft' || artifact.id === 'final-beads-draft') {
      const winnerId = parseRefinementArtifact(content)?.winnerId
      return {
        outcome: isCompleted ? 'completed' : 'pending',
        detail: winnerId ? getModelDisplayName(winnerId) : undefined,
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
      return memberArtifacts.find((artifact) => artifact.key === viewingSelection.key)?.viewer
        ?? fullAnswerArtifacts.find((artifact) => artifact.key === viewingSelection.key)?.viewer
        ?? null
    }

    const artifact = displayedSupplementalArtifacts.find((item) => item.id === viewingSelection.id)
    if (!artifact) return null

    return {
      id: artifact.id,
      label: artifact.label,
      description: artifact.description,
      content: findDbContent(artifact) ?? '',
      icon: artifact.icon,
    }
  }, [displayedSupplementalArtifacts, findDbContent, fullAnswerArtifacts, memberArtifacts, viewingSelection])

  const visibleMemberArtifacts = collapseVotingMemberArtifacts || phase === 'VERIFYING_PRD_COVERAGE' ? [] : memberArtifacts
  const compactInterviewArtifacts = phase === 'COMPILING_INTERVIEW'
  const hasTopArtifactRow = visibleMemberArtifacts.length > 0 || prominentSupplementalArtifacts.length > 0
  const hasFullAnswerRow = fullAnswerArtifacts.length > 0
  const hasArtifacts = hasTopArtifactRow || hasFullAnswerRow || inlineSupplementalArtifacts.length > 0 || Boolean(prefixElement)
  if (!hasArtifacts) return null

  const artifactsBody = phase === 'DRAFTING_PRD' ? (
    <div>
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-1">Artifacts</span>

      {hasFullAnswerRow && (
        <div className="mt-2">
          <div className="flex items-baseline gap-1.5 px-0.5 mb-0.5">
            <span className="text-[11px] font-semibold text-foreground/80">Part 1</span>
            <span className="text-[11px] text-muted-foreground">— Answering Skipped Questions</span>
          </div>
          <p className="text-[10px] text-muted-foreground mb-1.5 px-0.5">
            Each model fills in answers to questions that were skipped during the interview.
          </p>
          <div className="flex flex-row flex-wrap gap-2">
            <ArtifactList
              memberArtifacts={fullAnswerArtifacts}
              compactInterviewArtifacts={false}
              compact={true}
              onSelectMember={(key) => setViewingSelection({ kind: 'member', key })}
            />
          </div>
        </div>
      )}

      {hasFullAnswerRow && hasTopArtifactRow && (
        <div className="border-t border-border/40 my-2" />
      )}

      {hasTopArtifactRow && (
        <div className={hasFullAnswerRow ? '' : 'mt-2'}>
          <div className="flex items-baseline gap-1.5 px-0.5 mb-0.5">
            <span className="text-[11px] font-semibold text-foreground/80">Part 2</span>
            <span className="text-[11px] text-muted-foreground">— Generating PRD Drafts</span>
          </div>
          <p className="text-[10px] text-muted-foreground mb-1.5 px-0.5">
            Each council model independently generates a competing PRD draft based on the complete interview answers.
          </p>
          <div className="flex flex-row flex-wrap gap-2">
            <ArtifactList
              memberArtifacts={visibleMemberArtifacts}
              compactInterviewArtifacts={false}
              compact={true}
              onSelectMember={(key) => setViewingSelection({ kind: 'member', key })}
            />
          </div>
        </div>
      )}
    </div>
  ) : (
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

      {hasFullAnswerRow && (
        <div className={`flex flex-row flex-wrap gap-2 ${hasTopArtifactRow ? 'mt-2' : 'mt-1'}`}>
          <ArtifactList
            memberArtifacts={fullAnswerArtifacts}
            compactInterviewArtifacts={true}
            onSelectMember={(key) => setViewingSelection({ kind: 'member', key })}
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
  )

  return (
    <>
      {artifactsBody}

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
                <ErrorBoundary>
                  <ArtifactContent
                    artifactId={viewingArtifact?.id}
                    content={viewingArtifact
                      ? (viewingArtifact.content || `# ${viewingArtifact.label}\n\n${viewingArtifact.description}\n\nNo content available yet — artifact will be generated during this phase.`)
                      : ''}
                    phase={phase}
                  />
                </ErrorBoundary>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  )
}
