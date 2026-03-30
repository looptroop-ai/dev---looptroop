import { useEffect, useRef, useState } from 'react'
import jsYaml from 'js-yaml'
import { encode } from 'gpt-tokenizer'
import { ChevronDown, ChevronRight, Trophy, Copy, Check, Lightbulb } from 'lucide-react'
import { getModelIcon, getModelDisplayName } from '@/components/shared/modelBadgeUtils'
import { ModelBadge } from '@/components/shared/ModelBadge'
import { cn } from '@/lib/utils'
import type {
  ArtifactStructuredOutputData,
  CoverageGapResolutionData,
  InterviewArtifactData,
  InterviewArtifactQuestion,
  InterviewDiffArtifactData,
  InterviewDiffEntry,
  CoverageInputData,
  CouncilResultData,
  CouncilVoterDetailData,
  CouncilOutcome,
  FinalTestExecutionReportData,
  QuestionDiffSegment,
  RelevantFileScanEntry,
  RelevantFilesScanData,
  InspirationDiffSource,
  RefinementDiffEntry,
} from './phaseArtifactTypes'
import {
  tryParseStructuredContent,
  tryParseCouncilResult,
  normalizeInterviewDiffQuestions,
  buildInterviewDiffEntries,
  buildQuestionDiffSegments,
  buildRefinementDiffEntries,
  normalizeCoverageFollowUpArtifacts,
  parseCoverageArtifact,
  parseInterviewQuestions,
  parseRefinementArtifact,
} from './phaseArtifactTypes'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import { parseInterviewDocument, normalizeInterviewDocumentLike } from '@/lib/interviewDocument'
import { InterviewDocumentView } from './InterviewDocumentView'
import {
  getCouncilStatusEmoji,
  getCouncilStatusLabel,
} from './councilArtifacts'

export function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
  className,
  headerActions,
  headerClassName,
  triggerClassName,
  contentClassName,
  scrollOnOpen = true,
}: {
  title: React.ReactNode
  defaultOpen?: boolean
  children: React.ReactNode
  className?: string
  headerActions?: React.ReactNode
  headerClassName?: string
  triggerClassName?: string
  contentClassName?: string
  scrollOnOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const sectionRef = useRef<HTMLDivElement>(null)
  const previousOpenRef = useRef(open)

  useEffect(() => {
    if (scrollOnOpen && !previousOpenRef.current && open) {
      sectionRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    }
    previousOpenRef.current = open
  }, [open, scrollOnOpen])

  return (
    <div
      ref={sectionRef}
      className={cn('border border-border rounded-md overflow-hidden flex flex-col min-w-0 w-full', className)}
    >
      <div className={cn('flex flex-wrap items-start gap-2 min-w-0', headerClassName)}>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          className={cn(
            'flex items-center gap-1.5 flex-1 min-w-0 px-3 py-2 text-xs font-medium hover:bg-accent/50 transition-colors text-left',
            triggerClassName,
          )}
        >
          {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
          <span className="min-w-0 flex-1 flex items-center">{title}</span>
        </button>
        {headerActions ? <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 py-2">{headerActions}</div> : null}
      </div>
      {open && <div className={cn('px-3 pb-3 text-xs overflow-x-auto w-full', contentClassName)}>{children}</div>}
    </div>
  )
}

export function CopyButton({ content, className = '' }: { content: string; className?: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <button
      onClick={handleCopy}
      className={`inline-flex items-center justify-center p-1 rounded hover:bg-muted transition-colors ${className}`}
      title="Copy raw output"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
    </button>
  )
}

export function WithRawTab({
  content,
  structuredLabel,
  children,
  header,
  notice,
}: {
  content: string
  structuredLabel: string
  children: React.ReactNode
  header?: React.ReactNode
  notice?: React.ReactNode
}) {
  const [activeTab, setActiveTab] = useState<'structured' | 'raw'>('structured')
  const lineCount = content.split('\n').length
  const charCount = content.length
  const tokenCount = encode(content).length

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {header && <div className="flex-1 min-w-0">{header}</div>}
        <div className={`inline-flex items-center gap-1 rounded-md border border-border bg-background p-1 shrink-0 ${!header ? 'ml-auto' : ''}`}>
          <button
            onClick={() => setActiveTab('structured')}
            className={activeTab === 'structured'
              ? 'rounded px-2.5 py-1 text-xs font-medium bg-primary text-primary-foreground'
              : 'rounded px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent/70 hover:text-foreground'}
          >
            {structuredLabel}
          </button>
          <button
            onClick={() => setActiveTab('raw')}
            className={activeTab === 'raw'
              ? 'rounded px-2.5 py-1 text-xs font-medium bg-primary text-primary-foreground'
              : 'rounded px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent/70 hover:text-foreground'}
          >
            Raw
          </button>
          {activeTab === 'raw' && <CopyButton content={content} />}
        </div>
      </div>

      {activeTab === 'raw' && (
        <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-wider">
          <span className="rounded-full border border-border bg-background px-2 py-1 text-foreground">{lineCount.toLocaleString()} Lines</span>
          <span className="rounded-full border border-border bg-background px-2 py-1 text-foreground">{charCount.toLocaleString()} Characters</span>
          <span className="rounded-full border border-border bg-background px-2 py-1 text-foreground">{tokenCount.toLocaleString()} Tokens (GPT-5 tokenizer)</span>
        </div>
      )}

      {activeTab === 'structured' ? (
        <>
          {notice}
          {children}
        </>
      ) : (
        <div className="min-w-0 w-full overflow-hidden">
          <pre className="text-[11px] font-mono bg-background rounded border border-border p-2 overflow-x-auto whitespace-pre-wrap max-h-[500px] break-all">
            {content}
          </pre>
        </div>
      )}
    </div>
  )
}

function RefinedArtifactTabs({ content, hasChanges, sectionsContent, diffContent, notice }: {
  content: string
  hasChanges: boolean
  sectionsContent: React.ReactNode
  diffContent?: React.ReactNode
  notice?: React.ReactNode
}) {
  const [activeTab, setActiveTab] = useState<'sections' | 'diff' | 'raw'>(hasChanges ? 'diff' : 'sections')
  const lineCount = content.split('\n').length
  const charCount = content.length
  const tokenCount = encode(content).length

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="inline-flex items-center gap-1 rounded-md border border-border bg-background p-1 shrink-0 ml-auto">
          <button
            onClick={() => setActiveTab('sections')}
            className={activeTab === 'sections'
              ? 'rounded px-2.5 py-1 text-xs font-medium bg-primary text-primary-foreground'
              : 'rounded px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent/70 hover:text-foreground'}
          >
            Sections
          </button>
          {hasChanges && (
            <button
              onClick={() => setActiveTab('diff')}
              className={activeTab === 'diff'
                ? 'rounded px-2.5 py-1 text-xs font-medium bg-primary text-primary-foreground'
                : 'rounded px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent/70 hover:text-foreground'}
            >
              Diff
            </button>
          )}
          <button
            onClick={() => setActiveTab('raw')}
            className={activeTab === 'raw'
              ? 'rounded px-2.5 py-1 text-xs font-medium bg-primary text-primary-foreground'
              : 'rounded px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent/70 hover:text-foreground'}
          >
            Raw
          </button>
          {activeTab === 'raw' && <CopyButton content={content} />}
        </div>
      </div>

      {activeTab === 'raw' && (
        <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-wider">
          <span className="rounded-full border border-border bg-background px-2 py-1 text-foreground">{lineCount.toLocaleString()} Lines</span>
          <span className="rounded-full border border-border bg-background px-2 py-1 text-foreground">{charCount.toLocaleString()} Characters</span>
          <span className="rounded-full border border-border bg-background px-2 py-1 text-foreground">{tokenCount.toLocaleString()} Tokens (GPT-5 tokenizer)</span>
        </div>
      )}

      {activeTab === 'sections' ? (
        <>
          {notice}
          {sectionsContent}
        </>
      ) : activeTab === 'diff' && diffContent ? (
        <>
          {notice}
          {diffContent}
        </>
      ) : activeTab === 'raw' ? (
        <div className="min-w-0 w-full overflow-hidden">
          <pre className="text-[11px] font-mono bg-background rounded border border-border p-2 overflow-x-auto whitespace-pre-wrap max-h-[500px] break-all">
            {content}
          </pre>
        </div>
      ) : null}
    </div>
  )
}

export function RawContentView({ content }: { content: string }) {
  const lines = content.split('\n')
  return (
    <div className="text-sm space-y-1">
      {lines.map((line, i) => {
        if (line.startsWith('# ')) return <h2 key={i} className="text-lg font-bold mt-3 mb-1">{line.slice(2)}</h2>
        if (line.startsWith('## ')) return <h3 key={i} className="text-base font-semibold mt-2 mb-1">{line.slice(3)}</h3>
        if (line.startsWith('### ')) return <h4 key={i} className="text-sm font-semibold mt-2">{line.slice(4)}</h4>
        if (line.startsWith('✅')) return <div key={i} className="flex items-center gap-1 text-green-600"><span>{line}</span></div>
        if (line.startsWith('⚠️')) return <div key={i} className="flex items-center gap-1 text-yellow-600"><span>{line}</span></div>
        if (line.startsWith('❌')) return <div key={i} className="flex items-center gap-1 text-red-600"><span>{line}</span></div>
        if (line.startsWith('|')) return <div key={i} className="font-mono text-xs">{line}</div>
        if (line.startsWith('- ') || line.startsWith('* ')) return <div key={i} className="ml-4">• {line.slice(2)}</div>
        if (line.match(/^\d+\./)) return <div key={i} className="ml-4">{line}</div>
        if (line.startsWith('**') && line.endsWith('**')) return <div key={i} className="font-semibold">{line.replace(/\*\*/g, '')}</div>
        if (line.trim() === '') return <div key={i} className="h-2" />
        return <div key={i}>{line}</div>
      })}
    </div>
  )
}

function RawContentWithCopy({ content }: { content: string }) {
  const lineCount = content.split('\n').length
  const charCount = content.length
  const tokenCount = encode(content).length

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <CopyButton content={content} />
        <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-wider">
          <span className="rounded-full border border-border bg-background px-2 py-1 text-foreground">{lineCount.toLocaleString()} Lines</span>
          <span className="rounded-full border border-border bg-background px-2 py-1 text-foreground">{charCount.toLocaleString()} Characters</span>
          <span className="rounded-full border border-border bg-background px-2 py-1 text-foreground">{tokenCount.toLocaleString()} Tokens (GPT-5 tokenizer)</span>
        </div>
      </div>
      <RawContentView content={content} />
    </div>
  )
}

function renderQuestionDiffSegments(segments: QuestionDiffSegment[], tone: 'added' | 'removed') {
  const highlightClassName = tone === 'removed'
    ? 'rounded-[0.2rem] bg-red-300/80 px-0.5 text-inherit dark:bg-red-500/40'
    : 'rounded-[0.2rem] bg-green-300/80 px-0.5 text-inherit dark:bg-green-500/40'

  return segments.map((segment, index) => (
    segment.changed && segment.text.trim()
      ? <mark key={`${tone}-${index}`} className={highlightClassName}>{segment.text}</mark>
      : <span key={`${tone}-${index}`}>{segment.text}</span>
  ))
}

interface InterviewAnswerViewItem {
  id: string | number
  q: string
  answer: string | null
  selectedOptions: string[]
  isSkipped: boolean
}

interface LegacyInterviewSnapshotQuestion {
  id?: string
  prompt?: string
  answerType?: string
}

interface LegacyInterviewSnapshotAnswer {
  skipped?: boolean
  answer?: string
  selectedOptionIds?: string[]
  answeredAt?: string
}

interface LegacyInterviewSnapshot {
  questions: LegacyInterviewSnapshotQuestion[]
  answers?: Record<string, LegacyInterviewSnapshotAnswer>
  artifact?: unknown
}

function isLegacyInterviewSnapshot(value: unknown): value is LegacyInterviewSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  if (!('questions' in value) || !Array.isArray(value.questions)) return false
  return !('artifact' in value)
}

function getSelectedOptionLabels(question: InterviewArtifactQuestion): string[] {
  const selectedOptionIds = Array.isArray(question.answer?.selected_option_ids)
    ? question.answer.selected_option_ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : []
  if (selectedOptionIds.length === 0) return []

  const labelMap = new Map(
    (Array.isArray(question.options) ? question.options : []).flatMap((option) => {
      if (!option || typeof option !== 'object') return []
      const id = typeof option.id === 'string' && option.id.trim().length > 0 ? option.id : null
      const label = typeof option.label === 'string' && option.label.trim().length > 0 ? option.label : null
      return id && label ? [[id, label] as const] : []
    }),
  )

  return selectedOptionIds.map((id) => labelMap.get(id) ?? id)
}

function InterviewDraftView({ content }: { content: string }) {
  const questions = parseInterviewQuestions(content)

  if (questions.length === 0) return null
  const grouped = questions.reduce<Record<string, string[]>>((acc, { q, section }) => {
    const key = section || 'Questions'
      ; (acc[key] ??= []).push(q)
    return acc
  }, {})
  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground mb-2">{questions.length} questions total</div>
      {Object.entries(grouped).map(([section, qs]) => (
        <CollapsibleSection key={section} title={<span>{section} <span className="text-muted-foreground">({qs.length})</span></span>} defaultOpen>
          <ol className="list-decimal list-inside space-y-1.5">
            {qs.map((q, i) => <li key={i} className="text-xs">{q}</li>)}
          </ol>
        </CollapsibleSection>
      ))}
    </div>
  )
}

