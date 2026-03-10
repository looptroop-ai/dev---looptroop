import { useCallback, useMemo, useState } from 'react'
// @ts-expect-error no type declarations for js-yaml
import jsYaml from 'js-yaml'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { FileText, CheckCircle2, ChevronDown, ChevronRight, Trophy, Loader2 } from 'lucide-react'
import { getModelIcon, getModelDisplayName, ModelBadge } from '@/components/shared/ModelBadge'
import { useTicketArtifacts, type DBartifact } from '@/hooks/useTicketArtifacts'
import {
  buildCouncilMemberArtifacts,
  getCouncilAction,
  getCouncilStatusEmoji,
  getCouncilStatusLabel,
  type CouncilMemberArtifactChip,
  type CouncilOutcome,
  type CouncilViewerArtifact,
} from './councilArtifacts'

interface PhaseArtifactsPanelProps {
  phase: string
  isCompleted: boolean
  ticketId?: string
  councilMemberCount?: number
  councilMemberNames?: string[]
  prefixElement?: React.ReactNode
  preloadedArtifacts?: DBartifact[]
}

interface ArtifactDef {
  id: string
  label: string
  description: string
  icon: React.ReactNode
}

interface ParsedQuestionItem {
  question?: string
  prompt?: string
  phase?: string
  category?: string
}

interface InterviewAnswerField {
  skipped?: boolean
  free_text?: string
}

interface InterviewArtifactQuestion {
  id?: string
  prompt?: string
  answer?: InterviewAnswerField
}

interface InterviewArtifactData {
  artifact?: string
  questions?: InterviewArtifactQuestion[]
  refinedContent?: string
  userAnswers?: string
}

interface CoverageInputData {
  prd?: string
  beads?: string
  refinedContent?: string
}

interface CouncilDraftData {
  memberId: string
  outcome?: CouncilOutcome
  content?: string
  duration?: number
  error?: string
}

interface CouncilVoteData {
  voterId: string
  draftId: string
  totalScore: number
  scores: Array<{ category: string; score: number }>
}

interface CouncilResultData {
  drafts?: CouncilDraftData[]
  votes?: CouncilVoteData[]
  winnerId?: string
  winnerContent?: string
  refinedContent?: string
  voterOutcomes?: Record<string, CouncilOutcome>
}

function extractDraftDetail(content: string | null): string {
  if (!content) return ''
  const questionMatch = content.match(/(\d+)\s*(?:questions|Q)/i)
  if (questionMatch) return `proposed ${questionMatch[1]} questions`
  const scoreMatch = content.match(/(\d+\.?\d*)\s*\/\s*10/i)
  if (scoreMatch) return `scored ${scoreMatch[1]}/10`
  const lineCount = content.split('\n').filter(l => l.trim()).length
  if (lineCount > 0) return `${lineCount} lines`
  return ''
}

// Try to parse content as JSON CouncilResult
function tryParseCouncilResult(content: string): CouncilResultData | null {
  try {
    const parsed = JSON.parse(content) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const result = parsed as CouncilResultData
    if (result.drafts || result.votes || result.winnerId) return result
    return null
  } catch {
    return null
  }
}

function CollapsibleSection({ title, defaultOpen = false, children }: { title: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-border rounded-md overflow-hidden">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1.5 w-full px-3 py-2 text-xs font-medium hover:bg-accent/50 transition-colors text-left">
        {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        {title}
      </button>
      {open && <div className="px-3 pb-3 text-xs">{children}</div>}
    </div>
  )
}

function parseInterviewQuestions(content: string): { q: string; section?: string }[] {
  const questions: { q: string; section?: string }[] = []
  let parsedFromYaml = false
  try {
    const parsed = jsYaml.load(content) as unknown
    let items: ParsedQuestionItem[] = []
    if (Array.isArray(parsed)) items = parsed as ParsedQuestionItem[]
    else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { questions?: unknown[] }).questions))
      items = (parsed as { questions: ParsedQuestionItem[] }).questions
    if (items.length > 0 && items.some((q) => q?.question || q?.prompt)) {
      for (const item of items) {
        const text = (item?.question ?? item?.prompt) as string | undefined
        if (text) questions.push({ q: text, section: (item.phase ?? item.category) as string | undefined })
      }
      parsedFromYaml = true
    }
  } catch { /* fall through to line-by-line */ }

  if (!parsedFromYaml) {
    let currentSection = ''
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.startsWith('#')) {
        currentSection = trimmed.replace(/^#+\s*/, '')
      } else if (/^\d+[.)]\s/.test(trimmed) || /^[-*]\s/.test(trimmed) || /^\*\*Q\d/i.test(trimmed) || trimmed.endsWith('?')) {
        const q = trimmed.replace(/^[-*\d.)]+\s*/, '').replace(/^\*\*/, '').replace(/\*\*$/, '')
        if (q.length > 5) questions.push({ q, section: currentSection })
      }
    }
  }
  return questions
}

