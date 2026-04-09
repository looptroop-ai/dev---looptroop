import { useMemo } from 'react'
import { GitBranch, GitCommitHorizontal, CheckCircle2, XCircle, FlaskConical, Blocks, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LoadingText } from '@/components/ui/LoadingText'
import { Badge } from '@/components/ui/badge'
import { useTicketArtifacts } from '@/hooks/useTicketArtifacts'
import { getArtifactTargetPhases } from './phaseArtifactTypes'
import type { Ticket } from '@/hooks/useTickets'
import { cn } from '@/lib/utils'

interface VerificationSummaryPanelProps {
  ticket: Ticket
  onVerify: () => void
  onCancel: () => void
  isPending: boolean
}

interface IntegrationReport {
  status: string
  baseBranch?: string
  preSquashHead?: string | null
  candidateCommitSha?: string | null
  mergeBase?: string | null
  commitCount?: number | null
  pushed?: boolean
  pushDeferred?: boolean
  pushError?: string | null
  message?: string
}

interface FinalTestReport {
  passed?: boolean
  status?: string
  attempt?: number
  commands?: Array<{ command: string; exitCode?: number | null; timedOut?: boolean }>
  errors?: string[]
  testFiles?: string[]
  summary?: string
}

function tryParseJson<T>(content: string | null | undefined): T | null {
  if (!content) return null
  try {
    return JSON.parse(content) as T
  } catch {
    return null
  }
}

function shortSha(sha: string | null | undefined): string {
  if (!sha) return '—'
  return sha.slice(0, 8)
}

export function VerificationSummaryPanel({ ticket, onVerify, onCancel, isPending }: VerificationSummaryPanelProps) {
  const { artifacts } = useTicketArtifacts(ticket.id)
  const targetPhases = useMemo(() => getArtifactTargetPhases('WAITING_MANUAL_VERIFICATION'), [])

  const integrationReport = useMemo(() => {
    const artifact = [...artifacts]
      .reverse()
      .find(a => targetPhases.includes(a.phase) && a.artifactType === 'integration_report')
    return tryParseJson<IntegrationReport>(artifact?.content)
  }, [artifacts, targetPhases])

  const finalTestReport = useMemo(() => {
    const artifact = [...artifacts]
      .reverse()
      .find(a => targetPhases.includes(a.phase) && a.artifactType === 'final_test_report')
    return tryParseJson<FinalTestReport>(artifact?.content)
  }, [artifacts, targetPhases])

  const runtime = ticket.runtime
  const testsPassed = runtime.finalTestStatus === 'passed'
    || finalTestReport?.passed === true
    || finalTestReport?.status === 'passed'
  const testsFailed = runtime.finalTestStatus === 'failed'
    || finalTestReport?.passed === false
    || finalTestReport?.status === 'failed'
  const commitSha = runtime.candidateCommitSha ?? integrationReport?.candidateCommitSha
  const branchName = ticket.branchName ?? ticket.externalId
  const baseBranch = runtime.baseBranch ?? integrationReport?.baseBranch ?? 'main'
  const commitCount = integrationReport?.commitCount
  const testAttempts = finalTestReport?.attempt
  const testCommandCount = finalTestReport?.commands?.length

  return (
    <div className="border-b border-border shrink-0">
      {/* Header */}
      <div className="px-4 py-3 bg-amber-50/60 dark:bg-amber-950/20">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span className="text-sm font-semibold">Manual Verification Required</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={onCancel}
              disabled={isPending}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={onVerify}
              disabled={isPending}
              className={cn(
                'text-xs',
                testsPassed && 'bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600',
              )}
            >
              {isPending ? <LoadingText text="Verifying" /> : 'Mark Verified'}
            </Button>
          </div>
        </div>
      </div>

      {/* Summary grid */}
      <div className="px-4 py-2.5 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        {/* Branch */}
        <div className="flex items-start gap-1.5">
          <GitBranch className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Branch</div>
            <div className="font-mono truncate" title={branchName}>{branchName}</div>
            <div className="text-muted-foreground">
              → <span className="font-mono">{baseBranch}</span>
            </div>
          </div>
        </div>

        {/* Commit */}
        <div className="flex items-start gap-1.5">
          <GitCommitHorizontal className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Candidate Commit</div>
            <code className="font-mono text-xs" title={commitSha ?? undefined}>{shortSha(commitSha)}</code>
            {commitCount != null && commitCount > 0 && (
              <div className="text-muted-foreground">
                {commitCount} commit{commitCount !== 1 ? 's' : ''} squashed
              </div>
            )}
          </div>
        </div>

        {/* Tests */}
        <div className="flex items-start gap-1.5">
          <FlaskConical className={cn(
            'h-3.5 w-3.5 mt-0.5 shrink-0',
            testsPassed ? 'text-green-600 dark:text-green-400' : testsFailed ? 'text-red-500' : 'text-muted-foreground',
          )} />
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Final Tests</div>
            <div className="flex items-center gap-1.5">
              {testsPassed ? (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-green-300 text-green-700 dark:border-green-700 dark:text-green-400">
                  <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />Passed
                </Badge>
              ) : testsFailed ? (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-red-300 text-red-700 dark:border-red-700 dark:text-red-400">
                  <XCircle className="h-2.5 w-2.5 mr-0.5" />Failed
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">Pending</Badge>
              )}
            </div>
            {(testAttempts != null || testCommandCount != null) && (
              <div className="text-muted-foreground">
                {testAttempts != null && `${testAttempts} attempt${testAttempts !== 1 ? 's' : ''}`}
                {testAttempts != null && testCommandCount != null && ' · '}
                {testCommandCount != null && `${testCommandCount} cmd${testCommandCount !== 1 ? 's' : ''}`}
              </div>
            )}
          </div>
        </div>

        {/* Beads */}
        <div className="flex items-start gap-1.5">
          <Blocks className={cn(
            'h-3.5 w-3.5 mt-0.5 shrink-0',
            runtime.completedBeads >= runtime.totalBeads && runtime.totalBeads > 0
              ? 'text-green-600 dark:text-green-400'
              : 'text-muted-foreground',
          )} />
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Beads</div>
            <div>
              <span className="font-semibold">{runtime.completedBeads}</span>
              <span className="text-muted-foreground">/{runtime.totalBeads}</span>
              {runtime.completedBeads >= runtime.totalBeads && runtime.totalBeads > 0 && (
                <span className="text-green-600 dark:text-green-400 ml-1">✓</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {integrationReport?.pushDeferred && (
        <div className="px-4 pb-2.5">
          <div className="text-[10px] bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 rounded px-2 py-1 text-slate-700 dark:text-slate-300">
            Remote ticket branch stays on the last bead backup until you verify. Verifying rewrites it once to this squashed candidate.
          </div>
        </div>
      )}

      {/* Push status warning */}
      {integrationReport && integrationReport.pushed === false && integrationReport.pushError && (
        <div className="px-4 pb-2.5">
          <div className="text-[10px] bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded px-2 py-1 text-amber-700 dark:text-amber-400">
            ⚠ Push to remote failed: {integrationReport.pushError}
          </div>
        </div>
      )}
    </div>
  )
}