function InterviewInspirationTooltip({ inspiration }: { inspiration: InspirationDiffSource }) {
  const modelName = inspiration.memberId ? getModelDisplayName(inspiration.memberId) : 'Unknown model'
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center justify-center h-4 w-4 rounded-sm hover:bg-accent/60 transition-colors">
            <Lightbulb className="h-3 w-3 text-amber-500" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <div className="space-y-1">
            <div className="font-medium">Inspired by {modelName}</div>
            {inspiration.question && (
              <div className="text-[11px] opacity-90 leading-snug">{inspiration.question}</div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function RefinementInspirationTooltip({ inspiration }: { inspiration: { memberId: string; sourceId?: string; sourceLabel: string; sourceText?: string } }) {
  const modelName = inspiration.memberId ? getModelDisplayName(inspiration.memberId) : 'Unknown model'
  const displayText = inspiration.sourceText?.trim() || inspiration.sourceLabel?.trim() || ''
  const showSourceIdPrefix = Boolean(inspiration.sourceId && displayText && displayText !== inspiration.sourceId)
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center justify-center h-4 w-4 rounded-sm hover:bg-accent/60 transition-colors">
            <Lightbulb className="h-3 w-3 text-amber-500" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <div className="space-y-1">
            <div className="font-medium">Inspired by {modelName}</div>
            {displayText && (
              <div className="text-[11px] opacity-90 leading-snug">
                {showSourceIdPrefix && <span className="font-mono">{inspiration.sourceId}: </span>}
                {displayText}
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

type DiffAttributionStatus = NonNullable<InterviewDiffEntry['attributionStatus'] | RefinementDiffEntry['attributionStatus']>

function getDiffAttributionCopy(status: DiffAttributionStatus): { label: string; description: string; className: string } {
  if (status === 'synthesized_unattributed') {
    return {
      label: 'Auto-detected diff',
      description: 'This diff entry was synthesized during validation because the winner and final artifacts differed, but no reliable inspiration source was recorded.',
      className: 'border-amber-200 bg-amber-50/70 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-100',
    }
  }

  if (status === 'invalid_unattributed') {
    return {
      label: 'Attribution cleared',
      description: 'This change originally carried attribution data, but that source information could not be validated and was cleared.',
      className: 'border-rose-200 bg-rose-50/70 text-rose-900 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-100',
    }
  }

  return {
    label: 'No source recorded',
    description: 'The model did not attribute this change to an alternative draft. This is common for editorial rewrites, removals, and other unattributed edits.',
    className: 'border-border bg-muted/40 text-foreground',
  }
}

function ChangeAttributionBadge({ status }: { status: DiffAttributionStatus }) {
  const copy = getDiffAttributionCopy(status)

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${copy.className}`}>
            {copy.label}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <div className="space-y-1">
            <div className="font-medium">{copy.label}</div>
            <div className="text-[11px] opacity-90 leading-snug">{copy.description}</div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function isNoOpRefinementRepairWarning(warning: string): boolean {
  return /^Dropped no-op .* refinement .* because .*?(?:identical|unchanged across the winning and final drafts)\.$/i.test(warning.trim())
}

type ArtifactProcessingKind =
  | 'artifact'
  | 'diff'
  | 'coverage'
  | 'relevant-files'
  | 'vote'
  | 'vote-aggregate'
  | 'draft'
  | 'interview-draft'
  | 'prd-draft'
  | 'beads-draft'
  | 'full-answers'
  | 'final-test'
type RepairBucket = 'no-op' | 'synthesized' | 'attribution' | 'formatting' | 'metadata' | 'generic'

interface ArtifactProcessingNoticeContext {
  affectedCount?: number
  fullAnswersOrigin?: 'reused-approved-interview'
}

interface ArtifactProcessingNoticeCopy {
  title: string
  summary: string
  body: string
  detail?: string
}

function getStructuredOutputWarnings(structuredOutput?: ArtifactStructuredOutputData): string[] {
  return (structuredOutput?.repairWarnings ?? []).filter(
    (warning): warning is string => typeof warning === 'string' && warning.trim().length > 0,
  )
}

function hasArtifactProcessingNotice(structuredOutput?: ArtifactStructuredOutputData): boolean {
  const warningCount = getStructuredOutputWarnings(structuredOutput).length
  return Boolean(
    structuredOutput
    && (
      warningCount > 0
      || (structuredOutput.autoRetryCount ?? 0) > 0
      || structuredOutput.validationError
    ),
  )
}

function mergeStructuredOutputMetadata(
  outputs: Array<ArtifactStructuredOutputData | undefined | null>,
): ArtifactStructuredOutputData | undefined {
  const present = outputs.filter((output): output is ArtifactStructuredOutputData => Boolean(output))
  if (present.length === 0) return undefined

  return present.reduce<ArtifactStructuredOutputData>((merged, output) => ({
    repairApplied: Boolean(merged.repairApplied || output.repairApplied),
    repairWarnings: [...(merged.repairWarnings ?? []), ...getStructuredOutputWarnings(output)],
    autoRetryCount: Math.max(merged.autoRetryCount ?? 0, output.autoRetryCount ?? 0),
    ...(output.validationError
      ? { validationError: output.validationError }
      : merged.validationError
        ? { validationError: merged.validationError }
        : {}),
  }), {
    repairApplied: false,
    repairWarnings: [],
    autoRetryCount: 0,
  })
}

function CollapsibleWarningNotice({
  title,
  summary,
  body,
  detail,
  defaultOpen = false,
}: {
  title: React.ReactNode
  summary?: React.ReactNode
  body?: React.ReactNode
  detail?: React.ReactNode
  defaultOpen?: boolean
}) {
  if (!summary && !body && !detail) {
    return null
  }

  return (
    <CollapsibleSection
      title={(
        <span className="flex min-w-0 flex-col items-start gap-0.5">
          <span className="font-medium">{title}</span>
          {summary ? (
            <span className="text-[11px] font-normal leading-4 opacity-80">
              {summary}
            </span>
          ) : null}
        </span>
      )}
      defaultOpen={defaultOpen}
      scrollOnOpen={false}
      className="border-amber-200 bg-amber-50/70 dark:border-amber-900/50 dark:bg-amber-950/20"
      triggerClassName="text-amber-950 hover:bg-amber-100/60 dark:text-amber-100 dark:hover:bg-amber-900/20"
      contentClassName="pt-0 text-amber-950 dark:text-amber-100"
    >
      {body ? <div className="leading-5">{body}</div> : null}
      {detail ? (
        <div className={cn('text-[11px] opacity-90 leading-5', body ? 'mt-1' : undefined)}>
          {detail}
        </div>
      ) : null}
    </CollapsibleSection>
  )
}

function classifyRepairWarning(warning: string): RepairBucket {
  const normalized = warning.trim().toLowerCase()

  if (isNoOpRefinementRepairWarning(warning)) return 'no-op'
  if (/synthesi|auto-detected|rebuilt|reconstructed|missing .*change/i.test(normalized)) return 'synthesized'
  if (/attribution|source label|source labels|source information|source info|inspiration/i.test(normalized)) return 'attribution'
  if (/wrapper|code fence|markdown|tag|marker|trailing|leading|prefix|suffix|json|yaml/i.test(normalized)) return 'formatting'
  if (/normaliz|canonical|dedup|duplicate|reorder|sort|item_type|phase|id\b|metadata|inferred|filled|trimmed empty|ignored because|approval/i.test(normalized)) return 'metadata'
  return 'generic'
}

function buildRepairBreakdownDetail(repairWarnings: string[]): string | undefined {
  if (repairWarnings.length === 0) return undefined

  const counts = repairWarnings.reduce<Record<RepairBucket, number>>((acc, warning) => {
    const bucket = classifyRepairWarning(warning)
    acc[bucket] = (acc[bucket] ?? 0) + 1
    return acc
  }, {
    'no-op': 0,
    synthesized: 0,
    attribution: 0,
    formatting: 0,
    metadata: 0,
    generic: 0,
  })

  const parts = [
    counts['no-op'] > 0 ? `${counts['no-op']} incorrect AI change note(s) ignored` : null,
    counts.synthesized > 0 ? `${counts.synthesized} missing change note(s) added` : null,
    counts.attribution > 0 ? `${counts.attribution} source label(s) fixed` : null,
    counts.formatting > 0 ? `${counts.formatting} formatting issue(s) cleaned up` : null,
    counts.metadata > 0 ? `${counts.metadata} saved detail(s) updated` : null,
    counts.generic > 0 ? `${counts.generic} output issue(s) fixed` : null,
  ].filter((part): part is string => Boolean(part))

  return parts.length > 0 ? `Adjusted details: ${parts.join('; ')}.` : undefined
}

function isReusedApprovedInterviewFullAnswersContext(context?: ArtifactProcessingNoticeContext): boolean {
  return context?.fullAnswersOrigin === 'reused-approved-interview'
}

function buildReusedApprovedInterviewDetail(repairWarnings: string[]): string | undefined {
  const parts: string[] = []

  if (repairWarnings.some((warning) => /resolved interview status from "approved" to "draft"/i.test(warning))) {
    parts.push('status switched from approved to draft')
  }
  if (repairWarnings.some((warning) => /cleared approval fields/i.test(warning))) {
    parts.push('approval fields cleared')
  }
  if (repairWarnings.some((warning) => /generated_by\.winner_model/i.test(warning))) {
    parts.push('model label updated for this model')
  }

  return parts.length > 0 ? `Adjusted details: ${parts.join('; ')}.` : undefined
}

function getArtifactProcessingStrings(kind: ArtifactProcessingKind, context?: ArtifactProcessingNoticeContext) {
  const affectedSuffix = context?.affectedCount ? ` across ${context.affectedCount} voter scorecard(s)` : ''

  switch (kind) {
    case 'diff':
      return {
        title: 'LoopTroop adjusted this diff.',
        genericRepairSummary: 'LoopTroop cleaned up this diff before showing it.',
        countedRepairSummary: (count: number) => `LoopTroop cleaned up ${count} diff detail(s) before showing it.`,
        repairBody: 'Some saved diff details did not line up with the validated artifact, so LoopTroop rebuilt the diff from the validated result. The diff below is safe to review, but some source labels may be estimated or cleared.',
        retrySummary: (count: number) => `LoopTroop needed ${count} extra validation pass(es) before this diff was ready.`,
        retryBody: 'The first diff response did not match the expected shape, so LoopTroop tried again and kept the validated result.',
      }
    case 'coverage':
      return {
        title: 'LoopTroop adjusted this coverage review.',
        genericRepairSummary: 'LoopTroop cleaned up this coverage review before showing it.',
        countedRepairSummary: (count: number) => `LoopTroop cleaned up ${count} coverage detail(s) before showing it.`,
        repairBody: 'Some coverage details needed cleanup so this review matched the expected shape. The review below is the validated result.',
        retrySummary: (count: number) => `LoopTroop needed ${count} extra validation pass(es) before this coverage review was ready.`,
        retryBody: 'The first coverage response did not match the expected shape, so LoopTroop tried again and kept the validated result.',
      }
    case 'relevant-files':
      return {
        title: 'LoopTroop adjusted this relevant files scan.',
        genericRepairSummary: 'LoopTroop cleaned up this relevant files scan before showing it.',
        countedRepairSummary: (count: number) => `LoopTroop cleaned up ${count} scan detail(s) before showing it.`,
        repairBody: 'Some relevant-file details needed cleanup so this scan matched the expected shape. The scan below is the validated result.',
        retrySummary: (count: number) => `LoopTroop needed ${count} extra validation pass(es) before this scan was ready.`,
        retryBody: 'The first relevant-files response did not match the expected shape, so LoopTroop tried again and kept the validated result.',
      }
    case 'vote':
      return {
        title: 'LoopTroop adjusted this vote scorecard.',
        genericRepairSummary: 'LoopTroop cleaned up this vote scorecard before showing it.',
        countedRepairSummary: (count: number) => `LoopTroop cleaned up ${count} scorecard detail(s) before showing it.`,
        repairBody: 'Some vote scorecard details needed cleanup so this ranking matched the expected shape. The scores below reflect the validated scorecard.',
        retrySummary: (count: number) => `LoopTroop needed ${count} extra validation pass(es) before this scorecard was ready.`,
        retryBody: 'The first scorecard did not match the expected shape, so LoopTroop tried again and kept the validated result.',
      }
    case 'vote-aggregate':
      return {
        title: 'LoopTroop adjusted some vote scorecards.',
        genericRepairSummary: `LoopTroop cleaned up one or more vote scorecards${affectedSuffix} before showing these results.`,
        countedRepairSummary: (count: number) => `LoopTroop cleaned up ${count} scorecard detail(s)${affectedSuffix} before showing these results.`,
        repairBody: 'One or more vote scorecards needed cleanup so these results matched the validated scorecards.',
        retrySummary: (count: number) => `LoopTroop needed ${count} extra validation pass(es)${affectedSuffix} before these results were ready.`,
        retryBody: 'At least one scorecard did not match the expected shape on the first pass, so LoopTroop tried again and kept the validated results.',
      }
    case 'draft':
      return {
        title: 'LoopTroop adjusted this draft.',
        genericRepairSummary: 'LoopTroop cleaned up this draft before showing it.',
        countedRepairSummary: (count: number) => `LoopTroop cleaned up ${count} draft detail(s) before showing it.`,
        repairBody: 'Some draft details needed cleanup so this draft matched the expected shape. The draft below is the validated result.',
        retrySummary: (count: number) => `LoopTroop needed ${count} extra validation pass(es) before this draft was ready.`,
        retryBody: 'The first draft response did not match the expected shape, so LoopTroop tried again and kept the validated result.',
      }
    case 'interview-draft':
      return {
        title: 'LoopTroop adjusted this interview draft.',
        genericRepairSummary: 'LoopTroop cleaned up this interview draft before showing it.',
        countedRepairSummary: (count: number) => `LoopTroop cleaned up ${count} interview draft detail(s) before showing it.`,
        repairBody: 'Some interview-draft details needed cleanup so this draft matched the expected shape. The draft below is the validated result.',
        retrySummary: (count: number) => `LoopTroop needed ${count} extra validation pass(es) before this interview draft was ready.`,
        retryBody: 'The first interview-draft response did not match the expected shape, so LoopTroop tried again and kept the validated result.',
      }
    case 'prd-draft':
      return {
        title: 'LoopTroop adjusted this PRD draft.',
        genericRepairSummary: 'LoopTroop cleaned up this PRD draft before showing it.',
        countedRepairSummary: (count: number) => `LoopTroop cleaned up ${count} PRD draft detail(s) before showing it.`,
        repairBody: 'Some PRD draft details needed cleanup so this draft matched the expected shape. The draft below is the validated result.',
        retrySummary: (count: number) => `LoopTroop needed ${count} extra validation pass(es) before this PRD draft was ready.`,
        retryBody: 'The first PRD draft response did not match the expected shape, so LoopTroop tried again and kept the validated result.',
      }
    case 'beads-draft':
      return {
        title: 'LoopTroop adjusted this blueprint draft.',
        genericRepairSummary: 'LoopTroop cleaned up this blueprint draft before showing it.',
        countedRepairSummary: (count: number) => `LoopTroop cleaned up ${count} blueprint draft detail(s) before showing it.`,
        repairBody: 'Some blueprint-draft details needed cleanup so this draft matched the expected shape. The draft below is the validated result.',
        retrySummary: (count: number) => `LoopTroop needed ${count} extra validation pass(es) before this blueprint draft was ready.`,
        retryBody: 'The first blueprint draft response did not match the expected shape, so LoopTroop tried again and kept the validated result.',
      }
    case 'full-answers':
      return {
        title: isReusedApprovedInterviewFullAnswersContext(context)
          ? 'LoopTroop reused the approved interview for these answers.'
          : 'LoopTroop adjusted these Full Answers.',
        genericRepairSummary: isReusedApprovedInterviewFullAnswersContext(context)
          ? 'No new AI answers were needed for this model. LoopTroop copied the approved interview and adjusted draft-only details.'
          : 'LoopTroop cleaned up these Full Answers before showing them.',
        countedRepairSummary: (count: number) => isReusedApprovedInterviewFullAnswersContext(context)
          ? `No new AI answers were needed for this model. LoopTroop copied the approved interview and adjusted ${count} draft-only detail(s).`
          : `LoopTroop cleaned up ${count} Full Answers detail(s) before showing them.`,
        repairBody: isReusedApprovedInterviewFullAnswersContext(context)
          ? 'This ticket had no skipped interview questions, so Part 1 did not need a model response. To keep PRD drafting consistent across models, LoopTroop copied the approved interview into a Full Answers artifact for this model and only changed draft-only fields such as status, approval, or the model label.'
          : 'Some Full Answers details needed cleanup so this artifact matched the expected shape. The answers below are the validated result.',
        retrySummary: (count: number) => `LoopTroop needed ${count} extra validation pass(es) before these answers were ready.`,
        retryBody: 'The first Full Answers response did not match the expected shape, so LoopTroop tried again and kept the validated result.',
      }
    case 'final-test':
      return {
        title: 'LoopTroop adjusted this final test plan.',
        genericRepairSummary: 'LoopTroop cleaned up this final test plan before showing it.',
        countedRepairSummary: (count: number) => `LoopTroop cleaned up ${count} final test detail(s) before showing this report.`,
        repairBody: 'Some final test plan details needed cleanup so the command plan matched the expected shape. The plan below is the validated result that LoopTroop used.',
        retrySummary: (count: number) => `LoopTroop needed ${count} extra validation pass(es) before this final test plan was ready.`,
        retryBody: 'The first command-plan response did not match the expected shape, so LoopTroop tried again and kept the validated result.',
      }
    default:
      return {
        title: 'LoopTroop adjusted this artifact.',
        genericRepairSummary: 'LoopTroop cleaned up this artifact before showing it.',
        countedRepairSummary: (count: number) => `LoopTroop cleaned up ${count} artifact detail(s) before showing it.`,
        repairBody: 'Some output details needed cleanup so this artifact matched the expected shape. The artifact below is the validated result.',
        retrySummary: (count: number) => `LoopTroop needed ${count} extra validation pass(es) before this artifact was ready.`,
        retryBody: 'The first response did not match the expected shape, so LoopTroop tried again and kept the validated result.',
      }
  }
}

export function buildArtifactProcessingNoticeCopy(
  structuredOutput?: ArtifactStructuredOutputData,
  kind: ArtifactProcessingKind = 'artifact',
  context?: ArtifactProcessingNoticeContext,
): ArtifactProcessingNoticeCopy | null {
  if (!hasArtifactProcessingNotice(structuredOutput)) return null

  const repairWarnings = getStructuredOutputWarnings(structuredOutput)
  const hasRepair = repairWarnings.length > 0
  const retryCount = structuredOutput?.autoRetryCount ?? 0
  const hasRetry = retryCount > 0 || Boolean(structuredOutput?.validationError)
  const strings = getArtifactProcessingStrings(kind, context)
  const onlyNoOpDiff = kind === 'diff' && repairWarnings.length > 0 && repairWarnings.every(isNoOpRefinementRepairWarning) && !hasRetry
  const reusedApprovedInterviewFullAnswers = kind === 'full-answers' && isReusedApprovedInterviewFullAnswersContext(context) && !hasRetry

  const summaryParts: string[] = []
  if (onlyNoOpDiff) {
    summaryParts.push(
      repairWarnings.length === 1
        ? '1 AI change note did not reflect a real change.'
        : `${repairWarnings.length} AI change notes did not reflect real changes.`,
    )
  } else if (hasRepair) {
    summaryParts.push(
      repairWarnings.length > 0
        ? strings.countedRepairSummary(repairWarnings.length)
        : strings.genericRepairSummary,
    )
  }
  if (hasRetry) {
    summaryParts.push(strings.retrySummary(Math.max(retryCount, 1)))
  }

  const detailParts = [
    reusedApprovedInterviewFullAnswers
      ? buildReusedApprovedInterviewDetail(repairWarnings)
      : buildRepairBreakdownDetail(repairWarnings),
    hasRetry
      ? `LoopTroop used ${Math.max(retryCount, 1)} extra validation pass(es) because an earlier response did not match the expected shape.`
      : undefined,
  ].filter((part): part is string => Boolean(part))

  return {
    title: onlyNoOpDiff
      ? repairWarnings.length === 1
        ? 'LoopTroop removed an incorrect AI change note.'
        : 'LoopTroop removed incorrect AI change notes.'
      : strings.title,
    summary: summaryParts.join(' '),
    body: onlyNoOpDiff
      ? 'The AI marked some items as changed even though they were unchanged. LoopTroop removed those incorrect notes so you only see validated changes.'
      : [hasRepair ? strings.repairBody : '', hasRetry ? strings.retryBody : ''].filter(Boolean).join(' '),
    ...(detailParts.length > 0 ? { detail: detailParts.join(' ') } : {}),
  }
}

function ArtifactProcessingNotice({
  structuredOutput,
  kind,
  context,
}: {
  structuredOutput?: ArtifactStructuredOutputData
  kind?: ArtifactProcessingKind
  context?: ArtifactProcessingNoticeContext
}) {
  const copy = buildArtifactProcessingNoticeCopy(structuredOutput, kind, context)
  if (!copy) {
    return null
  }

  return (
    <CollapsibleWarningNotice
      title={copy.title}
      summary={copy.summary}
      body={copy.body}
      detail={copy.detail}
    />
  )
}

function getCouncilDraftNoticeKind({
  isFullAnswers,
  isInterview,
  isPrd,
  isBeads,
}: {
  isFullAnswers: boolean
  isInterview: boolean
  isPrd: boolean
  isBeads: boolean
}): ArtifactProcessingKind {
  if (isFullAnswers) return 'full-answers'
  if (isPrd) return 'prd-draft'
  if (isBeads) return 'beads-draft'
  if (isInterview) return 'interview-draft'
  return 'draft'
}

function getFullAnswersNoticeContext(content: string): ArtifactProcessingNoticeContext | undefined {
  const document = parseInterviewDocument(content)
  if (!document) {
    return undefined
  }

  const allAnswersAreUserOwned = document.questions.every((question) => question.answer?.answered_by && question.answer.answered_by !== 'ai_skip')
  if (
    document.status === 'draft'
    && !document.approval.approved_by
    && !document.approval.approved_at
    && allAnswersAreUserOwned
  ) {
    return { fullAnswersOrigin: 'reused-approved-interview' }
  }

  return undefined
}

function RefinementDiffView({ content, domain }: { content: string; domain: 'prd' | 'beads' }) {
  const diffs = buildRefinementDiffEntries(content, domain)
  const modifiedCount = diffs.filter((d) => d.changeType === 'modified').length
  const addedCount = diffs.filter((d) => d.changeType === 'added').length
  const removedCount = diffs.filter((d) => d.changeType === 'removed').length

  if (diffs.length === 0) {
    return (
      <div className="rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
        No refinement changes recorded.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-wider">
        <span className="rounded-full border border-border bg-background px-2 py-1 text-foreground">Modified {modifiedCount}</span>
        <span className="rounded-full border border-border bg-background px-2 py-1 text-foreground">Added {addedCount}</span>
        <span className="rounded-full border border-border bg-background px-2 py-1 text-foreground">Removed {removedCount}</span>
      </div>
      <div className="space-y-2">
        {diffs.map((diff) => (
          <CollapsibleSection
            key={diff.key}
            defaultOpen
            title={(
              <span className="flex items-center gap-2">
                <span className="text-muted-foreground text-[10px] uppercase">{formatRefinementDiffItemKind(diff.itemKind)}</span>
                <span>{diff.label || diff.afterId || diff.beforeId || formatRefinementDiffItemKind(diff.itemKind)}</span>
                {(diff.afterId || diff.beforeId) && diff.label !== (diff.afterId || diff.beforeId) && (
                  <span className="font-mono text-[10px] text-muted-foreground">{diff.afterId || diff.beforeId}</span>
                )}
                <span className={diff.changeType === 'added'
                  ? 'text-green-600 dark:text-green-400'
                  : diff.changeType === 'removed'
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-blue-600 dark:text-blue-400'}
                >
                  {diff.changeType === 'modified' ? 'Modified' : diff.changeType === 'added' ? 'Added' : 'Removed'}
                </span>
                {diff.inspiration
                  ? <RefinementInspirationTooltip inspiration={diff.inspiration} />
                  : diff.attributionStatus && diff.attributionStatus !== 'inspired'
                    ? <ChangeAttributionBadge status={diff.attributionStatus} />
                    : null}
              </span>
            )}
          >
            <div className="space-y-3">
              {diff.beforeText && (
                <div className="rounded-md border border-red-200 bg-red-100/80 px-3 py-2 dark:border-red-800/60 dark:bg-red-900/30">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-red-700 dark:text-red-300">Before</div>
                  <div className="text-xs leading-5 text-red-950 dark:text-red-100 whitespace-pre-wrap">
                    {diff.beforeId && <span className="font-mono mr-1">{diff.beforeId}:</span>}
                    {renderQuestionDiffSegments(buildQuestionDiffSegments(diff.beforeText, diff.afterText).before, 'removed')}
                  </div>
                </div>
              )}
              {diff.afterText && (
                <div className="rounded-md border border-green-200 bg-green-100/80 px-3 py-2 dark:border-green-800/60 dark:bg-green-900/30">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-green-700 dark:text-green-300">After</div>
                  <div className="text-xs leading-5 text-green-950 dark:text-green-100 whitespace-pre-wrap">
                    {diff.afterId && <span className="font-mono mr-1">{diff.afterId}:</span>}
                    {renderQuestionDiffSegments(buildQuestionDiffSegments(diff.beforeText, diff.afterText).after, 'added')}
                  </div>
                </div>
              )}
            </div>
          </CollapsibleSection>
        ))}
      </div>
    </div>
  )
}

function formatRefinementDiffItemKind(itemKind: string): string {
  if (!itemKind) return 'Item'
  if (itemKind === 'epic') return 'Epic'
  if (itemKind === 'user_story') return 'User Story'
  if (itemKind === 'bead') return 'Bead'
  if (itemKind === 'risks') return 'Risks'
  if (itemKind.startsWith('technical_requirements.')) return 'Technical Requirements'
  if (itemKind.startsWith('product.')) return 'Product'
  if (itemKind.startsWith('scope.')) return 'Scope'

  return itemKind
    .replace(/[._]+/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

function InterviewDraftDiffView({ content }: { content: string }) {
  let parsed: InterviewDiffArtifactData | null = null
  try {
    parsed = JSON.parse(content) as InterviewDiffArtifactData
  } catch {
    return <RawContentView content={content} />
  }

  const diffs = buildInterviewDiffEntries(content)
  const modifiedCount = diffs.filter((diff) => diff.changeType === 'modified').length
  const replacedCount = diffs.filter((diff) => diff.changeType === 'replaced').length
  const addedCount = diffs.filter((diff) => diff.changeType === 'added').length
  const removedCount = diffs.filter((diff) => diff.changeType === 'removed').length
  const winnerLabel = parsed?.winnerId ? getModelDisplayName(parsed.winnerId) : 'winning model'

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">
        Comparing winning draft from {winnerLabel} ({parsed?.originalQuestionCount ?? normalizeInterviewDiffQuestions(parsed?.originalContent).length} questions) with the final refined interview ({parsed?.refinedQuestionCount ?? normalizeInterviewDiffQuestions(parsed?.refinedContent).length} questions).
      </div>
      <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-wider">
        <span className="rounded-full border border-border bg-background px-2 py-1 text-foreground">Modified {modifiedCount}</span>
        <span className="rounded-full border border-border bg-background px-2 py-1 text-foreground">Replaced {replacedCount}</span>
        <span className="rounded-full border border-border bg-background px-2 py-1 text-foreground">Added {addedCount}</span>
        <span className="rounded-full border border-border bg-background px-2 py-1 text-foreground">Removed {removedCount}</span>
      </div>
      {diffs.length === 0 ? (
        <div className="rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
          No differences detected between the winning draft and the final refined interview.
        </div>
      ) : (
        <div className="space-y-2">
          {diffs.map((diff) => {
            const questionDiff = buildQuestionDiffSegments(diff.before, diff.after)

            return (
              <CollapsibleSection
                key={diff.key}
                defaultOpen
                title={(
                  <span className="flex items-center gap-2">
                    <span>{diff.id}</span>
                    {diff.phase ? <span className="text-muted-foreground">{diff.phase}</span> : null}
                    <span className={diff.changeType === 'added'
                      ? 'text-green-600 dark:text-green-400'
                      : diff.changeType === 'removed'
                        ? 'text-red-600 dark:text-red-400'
                        : diff.changeType === 'replaced'
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-blue-600 dark:text-blue-400'}
                    >
                      {diff.changeType === 'modified'
                        ? 'Modified'
                        : diff.changeType === 'replaced'
                          ? 'Replaced'
                          : diff.changeType === 'added'
                            ? 'Added'
                            : 'Removed'}
                    </span>
                    {diff.inspiration
                      ? <InterviewInspirationTooltip inspiration={diff.inspiration} />
                      : diff.attributionStatus && diff.attributionStatus !== 'inspired'
                        ? <ChangeAttributionBadge status={diff.attributionStatus} />
                        : null}
                  </span>
                )}
              >
                <div className="space-y-3">
                  {diff.before && (
                    <div className="rounded-md border border-red-200 bg-red-100/80 px-3 py-2 dark:border-red-800/60 dark:bg-red-900/30">
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-red-700 dark:text-red-300">Before</div>
                      <div className="text-xs leading-5 text-red-950 dark:text-red-100">
                        {renderQuestionDiffSegments(questionDiff.before, 'removed')}
                      </div>
                    </div>
                  )}
                  {diff.after && (
                    <div className="rounded-md border border-green-200 bg-green-100/80 px-3 py-2 dark:border-green-800/60 dark:bg-green-900/30">
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-green-700 dark:text-green-300">After</div>
                      <div className="text-xs leading-5 text-green-950 dark:text-green-100">
                        {renderQuestionDiffSegments(questionDiff.after, 'added')}
                      </div>
                    </div>
                  )}
                </div>
              </CollapsibleSection>
            )
          })}
        </div>
      )}
    </div>
  )
}

function FinalInterviewArtifactView({
  content,
  header,
  hideAiAnswerBadge,
  showDiffTab = true,
}: {
  content: string
  header?: React.ReactNode
  hideAiAnswerBadge?: boolean
  showDiffTab?: boolean
}) {
  const [activeTab, setActiveTab] = useState<'final' | 'diff' | 'raw'>('final')
  const parsedContent = tryParseStructuredContent(content)
  if (parsedContent && typeof parsedContent === 'object') {
    const interviewArtifact = parsedContent as InterviewArtifactData
    const notice = (
      <ArtifactProcessingNotice
        structuredOutput={(interviewArtifact as { structuredOutput?: ArtifactStructuredOutputData }).structuredOutput}
        kind="artifact"
      />
    )
    if (typeof interviewArtifact.interview === 'string' && interviewArtifact.interview.trim()) {
      return (
        <WithRawTab content={interviewArtifact.interview} structuredLabel="Q&A" header={header} notice={notice}>
          <InterviewAnswersView content={interviewArtifact.interview} hideAiAnswerBadge={hideAiAnswerBadge} />
        </WithRawTab>
      )
    }
    if (interviewArtifact.artifact === 'interview') {
      return (
        <WithRawTab content={content} structuredLabel="Q&A" header={header} notice={notice}>
          <InterviewAnswersView content={content} hideAiAnswerBadge={hideAiAnswerBadge} />
        </WithRawTab>
      )
    }
  }

  let parsed: (InterviewDiffArtifactData & { questionCount?: number; questions?: unknown[] }) | null = null
  try {
    parsed = JSON.parse(content) as InterviewDiffArtifactData & { questionCount?: number; questions?: unknown[] }
  } catch {
    return <RawContentWithCopy content={content} />
  }

  const refinedContent = parsed?.refinedContent ?? ''
  if (!refinedContent) return <RawContentWithCopy content={content} />

  const diffEntries = buildInterviewDiffEntries(content)
  const hasDiffTab = showDiffTab && Boolean(parsed?.originalContent)
  const currentTab = activeTab === 'raw' ? 'raw' : (hasDiffTab ? activeTab : 'final')
  const notice = <ArtifactProcessingNotice structuredOutput={parsed?.structuredOutput} kind="diff" />

  const tabButtonClass = (tab: string) =>
    currentTab === tab
      ? 'rounded px-2.5 py-1 text-xs font-medium bg-primary text-primary-foreground'
      : 'rounded px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent/70 hover:text-foreground'

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {header && <div className="flex-1 min-w-0">{header}</div>}
        <div className={`inline-flex items-center gap-1 rounded-md border border-border bg-background p-1 shrink-0 ${header ? 'ml-auto' : ''}`}>
          <button onClick={() => setActiveTab('final')} className={tabButtonClass('final')}>
            Final Questions
          </button>
          {hasDiffTab && (
            <button onClick={() => setActiveTab('diff')} className={tabButtonClass('diff')}>
              Diff{diffEntries.length > 0 ? ` (${diffEntries.length})` : ''}
            </button>
          )}
          <button onClick={() => setActiveTab('raw')} className={tabButtonClass('raw')}>
            Raw
          </button>
          {currentTab === 'raw' && <CopyButton content={content} />}
        </div>
      </div>
      {currentTab === 'raw' ? (
        <div className="min-w-0 w-full overflow-hidden">
          <pre className="text-[11px] font-mono bg-background rounded border border-border p-2 overflow-x-auto whitespace-pre-wrap max-h-[500px] break-all">
            {content}
          </pre>
        </div>
      ) : currentTab === 'final'
        ? (
          <div className="space-y-3">
            {notice}
            <InterviewDraftView content={refinedContent} />
          </div>
        )
        : (
          <div className="space-y-3">
            {notice}
            <InterviewDraftDiffView content={content} />
          </div>
        )}
    </div>
  )
}

function FinalPrdDraftView({
  content,
  header,
  isBeads,
  defaultTab = 'final',
  finalLabel,
}: {
  content: string
  header?: React.ReactNode
  isBeads?: boolean
  defaultTab?: 'final' | 'diff' | 'raw'
  finalLabel?: string
}) {
  const [activeTab, setActiveTab] = useState<'final' | 'diff' | 'raw'>(defaultTab)

  const parsed = parseRefinementArtifact(content)
  if (!parsed) return <RawContentWithCopy content={content} />

  const refinedContent = parsed?.refinedContent ?? ''
  if (!refinedContent) return <RawContentWithCopy content={content} />

  const domain = isBeads ? 'beads' : 'prd'
  const diffEntries = buildRefinementDiffEntries(content, domain)
  const hasDiffTab = diffEntries.length > 0 || Boolean(parsed?.winnerDraftContent)
  const currentTab = activeTab === 'raw' ? 'raw' : (hasDiffTab ? activeTab : 'final')
  const notice = <ArtifactProcessingNotice structuredOutput={parsed?.structuredOutput} kind="diff" />

  const tabButtonClass = (tab: string) =>
    currentTab === tab
      ? 'rounded px-2.5 py-1 text-xs font-medium bg-primary text-primary-foreground'
      : 'rounded px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent/70 hover:text-foreground'

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {header && <div className="flex-1 min-w-0">{header}</div>}
        <div className={`inline-flex items-center gap-1 rounded-md border border-border bg-background p-1 shrink-0 ${header ? 'ml-auto' : ''}`}>
          <button onClick={() => setActiveTab('final')} className={tabButtonClass('final')}>
            {finalLabel ?? `Final ${isBeads ? 'Blueprint' : 'PRD'}`}
          </button>
          {hasDiffTab && (
            <button onClick={() => setActiveTab('diff')} className={tabButtonClass('diff')}>
              Diff{diffEntries.length > 0 ? ` (${diffEntries.length})` : ''}
            </button>
          )}
          <button onClick={() => setActiveTab('raw')} className={tabButtonClass('raw')}>
            Raw
          </button>
          {currentTab === 'raw' && <CopyButton content={content} />}
        </div>
      </div>
      {currentTab === 'raw' ? (
        <div className="min-w-0 w-full overflow-hidden">
          <pre className="text-[11px] font-mono bg-background rounded border border-border p-2 overflow-x-auto whitespace-pre-wrap max-h-[500px] break-all">
            {content}
          </pre>
        </div>
      ) : currentTab === 'final'
        ? (
          <div className="space-y-3">
            {notice}
            {isBeads ? <BeadsDraftView content={refinedContent} /> : <PrdDraftView content={refinedContent} />}
          </div>
        )
        : (
          <div className="space-y-3">
            {notice}
            <RefinementDiffView content={content} domain={domain} />
          </div>
        )}
    </div>
  )
}

function formatCoverageResolutionAction(action: CoverageGapResolutionData['action']): string {
  if (action === 'updated_prd') return 'Updated PRD'
  if (action === 'already_covered') return 'Already Covered'
  return 'Left Unresolved'
}

function getCoverageResolutionTone(action: CoverageGapResolutionData['action']): string {
  if (action === 'updated_prd') return 'border-green-200 bg-green-100/70 text-green-800 dark:border-green-800/60 dark:bg-green-900/30 dark:text-green-200'
  if (action === 'already_covered') return 'border-blue-200 bg-blue-100/70 text-blue-800 dark:border-blue-800/60 dark:bg-blue-900/30 dark:text-blue-200'
  return 'border-amber-200 bg-amber-100/70 text-amber-800 dark:border-amber-800/60 dark:bg-amber-900/30 dark:text-amber-200'
}

function CoverageResolutionNotesInner({ content }: { content: string }) {
  const parsed = parseRefinementArtifact(content)
  const gapResolutions = parsed?.gapResolutions ?? []
  if (!gapResolutions.length) return <RawContentWithCopy content={content} />

  const candidateVersionLabel = parsed?.candidateVersion ? `PRD Candidate v${parsed.candidateVersion}` : 'PRD Candidate'

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">
        Latest coverage-driven resolution notes for {candidateVersionLabel}.
      </div>
      {gapResolutions.map((resolution, index) => (
        <CollapsibleSection
          key={`${resolution.gap}:${index}`}
          defaultOpen
          title={(
            <span className="flex items-center gap-2 flex-wrap">
              <span className="font-medium">{resolution.gap}</span>
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${getCoverageResolutionTone(resolution.action)}`}>
                {formatCoverageResolutionAction(resolution.action)}
              </span>
            </span>
          )}
        >
          <div className="space-y-3">
            <div className="text-xs leading-5">{resolution.rationale}</div>
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Affected Items</div>
              {resolution.affectedItems.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {resolution.affectedItems.map((item) => (
                    <span
                      key={`${resolution.gap}:${item.itemType}:${item.id}`}
                      className="rounded-full border border-border bg-background px-2 py-1 text-[10px] text-foreground"
                    >
                      {item.itemType === 'epic' ? 'Epic' : 'User Story'} {item.id}: {item.label}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">No epic or user story was directly mapped for this resolution.</div>
              )}
            </div>
          </div>
        </CollapsibleSection>
      ))}
    </div>
  )
}

function CoverageResolutionNotesView({ content }: { content: string }) {
  const parsed = parseRefinementArtifact(content)
  const gapResolutions = parsed?.gapResolutions ?? []
  if (!gapResolutions.length) return <RawContentWithCopy content={content} />

  return (
    <WithRawTab
      content={content}
      structuredLabel="Resolution Notes"
      header={<div className="text-xs font-semibold px-1">Coverage Resolution Notes</div>}
      notice={<ArtifactProcessingNotice structuredOutput={parsed?.structuredOutput} kind="diff" />}
    >
      <CoverageResolutionNotesInner content={content} />
    </WithRawTab>
  )
}

function CoverageReportView({ content, phase }: { content: string; phase?: string }) {
  const [activeTab, setActiveTab] = useState<'audit' | 'changes' | 'notes'>('audit')

  let coverageReviewContent: string | null = null
  let revisionContent: string | null = null
  try {
    const envelope = JSON.parse(content)
    coverageReviewContent = envelope.coverageReviewContent ?? null
    revisionContent = envelope.revisionContent ?? null
  } catch {
    coverageReviewContent = content
  }

  const revisionPayload = revisionContent ? parseRefinementArtifact(revisionContent) : null
  const hasChanges = !!(revisionPayload?.changes?.length || revisionPayload?.winnerDraftContent)
  const hasNotes = !!(revisionPayload?.gapResolutions?.length)

  const tabs: Array<{ key: 'audit' | 'changes' | 'notes'; label: string }> = []
  if (coverageReviewContent) tabs.push({ key: 'audit', label: 'Audit' })
  if (hasChanges) tabs.push({ key: 'changes', label: 'Changes' })
  if (hasNotes) tabs.push({ key: 'notes', label: 'Resolution Notes' })

  const resolvedTab = tabs.find(t => t.key === activeTab) ? activeTab : tabs[0]?.key ?? 'audit'

  if (tabs.length === 0) {
    return <RawContentWithCopy content={content} />
  }

  return (
    <div className="space-y-3">
      {tabs.length > 1 && (
        <div className="flex gap-1 border-b border-border">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium transition-colors border-b-2 -mb-px',
                resolvedTab === tab.key
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {resolvedTab === 'audit' && coverageReviewContent && (
        <CoverageResultView content={coverageReviewContent} phase={phase} />
      )}
      {resolvedTab === 'changes' && revisionContent && (() => {
        const candidateVersion = revisionPayload?.candidateVersion
        const finalLabel = candidateVersion ? `PRD Candidate v${candidateVersion}` : 'PRD Candidate'
        return <FinalPrdDraftView content={revisionContent} defaultTab="diff" finalLabel={finalLabel} />
      })()}
      {resolvedTab === 'notes' && revisionContent && (
        <CoverageResolutionNotesInner content={revisionContent} />
      )}
    </div>
  )
}

export function InterviewAnswersView({ content, hideSummary = false, hideAiAnswerBadge = false }: { content: string; hideSummary?: boolean; hideAiAnswerBadge?: boolean }) {
  const interviewDocument = parseInterviewDocument(content)
  if (interviewDocument) {
    return <InterviewDocumentView document={interviewDocument} defaultGroupsOpen={false} hideSummary={hideSummary} hideAiAnswerBadge={hideAiAnswerBadge} />
  }

  let parsedContent: unknown = null
  try {
    parsedContent = JSON.parse(content)
  } catch {
    try {
      parsedContent = jsYaml.load(content)
    } catch {
      return <RawContentView content={content} />
    }
  }

  if (isLegacyInterviewSnapshot(parsedContent)) {
    const snapshot = parsedContent
    const mappedQuestions = snapshot.questions.map((q) => {
      const questionId = typeof q.id === 'string' ? q.id : null
      const ans = questionId ? snapshot.answers?.[questionId] : undefined
      return {
        ...q,
        answer_type: q.answerType,
        answer: ans ? {
          skipped: ans.skipped,
          free_text: ans.answer,
          selected_option_ids: ans.selectedOptionIds || [],
          answered_by: 'user',
          answered_at: ans.answeredAt,
        } : null
      }
    })
    const doc = normalizeInterviewDocumentLike({
      artifact: 'interview',
      questions: mappedQuestions
    })
    if (doc) {
      return <InterviewDocumentView document={doc} defaultGroupsOpen={false} hideSummary={hideSummary} hideAiAnswerBadge={hideAiAnswerBadge} />
    }
  }

  const viewData: InterviewAnswerViewItem[] = []
  const orphanAnswers: Record<string, string> = {}

  if (parsedContent && typeof parsedContent === 'object' && (parsedContent as InterviewArtifactData).artifact === 'interview') {
    const artifact = parsedContent as InterviewArtifactData
    const qs = Array.isArray(artifact.questions) ? artifact.questions : []
    for (const [i, q] of qs.entries()) {
      const qId = q.id || `Q${i + 1}`
      const prompt = q.prompt || ''
      const answer = typeof q.answer?.free_text === 'string' && q.answer.free_text.trim().length > 0
        ? q.answer.free_text
        : null
      viewData.push({
        id: qId,
        q: prompt,
        answer,
        selectedOptions: getSelectedOptionLabels(q),
        isSkipped: q.answer?.skipped === true,
      })
    }
  } else {
    const artifact = parsedContent && typeof parsedContent === 'object'
      ? parsedContent as InterviewArtifactData
      : null
    if (artifact?.interview) {
      return <InterviewAnswersView content={artifact.interview} />
    }

    const questionsContent = artifact?.refinedContent || ''
    const answersJson = artifact?.userAnswers || '{}'

    const questions = parseInterviewQuestions(questionsContent)
    let answers: Record<string, string> = {}
    try {
      answers = JSON.parse(answersJson)
    } catch { /* ignore */ }

    if (questions.length === 0 && Object.keys(answers).length === 0) {
      return <RawContentView content={content} />
    }

    questions.forEach((q, i) => {
      const qId = `Q${i + 1}`
      const answer = answers[qId] || answers[q.q] || null
      viewData.push({ id: qId, q: q.q, answer, selectedOptions: [], isSkipped: !answer })
    })

    Object.entries(answers).forEach(([k, v]) => {
      if (!k.startsWith('Q') && !questions.some(q => q.q === k)) {
        orphanAnswers[k] = v
      }
    })
  }

  if (viewData.length === 0 && Object.keys(orphanAnswers).length === 0) {
    return <RawContentView content={content} />
  }

  return (
    <div className="space-y-4">
      <div className="text-xs text-muted-foreground mb-2">Interview questions and recorded responses.</div>
      {viewData.map((item, i) => (
        <div key={i} className="border border-border rounded-md overflow-hidden bg-background">
          <div className="bg-muted px-3 py-2 text-xs font-medium border-b border-border text-foreground flex gap-2">
            <span className="text-muted-foreground">{item.id}.</span>
            <span>{item.q}</span>
          </div>
          <div className="px-3 py-2 text-xs">
            {item.isSkipped ? (
              <span className="text-muted-foreground italic text-[10px] bg-accent px-1.5 py-0.5 rounded">Skipped</span>
            ) : (
              <div className="space-y-1.5">
                {item.selectedOptions.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {item.selectedOptions.map((label) => (
                      <span key={label} className="inline-flex items-center px-2 py-0.5 rounded bg-primary/10 text-primary text-[10px] font-medium">
                        {label}
                      </span>
                    ))}
                  </div>
                )}
                {item.answer ? (
                  <div className="whitespace-pre-wrap text-blue-700 dark:text-blue-300">{item.answer}</div>
                ) : item.selectedOptions.length === 0 ? (
                  <span className="text-muted-foreground italic text-[10px]">No response recorded.</span>
                ) : null}
              </div>
            )}
          </div>
        </div>
      ))}
      {Object.entries(orphanAnswers).map(([k, v], i) => (
        <div key={`orphan-${i}`} className="border border-border rounded-md overflow-hidden bg-background">
          <div className="bg-muted px-3 py-2 text-xs font-medium border-b border-border text-foreground">
            {k}
          </div>
          <div className="px-3 py-2 text-xs whitespace-pre-wrap text-blue-700 dark:text-blue-300">
            {v}
          </div>
        </div>
      ))}
    </div>
  )
}

interface ParsedPrdUserStory {
  id?: string
  title?: string
  acceptance_criteria?: string[]
}

interface ParsedPrdEpic {
  id?: string
  title?: string
  objective?: string
  user_stories?: ParsedPrdUserStory[]
}

interface ParsedPrdDocument {
  product?: {
    problem_statement?: string
    target_users?: string[]
  }
  scope?: {
    in_scope?: string[]
    out_of_scope?: string[]
  }
  technical_requirements?: {
    architecture_constraints?: string[]
    data_model?: string[]
    api_contracts?: string[]
    security_constraints?: string[]
    performance_constraints?: string[]
    reliability_constraints?: string[]
    error_handling_rules?: string[]
    tooling_assumptions?: string[]
  }
  epics?: ParsedPrdEpic[]
}

interface ParsedBead {
  id?: string
  title?: string
  prdRefs?: string[]
  description?: string
  contextGuidance?: string
}

const PRD_TECHNICAL_SECTION_CONFIG: Array<{
  key: keyof NonNullable<ParsedPrdDocument['technical_requirements']>
  label: string
}> = [
  { key: 'architecture_constraints', label: 'Architecture Constraints' },
  { key: 'data_model', label: 'Data Model' },
  { key: 'api_contracts', label: 'API Contracts' },
  { key: 'security_constraints', label: 'Security Constraints' },
  { key: 'performance_constraints', label: 'Performance Constraints' },
  { key: 'reliability_constraints', label: 'Reliability Constraints' },
  { key: 'error_handling_rules', label: 'Error Handling Rules' },
  { key: 'tooling_assumptions', label: 'Tooling Assumptions' },
]

function parsePrdDocument(content: string): ParsedPrdDocument | null {
  const parsed = tryParseStructuredContent(content)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const document = parsed as ParsedPrdDocument
  return Array.isArray(document.epics) ? document : null
}

function parseBeadsArtifact(content: string): ParsedBead[] | null {
  const parsed = tryParseStructuredContent(content)
  if (Array.isArray(parsed)) {
    return parsed as ParsedBead[]
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Array.isArray((parsed as { beads?: ParsedBead[] }).beads)) {
    return (parsed as { beads: ParsedBead[] }).beads
  }
  if (content.trim().startsWith('{')) {
    try {
      return content.trim().split('\n').map((line) => JSON.parse(line) as ParsedBead)
    } catch {
      return null
    }
  }
  return null
}

function isPrdFullAnswersArtifactId(artifactId?: string): boolean {
  return artifactId?.startsWith('prd-fullanswers-member-') ?? false
}

function isPrdDraftArtifactId(artifactId?: string): boolean {
  return artifactId === 'winner-prd-draft'
    || (artifactId?.startsWith('prd-draft-member-') ?? false)
}

function isRefinedPrdArtifactId(artifactId?: string): boolean {
  return artifactId === 'refined-prd'
}

function isStructuredPrdArtifactId(artifactId?: string): boolean {
  return isPrdDraftArtifactId(artifactId) || isRefinedPrdArtifactId(artifactId)
}

export function PrdDraftView({ content }: { content: string }) {
  const parsed = parsePrdDocument(content)
  if (parsed && Array.isArray(parsed.epics)) {
    const technicalSections = PRD_TECHNICAL_SECTION_CONFIG
      .map((section) => ({
        ...section,
        values: parsed.technical_requirements?.[section.key] ?? [],
      }))
      .filter((section) => section.values.length > 0)

    return (
      <div className="space-y-4">
        {parsed.product && (
          <CollapsibleSection title="Product" defaultOpen>
            <div className="space-y-2 p-2">
              {parsed.product.problem_statement && (
                <div><strong className="text-xs">Problem Statement:</strong> <span className="text-xs">{parsed.product.problem_statement}</span></div>
              )}
              {Array.isArray(parsed.product.target_users) && parsed.product.target_users.length > 0 && (
                <div>
                  <strong className="text-xs">Target Users:</strong>
                  <ul className="list-disc list-inside text-xs mt-1 pl-2">
                    {parsed.product.target_users.map((user, index) => <li key={index}>{user}</li>)}
                  </ul>
                </div>
              )}
            </div>
          </CollapsibleSection>
        )}
        {parsed.scope && (
          <CollapsibleSection title="Scope">
            <div className="space-y-2 p-2 flex flex-col md:flex-row gap-4">
              <div className="flex-1">
                <strong className="text-xs">In Scope:</strong>
                <ul className="list-disc list-inside text-xs mt-1 pl-2">
                  {(parsed.scope.in_scope ?? []).map((scopeItem, index) => <li key={index}>{scopeItem}</li>)}
                </ul>
              </div>
              <div className="flex-1">
                <strong className="text-xs">Out of Scope:</strong>
                <ul className="list-disc list-inside text-xs mt-1 pl-2 text-muted-foreground">
                  {(parsed.scope.out_of_scope ?? []).map((scopeItem, index) => <li key={index}>{scopeItem}</li>)}
                </ul>
              </div>
            </div>
          </CollapsibleSection>
        )}
        {technicalSections.length > 0 && (
          <CollapsibleSection title="Technical Requirements">
            <div className="space-y-3 p-2">
              {technicalSections.map((section) => (
                <div key={section.key}>
                  <strong className="text-xs">{section.label}:</strong>
                  <ul className="list-disc list-inside text-xs mt-1 pl-2">
                    {section.values.map((value, index) => <li key={index}>{value}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </CollapsibleSection>
        )}
        {parsed.epics.length > 0 && (
          <div className="space-y-2 mt-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">Epics ({parsed.epics.length})</div>
            {parsed.epics.map((epic, index) => (
              <CollapsibleSection
                key={`${epic.id ?? 'epic'}-${index}`}
                title={<span className="flex items-center gap-1.5"><span className="bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded text-[10px] font-mono">{epic.id || `EPIC-${index + 1}`}</span> {epic.title}</span>}
                defaultOpen={false}
              >
                <div className="space-y-2 p-2">
                  {epic.objective && <div className="text-xs"><strong className="text-muted-foreground font-medium">Objective:</strong> {epic.objective}</div>}
                  {(epic.user_stories ?? []).map((story, storyIndex) => (
                    <div key={`${story.id ?? 'story'}-${storyIndex}`} className="border border-border/50 rounded p-2 bg-background">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span className="bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded text-[10px] font-mono">{story.id || `US-${storyIndex + 1}`}</span>
                        <span className="text-xs font-medium">{story.title}</span>
                      </div>
                      {Array.isArray(story.acceptance_criteria) && story.acceptance_criteria.length > 0 && (
                        <div className="pl-6 mt-1">
                          <ul className="list-disc text-[11px] text-muted-foreground space-y-0.5">
                            {story.acceptance_criteria.map((criterion, criterionIndex) => (
                              <li key={criterionIndex}>{criterion}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CollapsibleSection>
            ))}
          </div>
        )}
      </div>
    )
  }

  const lines = content.split('\n')
  const sections: { title: string; items: string[] }[] = []
  let current: { title: string; items: string[] } | null = null
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('##') || (trimmed.startsWith('**Epic') || trimmed.startsWith('**User Story'))) {
      if (current) sections.push(current)
      current = { title: trimmed.replace(/^#+\s*/, '').replace(/\*\*/g, ''), items: [] }
    } else if (current && trimmed) {
      current.items.push(trimmed.replace(/^[-*]\s*/, ''))
    }
  }
  if (current) sections.push(current)

  if (sections.length === 0) return <RawContentView content={content} />

  return (
    <div className="space-y-2">
      {sections.map((s, i) => (
        <CollapsibleSection key={i} title={s.title} defaultOpen={i === 0}>
          <div className="space-y-1">
            {s.items.map((item, j) => <div key={j} className="text-xs">• {item}</div>)}
          </div>
        </CollapsibleSection>
      ))}
    </div>
  )
}

function BeadsDraftView({ content }: { content: string }) {
  const beadsArray = parseBeadsArtifact(content)
  if (Array.isArray(beadsArray)) {
    return (
      <div className="space-y-2">
        <div className="text-xs text-muted-foreground mb-2">{beadsArray.length} beads</div>
        {beadsArray.map((bead, index) => (
          <CollapsibleSection key={`${bead.id ?? 'bead'}-${index}`} title={<span className="flex items-center gap-1.5"><span className="bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded text-[10px] font-mono">{bead.id || `Bead ${index + 1}`}</span> {bead.title}</span>}>
            <div className="space-y-2 p-2">
              {Array.isArray(bead.prdRefs) && bead.prdRefs.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {bead.prdRefs.map((ref, refIndex) => <span key={refIndex} className="px-1.5 py-0.5 bg-muted rounded border border-border text-[10px] text-muted-foreground">{ref}</span>)}
                </div>
              )}
              {bead.description && (
                <div className="text-xs"><strong className="text-muted-foreground font-medium">Description:</strong> <span className="whitespace-pre-wrap">{bead.description}</span></div>
              )}
              {bead.contextGuidance && (
                <div className="text-xs"><strong className="text-muted-foreground font-medium">Guidance:</strong> <span className="whitespace-pre-wrap">{bead.contextGuidance}</span></div>
              )}
            </div>
          </CollapsibleSection>
        ))}
      </div>
    )
  }

  const lines = content.split('\n')
  const beads: { title: string; details: string[] }[] = []
  let current: { title: string; details: string[] } | null = null
  for (const line of lines) {
    const trimmed = line.trim()
    const beadMatch = trimmed.match(/^(?:##?\s*)?(?:Bead|Issue)\s*#?\d+[:\s-]*(.*)/i)
    if (beadMatch) {
      if (current) beads.push(current)
      current = { title: beadMatch[1] || trimmed, details: [] }
    } else if (current && trimmed) {
      current.details.push(trimmed.replace(/^[-*]\s*/, ''))
    }
  }
  if (current) beads.push(current)
  if (beads.length === 0) return null
  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground mb-2">{beads.length} beads</div>
      {beads.map((b, i) => (
        <CollapsibleSection key={i} title={<span className="flex items-center gap-1.5"><span className="bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded text-[10px] font-mono">#{i + 1}</span> {b.title}</span>}>
          <div className="space-y-1">
            {b.details.map((d, j) => <div key={j} className="text-xs">• {d}</div>)}
          </div>
        </CollapsibleSection>
      ))}
    </div>
  )
}

function VotingResultsView({ data, showHeader = true }: { data: CouncilResultData; showHeader?: boolean }) {
  const votes = Array.isArray(data.votes)
    ? data.votes
    : []
  const winnerId = data.winnerId ?? ''
  const voterOutcomes = (data.voterOutcomes ?? {}) as Record<string, CouncilOutcome>
  const voterDetails = Array.isArray(data.voterDetails)
    ? data.voterDetails
    : []
  const voterDetailById = new Map<string, CouncilVoterDetailData>(
    voterDetails.map((detail) => [detail.voterId, detail] as const),
  )
  const presentationOrders = data.presentationOrders ?? {}

  const draftIds = [...new Set(votes.map(v => v.draftId))]
  const voterIds = [
    ...(Object.keys(voterOutcomes).length > 0 ? Object.keys(voterOutcomes) : []),
    ...votes.map(v => v.voterId),
    ...voterDetails.map((detail) => detail.voterId),
  ].filter((voterId, index, values) => values.indexOf(voterId) === index)
  const categories = votes[0]?.scores?.map(s => s.category) ?? []
  const getVoterOutcome = (voterId: string): CouncilOutcome => {
    const outcome = voterOutcomes[voterId]
    if (outcome === 'completed' || outcome === 'failed' || outcome === 'timed_out' || outcome === 'invalid_output' || outcome === 'pending') {
      return outcome
    }
    return votes.some(v => v.voterId === voterId) ? 'completed' : 'pending'
  }
  const completedCount = voterIds.filter(voterId => getVoterOutcome(voterId) === 'completed').length
  const hasLiveOutcomes = voterIds.length > 0
  const votersWithProcessingNotice = voterIds.filter((voterId) => hasArtifactProcessingNotice(voterDetailById.get(voterId)?.structuredOutput))
  const aggregateProcessingNotice = mergeStructuredOutputMetadata(
    votersWithProcessingNotice.map((voterId) => voterDetailById.get(voterId)?.structuredOutput),
  )

  if (votes.length === 0 && !hasLiveOutcomes) {
    return <div className="text-xs text-muted-foreground italic">No voting data available</div>
  }

  const draftScores = draftIds.map(draftId => {
    const draftVotes = votes.filter(v => v.draftId === draftId)
    const total = draftVotes.reduce((sum, v) => sum + v.totalScore, 0)
    const categoryAvgs = categories.map(cat => {
      const scores = draftVotes.map(v => v.scores.find(s => s.category === cat)?.score ?? 0)
      return { category: cat, avg: scores.reduce((a, b) => a + b, 0) / (scores.length || 1) }
    })
    return { draftId, total, categoryAvgs, isWinner: draftId === winnerId }
  }).sort((a, b) => b.total - a.total)

  return (
    <div className="space-y-3">
      {aggregateProcessingNotice && (
        <ArtifactProcessingNotice
          structuredOutput={aggregateProcessingNotice}
          kind="vote-aggregate"
          context={{ affectedCount: votersWithProcessingNotice.length }}
        />
      )}
      {hasLiveOutcomes && (
        <div className="space-y-2">
          {showHeader && (
            <div className="text-xs font-semibold">
              Voter Status <span className="text-muted-foreground font-normal">({completedCount}/{voterIds.length} complete)</span>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {voterIds.map(voterId => {
              const outcome = getVoterOutcome(voterId)
              return (
                <ModelBadge
                  key={voterId}
                  modelId={voterId}
                  className="px-2.5 py-1.5 h-auto items-start"
                >
                  <div className="min-w-0 text-left">
                    <div className="text-[10px] font-medium truncate">{getModelDisplayName(voterId)}</div>
                    <div className="text-[10px] opacity-80 mt-0.5">
                      {getCouncilStatusEmoji(outcome, 'scoring')} {getCouncilStatusLabel(outcome, 'scoring')}
                    </div>
                  </div>
                </ModelBadge>
              )
            })}
          </div>
        </div>
      )}

      {draftScores.length === 0 && (
        <div className="text-xs text-muted-foreground italic">No completed votes yet.</div>
      )}

      {/* Rankings */}
      {draftScores.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold mb-1">Rankings</div>
          {draftScores.map((d, rank) => (
            <ModelBadge
              key={d.draftId}
              modelId={d.draftId}
              active={d.isWinner}
              className="w-full px-2.5 py-1.5 h-auto items-center"
            >
              <span className="font-mono w-5 text-center font-bold opacity-80">{rank === 0 ? 'W' : `#${rank + 1}`}</span>
              <span className="font-medium flex-1 text-left ml-1">{getModelDisplayName(d.draftId)}</span>
              <span className={`ml-auto font-mono font-semibold ${d.isWinner ? 'text-primary-foreground' : 'text-secondary-foreground'}`}>{d.total}</span>
              {d.isWinner && <Trophy className="h-3.5 w-3.5 text-primary-foreground ml-1" />}
            </ModelBadge>
          ))}
        </div>
      )}

      {/* Score table */}
      {draftScores.length > 0 && categories.length > 0 && (
        <div className="overflow-x-auto">
          <div className="text-xs font-semibold mb-1">Score Breakdown</div>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-1 pr-2 font-medium text-muted-foreground">Model</th>
                {categories.map(cat => (
                  <th key={cat} className="text-center py-1 px-1 font-medium text-muted-foreground" title={cat}>
                    {cat.length > 20 ? cat.slice(0, 18) + '…' : cat}
                  </th>
                ))}
                <th className="text-center py-1 pl-2 font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {draftScores.map(d => (
                <tr key={d.draftId} className={`border-b border-border/50 ${d.isWinner ? 'bg-primary/10' : ''}`}>
                  <td className="py-1 pr-2 whitespace-nowrap">
                    <span className="mr-1">{getModelIcon(d.draftId)}</span>
                    <span className={d.isWinner ? 'font-semibold text-primary' : ''}>{getModelDisplayName(d.draftId)}</span>
                  </td>
                  {d.categoryAvgs.map(ca => (
                    <td key={ca.category} className="text-center py-1 px-1 font-mono">{ca.avg.toFixed(1)}</td>
                  ))}
                  <td className={`text-center py-1 pl-2 font-mono font-semibold ${d.isWinner ? 'text-primary' : ''}`}>{d.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Per-voter breakdown */}
      <CollapsibleSection title={<span>Voter Details <span className="text-muted-foreground">({voterIds.length} voters)</span></span>}>
        <div className="space-y-2">
          {voterIds.map(voterId => (
            <div key={voterId} className="space-y-1">
              <div className="font-medium flex items-center gap-1">
                {getModelIcon(voterId)} {getModelDisplayName(voterId)}
                <span className="text-[10px] text-muted-foreground ml-1">
                  {getCouncilStatusEmoji(getVoterOutcome(voterId), 'scoring')} {getCouncilStatusLabel(getVoterOutcome(voterId), 'scoring')}
                </span>
              </div>
              <ArtifactProcessingNotice structuredOutput={voterDetailById.get(voterId)?.structuredOutput} kind="vote" />
              {votes.filter(v => v.voterId === voterId).length === 0 ? (
                <div className="ml-4 text-muted-foreground italic">
                  {getVoterOutcome(voterId) === 'pending'
                    ? 'Still scoring drafts.'
                    : getVoterOutcome(voterId) === 'failed'
                      ? 'Failed before submitting scores.'
                      : getVoterOutcome(voterId) === 'timed_out'
                        ? 'Timed out before submitting scores.'
                      : getVoterOutcome(voterId) === 'invalid_output'
                          ? 'Returned malformed scores.'
                          : 'No scores recorded.'}
                </div>
              ) : (
                <div className="space-y-2">
                  {votes.filter(v => v.voterId === voterId).map(v => (
                    <div key={v.draftId} className="ml-4 flex items-center gap-2 text-muted-foreground">
                      <span>→ {getModelDisplayName(v.draftId)}</span>
                      <span className="font-mono">{v.totalScore}pts</span>
                      {v.draftId === winnerId && <span className="font-bold text-[10px] text-primary bg-primary/10 px-1 rounded">winner</span>}
                    </div>
                  ))}
                  {presentationOrders[voterId] && (
                    <div className="ml-4 space-y-1">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Presentation Order <span className="normal-case tracking-normal">seed {presentationOrders[voterId]!.seed.slice(0, 8)}</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {presentationOrders[voterId]!.order.map((draftId, index) => (
                          <span key={`${voterId}:${draftId}:${index}`} className="rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-foreground">
                            Draft {index + 1}: {getModelDisplayName(draftId)}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </CollapsibleSection>
    </div>
  )
}

function CoverageResultView({ content, header, phase }: { content: string; header?: React.ReactNode; phase?: string }) {
  const coverageResult = parseCoverageArtifact(content)
  if (!coverageResult) {
    return (
      <div className="space-y-3">
        {header && <div className="flex items-center gap-2">{header}</div>}
        <div className="text-xs text-muted-foreground italic">Coverage result is still being generated.</div>
      </div>
    )
  }

  const isPrdCoverage = phase === 'VERIFYING_PRD_COVERAGE' || phase === 'WAITING_PRD_APPROVAL'
  const isInterviewCoverage = phase === 'VERIFYING_INTERVIEW_COVERAGE' || phase === 'WAITING_INTERVIEW_APPROVAL'
  const isBeadsCoverage = phase === 'VERIFYING_BEADS_COVERAGE' || phase === 'WAITING_BEADS_APPROVAL'
  const status = coverageResult.parsed?.status ?? (coverageResult.hasGaps ? 'gaps' : 'clean')
  const gaps = Array.isArray(coverageResult.parsed?.gaps) ? coverageResult.parsed.gaps : []
  const followUpQuestions = isPrdCoverage
    ? []
    : normalizeCoverageFollowUpArtifacts(
        coverageResult.parsed?.followUpQuestions ?? coverageResult.parsed?.follow_up_questions,
    )
  const hasStructuredCoverage = gaps.length > 0 || status === 'clean' || (!isPrdCoverage && followUpQuestions.length > 0)
  const reviewedArtifact = isPrdCoverage
    ? 'current PRD candidate'
    : isInterviewCoverage
      ? 'compiled interview'
      : isBeadsCoverage
        ? 'current implementation plan'
        : 'current draft'
  const reviewedAgainst = isPrdCoverage
    ? 'approved interview'
    : isInterviewCoverage
      ? 'submitted answers'
      : isBeadsCoverage
        ? 'approved PRD'
        : 'source material'
  const summaryText = status === 'gaps'
    ? gaps.length > 0
      ? `This pass found ${gaps.length === 1 ? '1 gap' : `${gaps.length} gaps`} between the ${reviewedArtifact} and the ${reviewedAgainst}.`
      : `This pass found coverage gaps between the ${reviewedArtifact} and the ${reviewedAgainst}.`
    : `The ${reviewedArtifact} covers the ${reviewedAgainst}. No gaps were flagged in this pass.`
  const terminationSummary = coverageResult.terminationReason === 'coverage_pass_limit_reached'
    ? 'Retry cap reached; moving to approval with unresolved gaps.'
    : coverageResult.terminationReason === 'follow_up_budget_exhausted'
      ? 'Follow-up budget exhausted; moving to approval with unresolved gaps.'
      : coverageResult.terminationReason === 'follow_up_generation_failed'
        ? 'Follow-up questions could not be recovered; moving to approval with unresolved gaps.'
        : null

  return (
    <div className="space-y-4">
      {header && <div className="flex items-center gap-2">{header}</div>}

      <div className={`rounded-md border px-3 py-2 text-xs font-medium ${
        status === 'gaps'
          ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200'
          : 'border-green-300 bg-green-50 text-green-900 dark:border-green-900/60 dark:bg-green-950/30 dark:text-green-200'
      }`}>
        {status === 'gaps' ? 'Coverage review found gaps' : 'No coverage gaps found'}
      </div>

      <div className="rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
        {summaryText}
      </div>

      {terminationSummary && (
        <div className="rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
          {terminationSummary}
        </div>
      )}

      {typeof coverageResult.followUpBudgetTotal === 'number' && (
        <div className="rounded-md border border-border bg-background px-3 py-2 text-[11px] text-muted-foreground">
          Follow-up budget: {coverageResult.followUpBudgetUsed ?? 0}/{coverageResult.followUpBudgetTotal} used
          {typeof coverageResult.followUpBudgetPercent === 'number' ? ` (${coverageResult.followUpBudgetPercent}%)` : ''}
          {typeof coverageResult.followUpBudgetRemaining === 'number' ? ` · ${coverageResult.followUpBudgetRemaining} remaining` : ''}
        </div>
      )}

      {hasStructuredCoverage && (
        <div className="space-y-3">
          {gaps.length > 0 && (
            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Open Coverage Gaps</div>
              <div className="space-y-2">
                {gaps.map((gap, index) => (
                  <div key={`${gap}-${index}`} className="rounded-md border border-border bg-background px-3 py-2 text-xs">
                    {gap}
                  </div>
                ))}
              </div>
            </div>
          )}

          {!isPrdCoverage && followUpQuestions.length > 0 && (
            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Suggested Follow-up Questions</div>
              <div className="space-y-2">
                {followUpQuestions.map((question, index) => (
                  <div key={`${question.id ?? 'follow-up'}-${index}`} className="rounded-md border border-border bg-background px-3 py-2 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {question.id && <span className="font-mono text-[10px] text-muted-foreground">{question.id}</span>}
                      {question.phase && <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{question.phase}</span>}
                      {question.priority && <span className="text-[10px] text-blue-500">{question.priority}</span>}
                    </div>
                    <div className="text-xs font-medium">{question.question}</div>
                    {question.rationale && <div className="text-[10px] italic text-muted-foreground">{question.rationale}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {(coverageResult.response || coverageResult.normalizedContent) && (
        <CollapsibleSection title="Technical Details">
          <RawContentView content={coverageResult.response || coverageResult.normalizedContent || ''} />
        </CollapsibleSection>
      )}
    </div>
  )
}

function RelevantFilesScanView({ content }: { content: string }) {
  const [activeTab, setActiveTab] = useState<'files' | 'raw'>('files')
  const raw = tryParseStructuredContent(content) as (RelevantFilesScanData & { files: Array<RelevantFileScanEntry & { content_preview?: string }> }) | null
  if (!raw?.files) return <RawContentView content={content} />

  // Normalize: accept both camelCase (new) and snake_case (legacy DB rows)
  const parsed: RelevantFilesScanData = {
    ...raw,
    files: raw.files.map(f => ({
      ...f,
      contentPreview: f.contentPreview ?? (f as { content_preview?: string }).content_preview ?? '',
      contentLength: f.contentLength ?? (f.contentPreview ?? (f as { content_preview?: string }).content_preview ?? '').length,
    })),
  }

  const relevanceColor = (r: string) =>
    r === 'high' ? 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800'
    : r === 'medium' ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800'
    : 'text-muted-foreground bg-muted border-border'

  let formattedContent = content
  try {
    formattedContent = JSON.stringify(parsed, null, 2)
  } catch {
    // Ignore JSON formatting errors
  }

  const lineCount = formattedContent.split('\n').length
  const charCount = content.length
  const tokenCount = encode(content).length

  return (
    <div className="space-y-3">
      <ArtifactProcessingNotice structuredOutput={parsed.structuredOutput} kind="relevant-files" />
      <div className="flex items-center gap-2">
        {parsed.modelId && (
          <ModelBadge modelId={parsed.modelId} active className="px-3 py-2 h-auto flex-1 justify-start">
            <div className="text-left">
              <div className="text-xs font-medium">{getModelDisplayName(parsed.modelId)}</div>
              <div className="text-[10px] opacity-80 mt-0.5">Relevant files scan</div>
            </div>
          </ModelBadge>
        )}
        <div className={`inline-flex items-center gap-1 rounded-md border border-border bg-background p-1 shrink-0 ${parsed.modelId ? 'ml-auto' : ''}`}>
          <button
            onClick={() => setActiveTab('files')}
            className={activeTab === 'files'
              ? 'rounded px-2.5 py-1 text-xs font-medium bg-primary text-primary-foreground'
              : 'rounded px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent/70 hover:text-foreground'}
          >
            Files
          </button>
          <button
            onClick={() => setActiveTab('raw')}
            className={activeTab === 'raw'
              ? 'rounded px-2.5 py-1 text-xs font-medium bg-primary text-primary-foreground'
              : 'rounded px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent/70 hover:text-foreground'}
          >
            Raw
          </button>
          {activeTab === 'raw' && <CopyButton content={content} />}
        </div>
      </div>

      {activeTab === 'raw' ? (
        <>
          <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-wider">
            <span className="rounded-full border border-border bg-background px-2 py-1 text-foreground">{lineCount.toLocaleString()} Lines</span>
            <span className="rounded-full border border-border bg-background px-2 py-1 text-foreground">{charCount.toLocaleString()} Characters</span>
            <span className="rounded-full border border-border bg-background px-2 py-1 text-foreground">{tokenCount.toLocaleString()} Tokens (GPT-5 tokenizer)</span>
          </div>
          <div className="min-w-0 w-full overflow-hidden">
            <pre className="text-[11px] font-mono bg-background rounded border border-border p-2 overflow-x-auto whitespace-pre-wrap max-h-[500px] break-all">
              {content}
            </pre>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <div className="text-xs text-muted-foreground font-medium">{parsed.fileCount} files identified</div>
            <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-wider">
              <span className="rounded-full border border-border bg-background px-2 py-1 text-foreground">{lineCount.toLocaleString()} Lines</span>
              <span className="rounded-full border border-border bg-background px-2 py-1 text-foreground">{charCount.toLocaleString()} Characters</span>
              <span className="rounded-full border border-border bg-background px-2 py-1 text-foreground">{tokenCount.toLocaleString()} Tokens (GPT-5 tokenizer)</span>
            </div>
          </div>
          {parsed.files.map((file) => (
            <CollapsibleSection
              key={file.path}
              title={
                <span className="flex items-center gap-2 flex-wrap min-w-0 w-full">
                  <span className="font-mono text-[11px] truncate flex-1 min-w-0">{file.path}</span>
                  <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                    <span className={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded border leading-none ${relevanceColor(file.relevance)}`}>
                      Relevance: {file.relevance}
                    </span>
                    <span className="text-[9px] uppercase font-bold text-muted-foreground px-1.5 py-0.5 rounded border border-border bg-muted/30 leading-none">
                      Action: {file.likely_action}
                    </span>
                  </div>
                </span>
              }
              defaultOpen={false}
            >
              <div className="space-y-2">
                <div className="text-xs italic text-muted-foreground">{file.rationale}</div>
                {file.contentPreview && (
                  <pre className="text-[11px] font-mono bg-background rounded border border-border p-2 overflow-x-auto whitespace-pre-wrap">
                    {file.contentPreview}{(file.contentLength ?? 0) > 200 ? '\n…' : ''}
                  </pre>
                )}
                {file.contentLength != null && (
                  <div className="text-[10px] text-muted-foreground">{file.contentLength.toLocaleString()} chars extracted</div>
                )}
              </div>
            </CollapsibleSection>
          ))}
        </>
      )}
    </div>
  )
}

function FinalTestResultsView({ content }: { content: string }) {
  const parsed = tryParseStructuredContent(content) as FinalTestExecutionReportData | null
  if (
    !parsed
    || typeof parsed !== 'object'
    || !Array.isArray(parsed.commands)
    || !Array.isArray(parsed.errors)
    || typeof parsed.modelOutput !== 'string'
  ) {
    return <RawContentWithCopy content={content} />
  }

  const checkedAtLabel = Number.isNaN(Date.parse(parsed.checkedAt))
    ? parsed.checkedAt
    : new Date(parsed.checkedAt).toLocaleString()
  const header = parsed.plannedBy
    ? (
      <ModelBadge modelId={parsed.plannedBy} active className="px-3 py-2 h-auto flex-1 justify-start">
        <div className="text-left">
          <div className="text-xs font-medium">{getModelDisplayName(parsed.plannedBy)}</div>
          <div className="text-[10px] opacity-80 mt-0.5">Final test results</div>
        </div>
      </ModelBadge>
      )
    : <div className="text-xs font-semibold px-1">Final Test Results</div>

  return (
    <WithRawTab
      content={content}
      structuredLabel="Results"
      header={header}
      notice={<ArtifactProcessingNotice structuredOutput={parsed.planStructuredOutput} kind="final-test" />}
    >
      <div className="space-y-4">
        <div className={`rounded-md border px-3 py-2 text-xs font-medium ${
          parsed.passed
            ? 'border-green-300 bg-green-50 text-green-900 dark:border-green-900/60 dark:bg-green-950/30 dark:text-green-200'
            : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200'
        }`}>
          {parsed.passed ? 'Final test commands passed' : 'Final test commands failed'}
        </div>

        <div className="rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
          Checked at {checkedAtLabel}.
          {parsed.summary ? ` Summary: ${parsed.summary}` : ''}
        </div>

        {parsed.commands.length > 0 ? (
          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Executed Commands</div>
            {parsed.commands.map((command, index) => {
              const commandStatus = command.timedOut
                ? 'Timed Out'
                : command.exitCode === 0
                  ? 'Passed'
                  : 'Failed'
              return (
                <CollapsibleSection
                  key={`${command.command}:${index}`}
                  title={(
                    <span className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-[11px]">{command.command}</span>
                      <span className="text-[10px] text-muted-foreground">{commandStatus}</span>
                      <span className="text-[10px] text-muted-foreground">{command.durationMs}ms</span>
                    </span>
                  )}
                >
                  <div className="space-y-2">
                    <div className="text-[11px] text-muted-foreground">
                      Exit code: {command.exitCode ?? 'none'}
                      {command.signal ? ` · Signal: ${command.signal}` : ''}
                    </div>
                    {command.stdout ? (
                      <div>
                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Stdout</div>
                        <pre className="text-[11px] font-mono bg-background rounded border border-border p-2 overflow-x-auto whitespace-pre-wrap">
                          {command.stdout}
                        </pre>
                      </div>
                    ) : null}
                    {command.stderr ? (
                      <div>
                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Stderr</div>
                        <pre className="text-[11px] font-mono bg-background rounded border border-border p-2 overflow-x-auto whitespace-pre-wrap">
                          {command.stderr}
                        </pre>
                      </div>
                    ) : null}
                  </div>
                </CollapsibleSection>
              )
            })}
          </div>
        ) : (
          <div className="rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
            No final test commands were executed.
          </div>
        )}

        {parsed.errors.length > 0 && (
          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Errors</div>
            <div className="space-y-2">
              {parsed.errors.map((error, index) => (
                <div key={`${error}:${index}`} className="rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
                  {error}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </WithRawTab>
  )
}

export function ArtifactContent({ content, artifactId, phase }: { content: string; artifactId?: string; phase?: string }) {
  if (artifactId === 'relevant-files-scan') {
    return <RelevantFilesScanView content={content} />
  }
  if (artifactId === 'test-results') {
    return <FinalTestResultsView content={content} />
  }
  if (artifactId === 'final-interview') {
    const isCanonicalInterviewPhase = phase === 'VERIFYING_INTERVIEW_COVERAGE' || phase === 'WAITING_INTERVIEW_APPROVAL'
    const header = <div className="text-xs font-semibold px-1">{isCanonicalInterviewPhase ? 'Interview Results' : 'Final Interview'}</div>
    return (
      <FinalInterviewArtifactView
        content={content}
        header={header}
        hideAiAnswerBadge={isCanonicalInterviewPhase}
        showDiffTab={phase !== 'WAITING_INTERVIEW_ANSWERS'}
      />
    )
  }
  if (artifactId === 'final-prd-draft') {
    const header = <div className="text-xs font-semibold px-1">PRD Candidate v1</div>
    return <FinalPrdDraftView content={content} header={header} finalLabel="PRD Candidate v1" />
  }
  if (artifactId === 'refined-prd') {
    const candidateVersion = parseRefinementArtifact(content)?.candidateVersion ?? 1
    const label = `PRD Candidate v${candidateVersion}`
    const header = <div className="text-xs font-semibold px-1">{label}</div>
    return <FinalPrdDraftView content={content} header={header} finalLabel={label} />
  }
  if (artifactId === 'coverage-report') {
    return <CoverageReportView content={content} phase={phase} />
  }
  if (artifactId === 'final-beads-draft') {
    const header = <div className="text-xs font-semibold px-1">Final Blueprint Draft</div>
    return <FinalPrdDraftView content={content} header={header} isBeads />
  }
  if (artifactId === 'interview-answers') {
    const header = <div className="text-xs font-semibold px-1">Interview Answers</div>
    return (
      <WithRawTab content={content} structuredLabel="Q&A" header={header}>
        <InterviewAnswersView content={content} hideSummary />
      </WithRawTab>
    )
  }
  if (artifactId?.endsWith('coverage-result') || artifactId === 'coverage-review') {
    const coverageResult = parseCoverageArtifact(content)
    const reviewLabel = phase === 'VERIFYING_PRD_COVERAGE' || phase === 'WAITING_PRD_APPROVAL'
      ? 'Coverage review of the current PRD candidate'
      : phase === 'VERIFYING_INTERVIEW_COVERAGE' || phase === 'WAITING_INTERVIEW_APPROVAL'
        ? 'Coverage review of the compiled interview'
        : phase === 'VERIFYING_BEADS_COVERAGE' || phase === 'WAITING_BEADS_APPROVAL'
          ? 'Coverage review of the current implementation plan'
          : 'Coverage review'
    const header = coverageResult?.winnerId ? (
      <ModelBadge modelId={coverageResult.winnerId} active className="px-3 py-2 h-auto flex-1 justify-start">
        <div className="text-left">
          <div className="text-xs font-medium">{getModelDisplayName(coverageResult.winnerId)}</div>
          <div className="text-[10px] opacity-80 mt-0.5">
            {reviewLabel}
            {(coverageResult.coverageRunNumber && coverageResult.maxCoveragePasses)
              ? ` · pass ${coverageResult.coverageRunNumber} of ${coverageResult.maxCoveragePasses}`
              : ''}
          </div>
        </div>
      </ModelBadge>
    ) : <div className="text-xs font-semibold px-1">Coverage Audit</div>

    return (
      <WithRawTab
        content={content}
        structuredLabel="Summary"
        header={header}
        notice={<ArtifactProcessingNotice structuredOutput={coverageResult?.structuredOutput} kind="coverage" />}
      >
        <CoverageResultView content={content} phase={phase} />
      </WithRawTab>
    )
  }

  let parsedCoverageInput: CoverageInputData | null = null
  try {
    const p = JSON.parse(content) as unknown
    if (p && typeof p === 'object' && 'refinedContent' in p && !('drafts' in p) && !('votes' in p)) {
      parsedCoverageInput = p as CoverageInputData
    }
  } catch { /* not json */ }

  if (parsedCoverageInput && artifactId === 'refined-beads') {
    const diffEntries = buildRefinementDiffEntries(content, 'beads')
    const hasChanges = diffEntries.length > 0 || Boolean(parseRefinementArtifact(content)?.winnerDraftContent)
    return (
      <RefinedArtifactTabs
        content={content}
        hasChanges={hasChanges}
        notice={<ArtifactProcessingNotice structuredOutput={parseRefinementArtifact(content)?.structuredOutput} kind="diff" />}
        sectionsContent={(
          <div className="space-y-6">
            {parsedCoverageInput.interview && (
              <div>
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Approved Interview</div>
                <div className="opacity-80"><InterviewAnswersView content={parsedCoverageInput.interview} /></div>
              </div>
            )}
            {parsedCoverageInput.fullAnswers && (
              <div>
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Winner Full Answers</div>
                <div className="opacity-80"><InterviewAnswersView content={parsedCoverageInput.fullAnswers} /></div>
              </div>
            )}
            {parsedCoverageInput.prd && (
              <div>
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Prior Context (PRD)</div>
                <div className="opacity-80"><PrdDraftView content={parsedCoverageInput.prd} /></div>
              </div>
            )}
            {parsedCoverageInput.beads && (
              <div>
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Prior Context (Beads)</div>
                <div className="opacity-80"><BeadsDraftView content={parsedCoverageInput.beads} /></div>
              </div>
            )}
            {parsedCoverageInput.refinedContent && (
              <div className="border-t border-border pt-4">
                <div className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider mb-2">Under Verification (Beads)</div>
                {<BeadsDraftView content={parsedCoverageInput.refinedContent} />}
              </div>
            )}
          </div>
        )}
        diffContent={hasChanges ? <RefinementDiffView content={content} domain={'beads'} /> : undefined}
      />
    )
  }

  const councilResult = tryParseCouncilResult(content)
  if (councilResult) {
    const isVotes = artifactId?.includes('vote')
    if (isVotes) {
      const votes = Array.isArray(councilResult.votes) ? councilResult.votes : []
      const voterOutcomes = (councilResult.voterOutcomes ?? {}) as Record<string, CouncilOutcome>
      const voterIds = Object.keys(voterOutcomes).length > 0
        ? Object.keys(voterOutcomes)
        : [...new Set(votes.map(v => v.voterId))]
      const completedCount = voterIds.filter(voterId => {
        const outcome = voterOutcomes[voterId]
        if (outcome === 'completed' || outcome === 'failed' || outcome === 'timed_out' || outcome === 'invalid_output' || outcome === 'pending') {
          return outcome === 'completed'
        }
        return votes.some(v => v.voterId === voterId)
      }).length

      const header = (
        <div className="text-xs font-semibold px-1">
          Voter Status <span className="text-muted-foreground font-normal">({completedCount}/{voterIds.length} complete)</span>
        </div>
      )

      return (
        <WithRawTab content={content} structuredLabel="Votes" header={header}>
          <VotingResultsView data={councilResult} showHeader={false} />
        </WithRawTab>
      )
    }

    const isWinnerArtifact = artifactId?.startsWith('winner')
    if (isWinnerArtifact) {
      const winnerDraft = councilResult.drafts?.find((d) => d.memberId === councilResult.winnerId)
      const winnerContent = winnerDraft?.content ?? councilResult.winnerContent ?? ''
      if (!winnerContent) return <div className="text-xs text-muted-foreground italic">Voting still in progress — winner not yet determined.</div>
      const header = winnerDraft ? (
        <ModelBadge
          modelId={winnerDraft.memberId}
          active={true}
          className="px-3 py-2 h-auto flex-1 justify-start"
        >
          <div className="min-w-0 text-left">
            <div className="text-xs font-medium truncate">{getModelDisplayName(winnerDraft.memberId)}</div>
            <div className="text-[10px] text-primary-foreground/90 font-bold mt-0.5 normal-case">🏆 Winner{winnerDraft.duration ? ` · ${(winnerDraft.duration / 1000).toFixed(1)}s` : ''}</div>
          </div>
        </ModelBadge>
      ) : null
      const isPrd = isStructuredPrdArtifactId(artifactId)
      const isBeads = artifactId?.includes('beads')
      const noticeKind = getCouncilDraftNoticeKind({
        isFullAnswers: false,
        isInterview: !isPrd && !isBeads,
        isPrd,
        isBeads,
      })
      const structured = isPrd ? <PrdDraftView content={winnerContent} />
        : isBeads ? <BeadsDraftView content={winnerContent} />
          : <InterviewDraftView content={winnerContent} />
      return (
        <WithRawTab
          content={winnerContent}
          structuredLabel="Winner"
          header={header}
          notice={<ArtifactProcessingNotice structuredOutput={winnerDraft?.structuredOutput} kind={noticeKind} />}
        >
          {structured || <RawContentView content={winnerContent} />}
        </WithRawTab>
      )
    }

    const memberMatch = artifactId?.match(/member-(.+)$/)
    const memberId = memberMatch?.[1] ? decodeURIComponent(memberMatch[1]) : null

    const draftIndex = !memberId ? artifactId?.match(/(\d+)$/)?.[1] : null
    const draftIdx = draftIndex ? parseInt(draftIndex, 10) - 1 : -1

    const draft = memberId
      ? (councilResult.drafts?.find(d => d.memberId === memberId) ?? null)
      : (draftIdx >= 0 ? (councilResult.drafts?.[draftIdx] ?? null) : null)
    const draftContent = draft?.content ?? councilResult.refinedContent ?? councilResult.winnerContent ?? ''

    const header = draft ? (
      <ModelBadge
        modelId={draft.memberId}
        active={draft.memberId === councilResult.winnerId && !phase?.includes('DELIBERATING') && !phase?.includes('DRAFTING')}
        className="px-3 py-2 h-auto flex-1 justify-start"
      >
        <div className="min-w-0 text-left">
          <div className="text-xs font-medium truncate">{getModelDisplayName(draft.memberId)}</div>
          <div className="text-[10px] mt-0.5 opacity-80 flex items-center gap-1 flex-wrap normal-case">
            <span>
              {draft.outcome === 'completed'
                ? '✅ Completed'
                : draft.outcome === 'timed_out'
                  ? '⏰ Timed out'
                  : draft.outcome === 'failed'
                    ? '💥 Failed'
                    : draft.outcome === 'pending'
                      ? '⏳ In progress'
                      : '❌ Invalid output'}
            </span>
            {draft.duration ? <span>· {(draft.duration / 1000).toFixed(1)}s</span> : null}
            {draft.memberId === councilResult.winnerId && !phase?.includes('DELIBERATING') && !phase?.includes('DRAFTING') && (
              <span className="font-bold text-primary-foreground/90 ml-1">🏆 Winner</span>
            )}
          </div>
        </div>
      </ModelBadge>
    ) : null

    if (draftContent) {
      const isFullAnswers = isPrdFullAnswersArtifactId(artifactId)
      const isInterview = artifactId?.startsWith('draft') || artifactId?.includes('interview')
      const isPrd = isStructuredPrdArtifactId(artifactId) && !isFullAnswers
      const isBeads = artifactId?.includes('beads')
      const noticeKind = getCouncilDraftNoticeKind({ isFullAnswers, isInterview, isPrd, isBeads })
      const noticeContext = isFullAnswers ? getFullAnswersNoticeContext(draftContent) : undefined

      const structured = isFullAnswers ? <InterviewAnswersView content={draftContent} />
        : isInterview ? <InterviewDraftView content={draftContent} />
          : isPrd ? <PrdDraftView content={draftContent} />
            : isBeads ? <BeadsDraftView content={draftContent} />
              : null

      if (structured) {
        return (
          <WithRawTab
            content={draftContent}
            structuredLabel="Draft"
            header={header}
            notice={<ArtifactProcessingNotice structuredOutput={draft?.structuredOutput} kind={noticeKind} context={noticeContext} />}
          >
            {structured}
          </WithRawTab>
        )
      }
      return <RawContentWithCopy content={draftContent} />
    }

    if (draft) {
      if (draft.outcome === 'invalid_output' && draft.content) {
        const isFullAnswers = isPrdFullAnswersArtifactId(artifactId)
        const isInterview = artifactId?.startsWith('draft') || artifactId?.includes('interview')
        const isPrd = isStructuredPrdArtifactId(artifactId) && !isFullAnswers
        const isBeads = artifactId?.includes('beads')
        const noticeContext = isFullAnswers ? getFullAnswersNoticeContext(draft.content) : undefined
        const structured = isFullAnswers ? <InterviewAnswersView content={draft.content} />
          : isInterview ? <InterviewDraftView content={draft.content} />
            : isPrd ? <PrdDraftView content={draft.content} />
              : isBeads ? <BeadsDraftView content={draft.content} />
                : null
        return (
          <div className="space-y-2">
            {header}
            <CollapsibleWarningNotice
              title="Output did not pass strict validation."
              summary="The saved draft did not match the required format."
              body="LoopTroop is showing the model output because it may still be useful, but it did not match the required format and may have formatting problems."
              detail={draft.error ? `Validator message: ${draft.error}` : undefined}
            />
            {structured
              ? (
                <WithRawTab
                  content={draft.content}
                  structuredLabel="Draft"
                  notice={<ArtifactProcessingNotice structuredOutput={draft.structuredOutput} kind={getCouncilDraftNoticeKind({ isFullAnswers, isInterview, isPrd, isBeads })} context={noticeContext} />}
                >
                  {structured}
                </WithRawTab>
              )
              : <RawContentWithCopy content={draft.content} />}
          </div>
        )
      }

      const waitingMessage = draft.outcome === 'pending'
        ? 'Artifact is still being generated for this member.'
        : draft.outcome === 'timed_out'
          ? 'No response was received before the council timeout.'
          : draft.outcome === 'failed'
            ? (draft.error || 'This member failed before producing output.')
            : draft.outcome === 'invalid_output'
              ? (draft.error || 'This member returned malformed output.')
              : 'No content available yet.'
      return (
        <div className="space-y-3">
          {header}
          <div className="text-xs text-muted-foreground italic">{waitingMessage}</div>
        </div>
      )
    }
  }

  return <RawContentWithCopy content={content} />
}