// Render interview draft: Q&A pairs
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

// Render user interview answers
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

  // Common UI State
  const viewData: { id: string | number; q: string; answer: string | null; isSkipped: boolean }[] = []
  const orphanAnswers: Record<string, string> = {}

  // Native interview.yaml parsing
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
    // Handle interview_coverage_input format which has refinedContent (questions) and userAnswers
    const artifact = parsedContent && typeof parsedContent === 'object'
      ? parsedContent as InterviewArtifactData
      : null
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

    // Find orphans
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
      {/* Show any orphan answers that didn't match a question */}
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

// Render PRD draft: epics/user stories in collapsible sections
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
// Render beads draft: bead list with details
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

// Render voting results with score table and winner
function VotingResultsView({ data }: { data: CouncilResultData }) {
  const votes = Array.isArray(data.votes)
    ? data.votes
    : []
  const winnerId = data.winnerId ?? ''
  const voterOutcomes = (data.voterOutcomes ?? {}) as Record<string, CouncilOutcome>

  // Get unique drafts and voters
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

  // Aggregate scores per draft
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
                votes.filter(v => v.voterId === voterId).map(v => (
                  <div key={v.draftId} className="ml-4 flex items-center gap-2 text-muted-foreground">
                    <span>→ {getModelDisplayName(v.draftId)}</span>
                    <span className="font-mono">{v.totalScore}pts</span>
                    {v.draftId === winnerId && <span className="font-bold text-[10px] text-primary bg-primary/10 px-1 rounded">winner</span>}
                  </div>
                ))
              )}
            </div>
          ))}
        </div>
      </CollapsibleSection>
    </div>
  )
}

function getSupplementalArtifacts(phase: string): ArtifactDef[] {
  if (phase === 'COUNCIL_VOTING_INTERVIEW') {
    return [{ id: 'winner-draft', label: 'Winning Draft', description: 'Highest-scored interview draft', icon: <Trophy className="h-3.5 w-3.5" /> }]
  }
  if (phase === 'VERIFYING_INTERVIEW_COVERAGE' || phase === 'WAITING_INTERVIEW_APPROVAL' || phase === 'WAITING_INTERVIEW_ANSWERS') {
    return [{ id: 'interview-answers', label: 'Interview Answers', description: 'User responses', icon: <FileText className="h-3.5 w-3.5" /> }]
  }
  if (phase === 'COUNCIL_VOTING_PRD') {
    return [{ id: 'winner-prd-draft', label: 'Winning PRD Draft', description: 'Highest-scored PRD draft', icon: <Trophy className="h-3.5 w-3.5" /> }]
  }
  if (phase === 'VERIFYING_PRD_COVERAGE' || phase === 'WAITING_PRD_APPROVAL') {
    return [{ id: 'refined-prd', label: 'Refined PRD', description: 'Winning draft with improvements', icon: <FileText className="h-3.5 w-3.5" /> }]
  }
  if (phase === 'COUNCIL_VOTING_BEADS') {
    return [{ id: 'winner-beads-draft', label: 'Winning Beads Draft', description: 'Highest-scored beads draft', icon: <Trophy className="h-3.5 w-3.5" /> }]
  }
  if (phase === 'VERIFYING_BEADS_COVERAGE' || phase === 'WAITING_BEADS_APPROVAL') {
    return [{ id: 'refined-beads', label: 'Refined Beads', description: 'Winning beads with improvements', icon: <FileText className="h-3.5 w-3.5" /> }]
  }
  if (phase === 'PRE_FLIGHT_CHECK') {
    return [{ id: 'diagnostics', label: 'Doctor Diagnostics', description: 'Pre-flight validation report', icon: <CheckCircle2 className="h-3.5 w-3.5" /> }]
  }
  if (phase === 'CODING') {
    return [{ id: 'bead-commits', label: 'Bead Commits', description: 'Per-bead git commits', icon: <FileText className="h-3.5 w-3.5" /> }]
  }
  if (phase === 'RUNNING_FINAL_TEST') {
    return [{ id: 'test-results', label: 'Test Results', description: 'Full test suite results', icon: <CheckCircle2 className="h-3.5 w-3.5" /> }]
  }
  if (phase === 'INTEGRATING_CHANGES') {
    return [{ id: 'commit-summary', label: 'Commit Summary', description: 'Squashed commit history', icon: <FileText className="h-3.5 w-3.5" /> }]
  }
  if (phase === 'CLEANING_ENV') {
    return [{ id: 'cleanup-report', label: 'Cleanup Report', description: 'Resource cleanup', icon: <FileText className="h-3.5 w-3.5" /> }]
  }
  return []
}

