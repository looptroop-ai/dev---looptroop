import { useState } from 'react'
import jsYaml from 'js-yaml'
import { encode } from 'gpt-tokenizer'
import { ChevronDown, ChevronRight, Trophy, Copy, Check } from 'lucide-react'
import { getModelIcon, getModelDisplayName } from '@/components/shared/modelBadgeUtils'
import { ModelBadge } from '@/components/shared/ModelBadge'
import type {
  InterviewArtifactData,
  InterviewDiffArtifactData,
  CoverageInputData,
  CouncilResultData,
  CouncilOutcome,
  QuestionDiffSegment,
  RelevantFilesScanData,
} from './phaseArtifactTypes'
import {
  tryParseStructuredContent,
  tryParseCouncilResult,
  normalizeInterviewDiffQuestions,
  buildInterviewDiffEntries,
  buildQuestionDiffSegments,
  normalizeCoverageFollowUpArtifacts,
  parseCoverageArtifact,
  parseInterviewQuestions,
} from './phaseArtifactTypes'
import {
  getCouncilStatusEmoji,
  getCouncilStatusLabel,
} from './councilArtifacts'

export function CollapsibleSection({ title, defaultOpen = false, children }: { title: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-border rounded-md overflow-hidden flex flex-col min-w-0 w-full">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1.5 w-full px-3 py-2 text-xs font-medium hover:bg-accent/50 transition-colors text-left min-w-0">
        {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        <span className="min-w-0 flex-1 flex items-center">{title}</span>
      </button>
      {open && <div className="px-3 pb-3 text-xs overflow-x-auto w-full">{children}</div>}
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

function renderQuestionDiffSegments(segments: QuestionDiffSegment[], tone: 'added' | 'removed') {
  const highlightClassName = tone === 'removed'
    ? 'rounded-[0.2rem] bg-red-100/60 px-0.5 text-inherit dark:bg-red-500/10'
    : 'rounded-[0.2rem] bg-green-100/60 px-0.5 text-inherit dark:bg-green-500/10'

  return segments.map((segment, index) => (
    segment.changed && segment.text.trim()
      ? <mark key={`${tone}-${index}`} className={highlightClassName}>{segment.text}</mark>
      : <span key={`${tone}-${index}`}>{segment.text}</span>
  ))
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
                  </span>
                )}
              >
                <div className="space-y-3">
                  {diff.before && (
                    <div className="rounded-md border border-red-100 bg-red-50/40 px-3 py-2 dark:border-red-900/40 dark:bg-red-950/10">
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-red-700 dark:text-red-300">Before</div>
                      <div className="text-xs leading-5 text-red-950 dark:text-red-100">
                        {renderQuestionDiffSegments(questionDiff.before, 'removed')}
                      </div>
                    </div>
                  )}
                  {diff.after && (
                    <div className="rounded-md border border-green-100 bg-green-50/40 px-3 py-2 dark:border-green-900/40 dark:bg-green-950/10">
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

function FinalInterviewArtifactView({ content }: { content: string }) {
  const [activeTab, setActiveTab] = useState<'final' | 'diff'>('final')
  const parsedContent = tryParseStructuredContent(content)
  if (parsedContent && typeof parsedContent === 'object') {
    const interviewArtifact = parsedContent as InterviewArtifactData
    if (typeof interviewArtifact.interview === 'string' && interviewArtifact.interview.trim()) {
      return <InterviewAnswersView content={interviewArtifact.interview} />
    }
    if (interviewArtifact.artifact === 'interview') {
      return <InterviewAnswersView content={content} />
    }
  }

  let parsed: (InterviewDiffArtifactData & { questionCount?: number; questions?: unknown[] }) | null = null
  try {
    parsed = JSON.parse(content) as InterviewDiffArtifactData & { questionCount?: number; questions?: unknown[] }
  } catch {
    return <RawContentView content={content} />
  }

  const refinedContent = parsed?.refinedContent ?? ''
  if (!refinedContent) return <RawContentView content={content} />

  const diffEntries = buildInterviewDiffEntries(content)
  const hasDiffTab = Boolean(parsed?.originalContent)
  const currentTab = hasDiffTab ? activeTab : 'final'

  return (
    <div className="space-y-3">
      {hasDiffTab && (
        <div className="inline-flex items-center gap-1 rounded-md border border-border bg-background p-1">
          <button
            onClick={() => setActiveTab('final')}
            className={currentTab === 'final'
              ? 'rounded px-2.5 py-1 text-xs font-medium bg-primary text-primary-foreground'
              : 'rounded px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent/70 hover:text-foreground'}
          >
            Final Questions
          </button>
          <button
            onClick={() => setActiveTab('diff')}
            className={currentTab === 'diff'
              ? 'rounded px-2.5 py-1 text-xs font-medium bg-primary text-primary-foreground'
              : 'rounded px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent/70 hover:text-foreground'}
          >
            Diff{diffEntries.length > 0 ? ` (${diffEntries.length})` : ''}
          </button>
        </div>
      )}
      {currentTab === 'final'
        ? <InterviewDraftView content={refinedContent} />
        : <InterviewDraftDiffView content={content} />}
    </div>
  )
}

export function InterviewAnswersView({ content }: { content: string }) {
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

  const viewData: { id: string | number; q: string; answer: string | null; isSkipped: boolean }[] = []
  const orphanAnswers: Record<string, string> = {}

  if (parsedContent && typeof parsedContent === 'object' && (parsedContent as InterviewArtifactData).artifact === 'interview') {
    const artifact = parsedContent as InterviewArtifactData
    const qs = Array.isArray(artifact.questions) ? artifact.questions : []
    for (const [i, q] of qs.entries()) {
      const qId = q.id || `Q${i + 1}`
      const prompt = q.prompt || ''
      let answer = null
      let isSkipped = true
      if (q.answer) {
        if (!q.answer.skipped && q.answer.free_text) {
          answer = q.answer.free_text
          isSkipped = false
        }
      }
      viewData.push({ id: qId, q: prompt, answer, isSkipped })
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
      viewData.push({ id: qId, q: q.q, answer, isSkipped: !answer })
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
      <div className="text-xs text-muted-foreground mb-2">User responses to the interview questions.</div>
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
              <div className="whitespace-pre-wrap text-blue-700 dark:text-blue-300">{item.answer}</div>
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

export function PrdDraftView({ content }: { content: string }) {
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

function VotingResultsView({ data }: { data: CouncilResultData }) {
  const votes = Array.isArray(data.votes)
    ? data.votes
    : []
  const winnerId = data.winnerId ?? ''
  const voterOutcomes = (data.voterOutcomes ?? {}) as Record<string, CouncilOutcome>
  const presentationOrders = data.presentationOrders ?? {}

  const draftIds = [...new Set(votes.map(v => v.draftId))]
  const voterIds = Object.keys(voterOutcomes).length > 0
    ? Object.keys(voterOutcomes)
    : [...new Set(votes.map(v => v.voterId))]
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
      {hasLiveOutcomes && (
        <div className="space-y-2">
          <div className="text-xs font-semibold">
            Voter Status <span className="text-muted-foreground font-normal">({completedCount}/{voterIds.length} complete)</span>
          </div>
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

function CoverageResultView({ content }: { content: string }) {
  const coverageResult = parseCoverageArtifact(content)
  if (!coverageResult) {
    return <div className="text-xs text-muted-foreground italic">Coverage result is still being generated.</div>
  }

  const status = coverageResult.parsed?.status ?? (coverageResult.hasGaps ? 'gaps' : 'clean')
  const gaps = Array.isArray(coverageResult.parsed?.gaps) ? coverageResult.parsed.gaps : []
  const followUpQuestions = normalizeCoverageFollowUpArtifacts(
    coverageResult.parsed?.followUpQuestions ?? coverageResult.parsed?.follow_up_questions,
  )
  const hasStructuredCoverage = gaps.length > 0 || followUpQuestions.length > 0 || status === 'clean'
  const terminationSummary = coverageResult.terminationReason === 'coverage_pass_limit_reached'
    ? 'Retry cap reached; moving to approval with unresolved gaps.'
    : coverageResult.terminationReason === 'follow_up_budget_exhausted'
      ? 'Follow-up budget exhausted; moving to approval with unresolved gaps.'
      : coverageResult.terminationReason === 'follow_up_generation_failed'
        ? 'Follow-up questions could not be recovered; moving to approval with unresolved gaps.'
        : null

  return (
    <div className="space-y-4">
      {coverageResult.winnerId && (
        <ModelBadge modelId={coverageResult.winnerId} active className="px-3 py-2 h-auto w-full justify-start">
          <div className="text-left">
            <div className="text-xs font-medium">{getModelDisplayName(coverageResult.winnerId)}</div>
            <div className="text-[10px] opacity-80 mt-0.5">
              Winner-only coverage verification
              {(coverageResult.coverageRunNumber && coverageResult.maxCoveragePasses)
                ? ` · pass ${coverageResult.coverageRunNumber}/${coverageResult.maxCoveragePasses}`
                : ''}
            </div>
          </div>
        </ModelBadge>
      )}

      <div className={`rounded-md border px-3 py-2 text-xs font-medium ${
        status === 'gaps'
          ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200'
          : 'border-green-300 bg-green-50 text-green-900 dark:border-green-900/60 dark:bg-green-950/30 dark:text-green-200'
      }`}>
        {status === 'gaps' ? 'Coverage gaps found' : 'Coverage complete'}
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
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Coverage Gaps</div>
              <div className="space-y-2">
                {gaps.map((gap, index) => (
                  <div key={`${gap}-${index}`} className="rounded-md border border-border bg-background px-3 py-2 text-xs">
                    {gap}
                  </div>
                ))}
              </div>
            </div>
          )}

          {followUpQuestions.length > 0 && (
            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Follow-up Questions</div>
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
        <CollapsibleSection title="Audit Output">
          <RawContentView content={coverageResult.response || coverageResult.normalizedContent || ''} />
        </CollapsibleSection>
      )}
    </div>
  )
}

function RelevantFilesScanView({ content }: { content: string }) {
  const [activeTab, setActiveTab] = useState<'files' | 'raw'>('files')
  const parsed = tryParseStructuredContent(content) as RelevantFilesScanData | null
  if (!parsed?.files) return <RawContentView content={content} />

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
      <div className="flex items-center gap-2">
        {parsed.modelId && (
          <ModelBadge modelId={parsed.modelId} active className="px-3 py-2 h-auto flex-1 justify-start">
            <div className="text-left">
              <div className="text-xs font-medium">{getModelDisplayName(parsed.modelId)}</div>
              <div className="text-[10px] opacity-80 mt-0.5">Relevant files scan</div>
            </div>
          </ModelBadge>
        )}
        <div className="inline-flex items-center gap-1 rounded-md border border-border bg-background p-1 shrink-0">
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

      <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-wider">
        <span className="rounded-full border border-border bg-background px-2 py-1 text-foreground">{lineCount.toLocaleString()} Lines</span>
        <span className="rounded-full border border-border bg-background px-2 py-1 text-foreground">{charCount.toLocaleString()} Characters</span>
        <span className="rounded-full border border-border bg-background px-2 py-1 text-foreground">{tokenCount.toLocaleString()} Tokens (GPT-5 tokenizer)</span>
      </div>

      {activeTab === 'files' ? (
        <>
          <div className="text-xs text-muted-foreground">{parsed.fileCount} files identified</div>
          {parsed.files.map((file, i) => (
            <CollapsibleSection
              key={file.path}
              title={
                <span className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[11px]">{file.path}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${relevanceColor(file.relevance)}`}>
                    {file.relevance}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{file.likely_action}</span>
                </span>
              }
              defaultOpen={i === 0}
            >
              <div className="space-y-2">
                <div className="text-xs italic text-muted-foreground">{file.rationale}</div>
                {file.contentPreview && (
                  <pre className="text-[11px] font-mono bg-background rounded border border-border p-2 overflow-x-auto whitespace-pre-wrap">
                    {file.contentPreview}{file.contentLength > 200 ? '\n…' : ''}
                  </pre>
                )}
                <div className="text-[10px] text-muted-foreground">{file.contentLength.toLocaleString()} chars extracted</div>
              </div>
            </CollapsibleSection>
          ))}
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

export function ArtifactContent({ content, artifactId, phase }: { content: string; artifactId?: string; phase?: string }) {
  if (artifactId === 'relevant-files-scan') {
    return <RelevantFilesScanView content={content} />
  }
  if (artifactId === 'final-interview') {
    return <FinalInterviewArtifactView content={content} />
  }
  if (artifactId === 'interview-answers') {
    return <InterviewAnswersView content={content} />
  }

  if (artifactId?.endsWith('coverage-result')) {
    return <CoverageResultView content={content} />
  }

  let parsedCoverageInput: CoverageInputData | null = null
  try {
    const p = JSON.parse(content) as unknown
    if (p && typeof p === 'object' && 'refinedContent' in p && !('drafts' in p) && !('votes' in p)) {
      parsedCoverageInput = p as CoverageInputData
    }
  } catch { /* not json */ }

  if (parsedCoverageInput && (artifactId === 'refined-prd' || artifactId === 'refined-beads')) {
    const isPrd = artifactId === 'refined-prd'
    return (
      <div className="space-y-6">
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
            <div className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider mb-2">Under Verification ({isPrd ? 'PRD' : 'Beads'})</div>
            {isPrd ? <PrdDraftView content={parsedCoverageInput.refinedContent} /> : <BeadsDraftView content={parsedCoverageInput.refinedContent} />}
          </div>
        )}
      </div>
    )
  }

  const councilResult = tryParseCouncilResult(content)
  if (councilResult) {
    const isVotes = artifactId?.includes('vote')
    if (isVotes) return <VotingResultsView data={councilResult} />

    const isWinnerArtifact = artifactId?.startsWith('winner')
    if (isWinnerArtifact) {
      const winnerDraft = councilResult.drafts?.find((d) => d.memberId === councilResult.winnerId)
      const winnerContent = winnerDraft?.content ?? councilResult.winnerContent ?? ''
      if (!winnerContent) return <div className="text-xs text-muted-foreground italic">Voting still in progress — winner not yet determined.</div>
      const header = winnerDraft ? (
        <div className="flex items-center gap-2 mb-4 pb-0">
          <ModelBadge
            modelId={winnerDraft.memberId}
            active={true}
            className="flex-1 px-3 py-2 h-auto"
          >
            <div className="min-w-0 text-left flex-1">
              <div className="text-xs font-medium truncate">{getModelDisplayName(winnerDraft.memberId)}</div>
              <div className="text-[10px] text-primary-foreground/90 font-bold mt-0.5 normal-case">🏆 Winner{winnerDraft.duration ? ` · ${(winnerDraft.duration / 1000).toFixed(1)}s` : ''}</div>
            </div>
          </ModelBadge>
        </div>
      ) : null
      const isPrd = artifactId?.includes('prd')
      const isBeads = artifactId?.includes('beads')
      const structured = isPrd ? <PrdDraftView content={winnerContent} />
        : isBeads ? <BeadsDraftView content={winnerContent} />
          : <InterviewDraftView content={winnerContent} />
      return <>{header}{structured || <RawContentView content={winnerContent} />}</>
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
      <div className="flex items-center gap-2 mb-4 pb-0">
        <ModelBadge
          modelId={draft.memberId}
          active={draft.memberId === councilResult.winnerId && !phase?.includes('DELIBERATING') && !phase?.includes('DRAFTING')}
          className="flex-1 px-3 py-2 h-auto"
        >
          <div className="min-w-0 text-left flex-1">
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
      </div>
    ) : null

    if (draftContent) {
      const isInterview = artifactId?.startsWith('draft') || artifactId?.includes('interview')
      const isPrd = artifactId?.includes('prd')
      const isBeads = artifactId?.includes('beads')

      const structured = isInterview ? <InterviewDraftView content={draftContent} />
        : isPrd ? <PrdDraftView content={draftContent} />
          : isBeads ? <BeadsDraftView content={draftContent} />
            : null

      if (structured) return <>{header}{structured}</>
      return <>{header}<RawContentView content={draftContent} /></>
    }

    if (draft) {
      if (draft.outcome === 'invalid_output' && draft.content) {
        const isInterview = artifactId?.startsWith('draft') || artifactId?.includes('interview')
        const isPrd = artifactId?.includes('prd')
        const isBeads = artifactId?.includes('beads')
        const structured = isInterview ? <InterviewDraftView content={draft.content} />
          : isPrd ? <PrdDraftView content={draft.content} />
            : isBeads ? <BeadsDraftView content={draft.content} />
              : null
        return (
          <>
            {header}
            <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded px-2 py-1 mb-2">
              ⚠️ Output did not pass strict validation{draft.error ? `: ${draft.error}` : ''} — content shown below may have formatting issues.
            </div>
            {structured || <RawContentView content={draft.content} />}
          </>
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
        <>
          {header}
          <div className="text-xs text-muted-foreground italic">{waitingMessage}</div>
        </>
      )
    }
  }

  return <RawContentView content={content} />
}
