import type { DBartifact } from '@/hooks/useTicketArtifacts'
import { findLatestArtifactByType, findLatestCompanionArtifact } from './artifactCompanionUtils'
import { CollapsibleSection } from './ArtifactContentViewer'
import { buildCoverageArtifactContent, parseCoverageArtifact } from './phaseArtifactTypes'

export interface CoverageApprovalWarningData {
  candidateLabel: string
  summary: string
  gaps: string[]
  auditNotes: string
}

function getCoverageCandidateLabel(domain: 'prd' | 'beads', version?: number): string {
  if (domain === 'prd') {
    return version ? `PRD Candidate v${version}` : 'current PRD candidate'
  }
  return version ? `Implementation Plan v${version}` : 'current implementation plan'
}

export function resolveCoverageApprovalWarning(
  artifacts: DBartifact[],
  domain: 'prd' | 'beads',
): CoverageApprovalWarningData | null {
  const coveragePhase = domain === 'prd'
    ? ['VERIFYING_PRD_COVERAGE', 'WAITING_PRD_APPROVAL']
    : ['VERIFYING_BEADS_COVERAGE', 'WAITING_BEADS_APPROVAL']
  const coverageArtifactType = `${domain}_coverage`
  const coverageArtifact = findLatestArtifactByType(artifacts, coverageArtifactType, coveragePhase)
  const coverageCompanionArtifact = findLatestCompanionArtifact(artifacts, coverageArtifactType, coveragePhase)
  const mergedCoverageContent = buildCoverageArtifactContent(coverageArtifact?.content, coverageCompanionArtifact?.content)
  if (!mergedCoverageContent) return null

  const parsed = parseCoverageArtifact(mergedCoverageContent)
  if (!parsed) return null

  const status = parsed.status ?? parsed.parsed?.status ?? (parsed.hasGaps ? 'gaps' : 'clean')
  const gaps = parsed.remainingGaps?.length
    ? parsed.remainingGaps
    : parsed.gaps ?? parsed.parsed?.gaps ?? []
  const hasRemainingGaps = parsed.hasRemainingGaps ?? (status === 'gaps' || gaps.length > 0)
  if (!hasRemainingGaps) return null

  const finalCandidateVersion = parsed.finalCandidateVersion ?? parsed.attempts?.[parsed.attempts.length - 1]?.candidateVersion
  const candidateLabel = getCoverageCandidateLabel(domain, finalCandidateVersion)

  return {
    candidateLabel,
    summary: parsed.summary?.trim() || `Coverage carried ${candidateLabel} forward with unresolved gaps.`,
    gaps,
    auditNotes: parsed.auditNotes ?? parsed.attempts?.[parsed.attempts.length - 1]?.auditNotes ?? '',
  }
}

export function CoverageApprovalWarning({
  warning,
}: {
  warning: CoverageApprovalWarningData
}) {
  return (
    <CollapsibleSection
      title={<span className="font-semibold">Coverage Warning</span>}
      className="border-amber-300 bg-amber-50/80 dark:border-amber-900/60 dark:bg-amber-950/20"
      triggerClassName="text-amber-950 hover:bg-amber-100/80 dark:text-amber-100 dark:hover:bg-amber-900/30"
      contentClassName="space-y-3 text-amber-950 dark:text-amber-100"
      scrollOnOpen={false}
    >
      <div className="space-y-3">
        <div className="rounded-md border border-amber-300/80 bg-background/80 px-3 py-2 text-xs dark:border-amber-800/80 dark:bg-background/30">
          {warning.summary}
        </div>

        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-300">
            Final Candidate
          </div>
          <div className="rounded-md border border-amber-300/80 bg-background/80 px-3 py-2 text-xs dark:border-amber-800/80 dark:bg-background/30">
            {warning.candidateLabel}
          </div>
        </div>

        {warning.gaps.length > 0 && (
          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-300">
              Remaining Gaps
            </div>
            <div className="space-y-2">
              {warning.gaps.map((gap, index) => (
                <div
                  key={`${gap}-${index}`}
                  className="rounded-md border border-amber-300/80 bg-background/80 px-3 py-2 text-xs dark:border-amber-800/80 dark:bg-background/30"
                >
                  {gap}
                </div>
              ))}
            </div>
          </div>
        )}

        {warning.auditNotes.trim() && (
          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-300">
              Final Audit Notes
            </div>
            <div className="rounded-md border border-amber-300/80 bg-background/80 px-3 py-2 text-xs whitespace-pre-wrap dark:border-amber-800/80 dark:bg-background/30">
              {warning.auditNotes}
            </div>
          </div>
        )}
      </div>
    </CollapsibleSection>
  )
}