function ArtifactContent({ content, artifactId, phase }: { content: string; artifactId?: string; phase?: string }) {
  if (artifactId === 'interview-answers') {
    return <InterviewAnswersView content={content} />
  }

  let coverageResult: { response?: string; hasGaps?: boolean } | null = null
  try {
    const parsed = JSON.parse(content) as unknown
    if (parsed && typeof parsed === 'object') {
      const result = parsed as { response?: string; hasGaps?: boolean }
      if ('response' in result || 'hasGaps' in result) coverageResult = result
    }
  } catch {
    coverageResult = null
  }

  if (artifactId?.endsWith('coverage-result')) {
    if (!coverageResult) {
      return <div className="text-xs text-muted-foreground italic">Coverage result is still being generated.</div>
    }
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-xs font-medium">
          <span>{coverageResult.hasGaps ? '⚠️' : '✅'}</span>
          <span>{coverageResult.hasGaps ? 'Coverage gaps found' : 'Coverage complete'}</span>
        </div>
        {coverageResult.response
          ? <RawContentView content={coverageResult.response} />
          : <div className="text-xs text-muted-foreground italic">Coverage result is still being generated.</div>}
      </div>
    )
  }

  let parsedCoverageInput: CoverageInputData | null = null
  try {
    const p = JSON.parse(content) as unknown
    // Check if this looks like a coverage input JSON rather than CouncilResult
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

  // Try structured rendering for CouncilResult JSON
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

    // For individual draft views, extract the specific draft by memberId
    const memberMatch = artifactId?.match(/member-(.+)$/)
    const memberId = memberMatch?.[1] ? decodeURIComponent(memberMatch[1]) : null

    // Legacy positional fallback for existing artifacts
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
      // Fall through to raw rendering with header
      return <>{header}<RawContentView content={draftContent} /></>
    }

    if (draft) {
      // For invalid_output with actual content, show warning + content
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

type ViewingArtifact = CouncilViewerArtifact & { icon?: React.ReactNode }
type ViewingArtifactSelection =
  | { kind: 'member'; key: string }
  | { kind: 'supplemental'; id: string }

function getArtifactTargetPhases(phase: string): string[] {
  const phaseMap: Record<string, string[]> = {
    WAITING_INTERVIEW_APPROVAL: ['VERIFYING_INTERVIEW_COVERAGE', 'COMPILING_INTERVIEW'],
    WAITING_PRD_APPROVAL: ['VERIFYING_PRD_COVERAGE', 'REFINING_PRD'],
    WAITING_BEADS_APPROVAL: ['VERIFYING_BEADS_COVERAGE', 'REFINING_BEADS'],
  }

  return phaseMap[phase] || [phase]
}

function resolveStaticArtifact(
  artifactDef: ArtifactDef,
  phase: string,
  reversedArtifacts: DBartifact[],
): DBartifact | undefined {
  const targetPhases = getArtifactTargetPhases(phase)
  const findExactType = (artifactType: string) =>
    reversedArtifacts.find(artifact => targetPhases.includes(artifact.phase) && artifact.artifactType === artifactType)
  const findByPredicate = (predicate: (artifact: DBartifact) => boolean) =>
    reversedArtifacts.find(artifact => targetPhases.includes(artifact.phase) && predicate(artifact))

  switch (artifactDef.id) {
    case 'winner-draft':
      return findExactType('interview_votes')
    case 'winner-prd-draft':
      return findExactType('prd_votes')
    case 'winner-beads-draft':
      return findExactType('beads_votes')
    case 'interview-answers':
      if (phase === 'VERIFYING_INTERVIEW_COVERAGE' || phase === 'WAITING_INTERVIEW_APPROVAL') {
        return findExactType('interview_coverage_input')
      }
      break
    case 'refined-prd':
      return findExactType('prd_coverage_input')
    case 'refined-beads':
      return findExactType('beads_coverage_input')
    case 'diagnostics':
      return findExactType('preflight_report')
    case 'bead-commits':
      return findByPredicate(artifact => artifact.artifactType.startsWith('bead_execution:'))
    case 'test-results':
      return findExactType('final_test_report')
    case 'commit-summary':
      return findExactType('integration_report')
    case 'cleanup-report':
      return findExactType('cleanup_report')
  }

  const prefix = artifactDef.id.split('-')[0] ?? ''
  return findByPredicate(artifact => artifact.artifactType.toLowerCase().includes(prefix))
    ?? findByPredicate(artifact => Boolean(artifact.content))
}

export function PhaseArtifactsPanel({ phase, isCompleted, ticketId, councilMemberCount = 3, councilMemberNames, prefixElement, preloadedArtifacts }: PhaseArtifactsPanelProps) {
  const supplementalArtifacts = getSupplementalArtifacts(phase)
  const [viewingSelection, setViewingSelection] = useState<ViewingArtifactSelection | null>(null)
  const { artifacts: cachedArtifacts, isLoading: isLoadingArtifacts } = useTicketArtifacts(ticketId, { skipFetch: !!preloadedArtifacts })
  const dbArtifacts = preloadedArtifacts ?? cachedArtifacts
  const reversedArtifacts = useMemo(() => [...dbArtifacts].reverse(), [dbArtifacts])
  const configuredMembers = useMemo(() => councilMemberNames ?? [], [councilMemberNames])
  const memberArtifacts = useMemo(
    () => buildCouncilMemberArtifacts(phase, dbArtifacts, configuredMembers, isCompleted, councilMemberCount),
    [configuredMembers, councilMemberCount, dbArtifacts, isCompleted, phase],
  )
  const action = getCouncilAction(phase)

  const findDbContent = useCallback((artifactDef: ArtifactDef): string | null => {
    const match = resolveStaticArtifact(artifactDef, phase, reversedArtifacts)
    return match?.content ?? null
  }, [phase, reversedArtifacts])

  function getArtifactState(artifact: ArtifactDef): { outcome?: CouncilOutcome; detail?: string } {
    const content = findDbContent(artifact)
    if (!content) return {}
    const council = tryParseCouncilResult(content)

    if (artifact.id.includes('winner')) {
      const winnerId = council?.winnerId
      return winnerId ? { outcome: 'completed', detail: `winner: ${getModelDisplayName(winnerId)}` } : {}
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

  const hasArtifacts = memberArtifacts.length > 0 || supplementalArtifacts.length > 0 || Boolean(prefixElement)
  if (!hasArtifacts) return null

  return (
    <>
      <div>
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-1">Artifacts</span>

        {memberArtifacts.length > 0 && (
          <div className="flex flex-row flex-wrap gap-2 mt-1">
            {memberArtifacts.map((artifact: CouncilMemberArtifactChip) => {
              const detailTone = artifact.outcome === 'failed' || artifact.outcome === 'invalid_output'
                ? 'text-red-400'
                : artifact.outcome === 'timed_out'
                  ? 'text-amber-400'
                  : 'text-blue-400'
              return (
                <ModelBadge
                  key={artifact.key}
                  modelId={artifact.modelId}
                  active={Boolean(artifact.isWinner)}
                  onClick={() => setViewingSelection({ kind: 'member', key: artifact.key })}
                  className="min-w-[220px] flex-1 px-3 py-2 h-auto items-start gap-2"
                >
                  <div className="min-w-0 text-left flex-1">
                    <div className="text-xs font-medium truncate">{getModelDisplayName(artifact.modelId)}</div>
                    <div className="text-[10px] opacity-80 mt-0.5">
                      {getCouncilStatusEmoji(artifact.outcome, artifact.action)} {getCouncilStatusLabel(artifact.outcome, artifact.action)}
                    </div>
                    {artifact.detail && <div className={`text-[10px] mt-0.5 ${detailTone}`}>{artifact.detail}</div>}
                  </div>
                </ModelBadge>
              )
            })}
          </div>
        )}

        {(supplementalArtifacts.length > 0 || prefixElement) && (
          <div className={`flex flex-row flex-wrap gap-2 ${memberArtifacts.length > 0 ? 'mt-2' : 'mt-1'}`}>
            {supplementalArtifacts.map((artifact) => {
              const artifactState = getArtifactState(artifact)
              const statusEmoji = artifactState.outcome
                ? getCouncilStatusEmoji(artifactState.outcome, action)
                : isCompleted ? '✅' : getCouncilStatusEmoji(undefined, action)
              return (
                <button
                  key={artifact.id}
                  onClick={() => setViewingSelection({ kind: 'supplemental', id: artifact.id })}
                  className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 hover:bg-accent/50 cursor-pointer transition-colors text-xs whitespace-nowrap"
                >
                  <span className="text-muted-foreground">{artifact.icon}</span>
                  <div className="text-left">
                    <span className="font-medium">{artifact.label}</span>
                    {artifactState.detail && <div className="text-[10px] text-blue-500">{artifactState.detail}</div>}
                  </div>
                  <span className="ml-auto shrink-0">{statusEmoji}</span>
                </button>
              )
            })}
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
