import { useState, useMemo } from 'react'
// @ts-expect-error no type declarations for js-yaml
import jsYaml from 'js-yaml'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { FileText, Users, CheckCircle2, ChevronDown, ChevronRight, Trophy, Loader2 } from 'lucide-react'
import { getModelIcon, getModelDisplayName, ModelBadge } from '@/components/shared/ModelBadge'
import { useTicketArtifacts } from '@/hooks/useTicketArtifacts'

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

interface DBartifact {
  id: number
  ticketId: string
  phase: string
  artifactType: string
  filePath: string | null
  content: string | null
  createdAt: string
}

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

function getPhaseAction(phase: string): string {
  if (phase.includes('DELIBERATING') || phase.includes('DRAFTING')) return 'drafting'
  if (phase.includes('VOTING')) return 'scoring'
  if (phase.includes('COMPILING') || phase.includes('REFINING')) return 'refining'
  if (phase.includes('VERIFYING')) return 'verifying'
  return 'drafting'
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
function tryParseCouncilResult(content: string): any | null {
  try {
    const parsed = JSON.parse(content)
    if (parsed && (parsed.drafts || parsed.votes || parsed.winnerId)) return parsed
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
    const parsed = jsYaml.load(content)
    let items: any[] = []
    if (Array.isArray(parsed)) items = parsed
    else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).questions))
      items = (parsed as any).questions
    if (items.length > 0 && items.some((q: any) => q?.question || q?.prompt)) {
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
      } else if (/^\d+[\.\)]\s/.test(trimmed) || /^[-*]\s/.test(trimmed) || /^\*\*Q\d/i.test(trimmed) || trimmed.endsWith('?')) {
        const q = trimmed.replace(/^[-*\d\.\)]+\s*/, '').replace(/^\*\*/, '').replace(/\*\*$/, '')
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
  let parsedContent: any = null
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
  if (parsedContent && typeof parsedContent === 'object' && parsedContent.artifact === 'interview') {
    const qs = Array.isArray(parsedContent.questions) ? parsedContent.questions : []
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
    const questionsContent = parsedContent?.refinedContent || ''
    const answersJson = parsedContent?.userAnswers || '{}'

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
function VotingResultsView({ data }: { data: any }) {
  const votes = data.votes as Array<{ voterId: string; draftId: string; scores: Array<{ category: string; score: number }>; totalScore: number }>
  const winnerId = data.winnerId as string
  if (!votes || votes.length === 0) return <div className="text-xs text-muted-foreground italic">No voting data available</div>

  // Get unique drafts and voters
  const draftIds = [...new Set(votes.map(v => v.draftId))]
  const voterIds = [...new Set(votes.map(v => v.voterId))]
  const categories = votes[0]?.scores?.map(s => s.category) ?? []

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
      {/* Rankings */}
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

      {/* Score table */}
      {categories.length > 0 && (
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
              <div className="font-medium flex items-center gap-1">{getModelIcon(voterId)} {getModelDisplayName(voterId)}</div>
              {votes.filter(v => v.voterId === voterId).map(v => (
                <div key={v.draftId} className="ml-4 flex items-center gap-2 text-muted-foreground">
                  <span>→ {getModelDisplayName(v.draftId)}</span>
                  <span className="font-mono">{v.totalScore}pts</span>
                  {v.draftId === winnerId && <span className="font-bold text-[10px] text-primary bg-primary/10 px-1 rounded">winner</span>}
                </div>
              ))}
            </div>
          ))}
        </div>
      </CollapsibleSection>
    </div>
  )
}

function getPhaseArtifacts(phase: string, councilMemberCount: number = 3, councilMemberNames?: string[]): ArtifactDef[] {
  const memberLabel = (i: number) => {
    const raw = councilMemberNames?.[i]
    if (!raw) return `Model ${i + 1}`
    return raw.includes('/') ? raw.split('/').pop()! : raw
  }
  const memberIcon = (i: number) => {
    const raw = councilMemberNames?.[i]
    return raw ? getModelIcon(raw) : '⚪'
  }
  if (phase === 'COUNCIL_DELIBERATING') {
    return Array.from({ length: councilMemberCount }, (_, i) => ({
      id: `draft-${i + 1}`,
      label: `${memberIcon(i)} Interview Draft — ${memberLabel(i)}`,
      description: 'Independent question set draft',
      icon: <FileText className="h-3.5 w-3.5" />,
    }))
  }
  if (phase === 'COUNCIL_VOTING_INTERVIEW') {
    return [
      { id: 'votes', label: '⏳ Voting Results', description: 'Weighted scoring rubric results', icon: <Users className="h-3.5 w-3.5" /> },
      { id: 'winner-draft', label: '🏆 Winning Draft', description: 'Highest-scored interview draft', icon: <Trophy className="h-3.5 w-3.5" /> },
    ]
  }
  if (phase === 'COMPILING_INTERVIEW') {
    return [{ id: 'final-interview', label: '🔄 Final Interview Questions', description: 'Compiled question set', icon: <FileText className="h-3.5 w-3.5" /> }]
  }
  if (phase === 'WAITING_INTERVIEW_ANSWERS' || phase === 'VERIFYING_INTERVIEW_COVERAGE') {
    return [{ id: 'interview-answers', label: 'Interview Answers', description: 'User responses', icon: <FileText className="h-3.5 w-3.5" /> }]
  }
  if (phase === 'WAITING_INTERVIEW_APPROVAL') {
    return [{ id: 'interview-answers', label: 'Interview Answers', description: 'User responses', icon: <FileText className="h-3.5 w-3.5" /> }]
  }
  if (phase === 'DRAFTING_PRD') {
    return Array.from({ length: councilMemberCount }, (_, i) => ({
      id: `prd-draft-${i + 1}`,
      label: `${memberIcon(i)} PRD Draft — ${memberLabel(i)}`,
      description: 'Independent PRD draft',
      icon: <FileText className="h-3.5 w-3.5" />,
    }))
  }
  if (phase === 'COUNCIL_VOTING_PRD') {
    return [
      { id: 'prd-votes', label: '⏳ PRD Voting Results', description: 'Weighted scoring results', icon: <Users className="h-3.5 w-3.5" /> },
      { id: 'winner-prd-draft', label: '🏆 Winning PRD Draft', description: 'Highest-scored PRD draft', icon: <Trophy className="h-3.5 w-3.5" /> },
    ]
  }
  if (phase === 'REFINING_PRD' || phase === 'VERIFYING_PRD_COVERAGE' || phase === 'WAITING_PRD_APPROVAL') {
    return [{ id: 'refined-prd', label: '🔄 Refined PRD', description: 'Winning draft with improvements', icon: <FileText className="h-3.5 w-3.5" /> }]
  }
  if (phase === 'DRAFTING_BEADS') {
    return Array.from({ length: councilMemberCount }, (_, i) => ({
      id: `beads-draft-${i + 1}`,
      label: `${memberIcon(i)} Beads Draft — ${memberLabel(i)}`,
      description: 'Independent beads breakdown',
      icon: <FileText className="h-3.5 w-3.5" />,
    }))
  }
  if (phase === 'COUNCIL_VOTING_BEADS') {
    return [
      { id: 'beads-votes', label: '⏳ Beads Voting Results', description: 'Weighted scoring results', icon: <Users className="h-3.5 w-3.5" /> },
      { id: 'winner-beads-draft', label: '🏆 Winning Beads Draft', description: 'Highest-scored beads draft', icon: <Trophy className="h-3.5 w-3.5" /> },
    ]
  }
  if (phase === 'REFINING_BEADS' || phase === 'VERIFYING_BEADS_COVERAGE' || phase === 'WAITING_BEADS_APPROVAL') {
    return [{ id: 'refined-beads', label: '🔄 Refined Beads', description: 'Winning beads with improvements', icon: <FileText className="h-3.5 w-3.5" /> }]
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

  let parsedCoverageInput: any = null
  try {
    const p = JSON.parse(content)
    // Check if this looks like a coverage input JSON rather than CouncilResult
    if (p && !p.drafts && !p.votes && p.refinedContent) {
      parsedCoverageInput = p
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
      const winnerDraft = councilResult.drafts?.find((d: any) => d.memberId === councilResult.winnerId)
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

    // For individual draft views, extract the specific draft
    const draftIndex = artifactId?.match(/(\d+)$/)?.[1]
    const draftIdx = draftIndex ? parseInt(draftIndex, 10) - 1 : -1
    const draft = draftIdx >= 0 && councilResult.drafts?.[draftIdx]
    const draftContent = draft?.content ?? councilResult.refinedContent ?? councilResult.winnerContent ?? ''

    if (draftContent) {
      const isInterview = artifactId?.startsWith('draft') || artifactId?.includes('interview')
      const isPrd = artifactId?.includes('prd')
      const isBeads = artifactId?.includes('beads')

      // Show model info header for individual drafts
      const isWinner = draft.memberId === councilResult.winnerId && !phase?.includes('DELIBERATING') && !phase?.includes('DRAFTING')
      const header = draft ? (
        <div className="flex items-center gap-2 mb-4 pb-0">
          <ModelBadge
            modelId={draft.memberId}
            active={isWinner}
            className="flex-1 px-3 py-2 h-auto"
          >
            <div className="min-w-0 text-left flex-1">
              <div className="text-xs font-medium truncate">{getModelDisplayName(draft.memberId)}</div>
              <div className="text-[10px] mt-0.5 opacity-80 flex items-center gap-1 flex-wrap normal-case">
                <span>{draft.outcome === 'completed' ? '✅ Completed' : draft.outcome === 'timed_out' ? '⏰ Timed out' : '❌ Invalid output'}</span>
                {draft.duration ? <span>· {(draft.duration / 1000).toFixed(1)}s</span> : null}
                {isWinner && <span className="font-bold text-primary-foreground/90 ml-1">🏆 Winner</span>}
              </div>
            </div>
          </ModelBadge>
        </div>
      ) : null

      const structured = isInterview ? <InterviewDraftView content={draftContent} />
        : isPrd ? <PrdDraftView content={draftContent} />
          : isBeads ? <BeadsDraftView content={draftContent} />
            : null

      if (structured) return <>{header}{structured}</>
      // Fall through to raw rendering with header
      return <>{header}<RawContentView content={draftContent} /></>
    }
  }

  return <RawContentView content={content} />
}

export function PhaseArtifactsPanel({ phase, isCompleted, ticketId, councilMemberCount = 3, councilMemberNames, prefixElement, preloadedArtifacts }: PhaseArtifactsPanelProps) {
  const artifacts = getPhaseArtifacts(phase, councilMemberCount, councilMemberNames)
  const [viewingArtifact, setViewingArtifact] = useState<ArtifactDef | null>(null)
  const { artifacts: cachedArtifacts, isLoading: isLoadingArtifacts } = useTicketArtifacts(ticketId, { skipFetch: !!preloadedArtifacts })

  const dbArtifacts = preloadedArtifacts ?? cachedArtifacts

  if (artifacts.length === 0 && !prefixElement) return null
  if (artifacts.length === 0) {
    return <div className="flex flex-row flex-wrap gap-2">{prefixElement}</div>
  }

  const action = getPhaseAction(phase)

  const reversedArtifacts = useMemo(() => [...dbArtifacts].reverse(), [dbArtifacts])

  // Match a UI artifact def to the closest DB artifact for this phase
  function findDbContent(artifactDef: ArtifactDef): string | null {
    const prefix = artifactDef.id.split('-')[0] ?? ''

    // Map approval phases to the phase where their artifacts were actually generated
    const phaseMap: Record<string, string[]> = {
      'WAITING_INTERVIEW_APPROVAL': ['VERIFYING_INTERVIEW_COVERAGE', 'COMPILING_INTERVIEW'],
      'WAITING_PRD_APPROVAL': ['VERIFYING_PRD_COVERAGE', 'REFINING_PRD'],
      'WAITING_BEADS_APPROVAL': ['VERIFYING_BEADS_COVERAGE', 'REFINING_BEADS'],
    }
    const targetPhases = phaseMap[phase] || [phase]

    // Map UI artifact IDs to DB artifactTypes for verification inputs
    const typeMap: Record<string, string> = {
      'refined-prd': 'prd_coverage_input',
      'refined-beads': 'beads_coverage_input',
      'interview-answers': 'interview_coverage_input'
    }
    const expectedType = typeMap[artifactDef.id]

    if (expectedType) {
      const exactMatch = reversedArtifacts.find(a => targetPhases.includes(a.phase) && a.artifactType === expectedType)
      if (exactMatch) return exactMatch.content
    }

    // Try matching by artifactType first, then fall back to phase-only match
    const match = reversedArtifacts.find(a => targetPhases.includes(a.phase) && a.artifactType?.toLowerCase().includes(prefix))
      ?? reversedArtifacts.find(a => targetPhases.includes(a.phase) && a.content)
    return match?.content ?? null
  }

  // Extract outcome from DB artifact's CouncilResult for a specific draft index
  function getDraftOutcome(artifactDef: ArtifactDef): { outcome?: string; detail?: string } {
    const draftIndex = artifactDef.id.match(/(\d+)$/)?.[1]
    if (!draftIndex) return {}
    const content = findDbContent(artifactDef)
    if (!content) return {}
    const council = tryParseCouncilResult(content)
    if (!council?.drafts) return { detail: extractDraftDetail(content) }
    const idx = parseInt(draftIndex, 10) - 1
    const draft = council.drafts[idx]
    if (!draft) return {}
    const isWinner = draft.memberId === council.winnerId
    let detail = ''
    if (draft.outcome === 'timed_out') detail = 'no response received'
    else if (draft.outcome === 'invalid_output') detail = 'malformed response'
    else {
      const questionCount = draft.content ? parseInterviewQuestions(draft.content).length : 0
      if (questionCount > 0) detail = `proposed ${questionCount} questions`
      else {
        const lineCount = draft.content?.split('\n').filter((l: string) => l.trim()).length ?? 0
        if (lineCount > 0) detail = `${lineCount} lines generated`
      }
    }
    const isThinkingPhase = phase.includes('DELIBERATING') || phase.includes('DRAFTING')
    if (isWinner && draft.outcome === 'completed' && !isThinkingPhase) detail = 'Winner — refining draft'
    return { outcome: draft.outcome, detail }
  }

  return (
    <>
      <div>
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-1">Artifacts</span>
        <div className="flex flex-row flex-wrap gap-2 mt-1">
          {artifacts.map((artifact) => {
            const isDraft = artifact.id.match(/draft-\d+$/)
            const { outcome, detail } = isDraft ? getDraftOutcome(artifact) : {}
            const statusEmoji = outcome ? getStatusEmoji(outcome) : isCompleted ? '✅' : getStatusEmoji(undefined, action)
            return (
              <button
                key={artifact.id}
                onClick={() => setViewingArtifact(artifact)}
                className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 hover:bg-accent/50 cursor-pointer transition-colors text-xs whitespace-nowrap"
              >
                <span className="text-muted-foreground">{artifact.icon}</span>
                <div className="text-left">
                  <span className="font-medium">{artifact.label}</span>
                  {detail && <div className="text-[10px] text-blue-500">{detail}</div>}
                </div>
                <span className="ml-auto shrink-0">{statusEmoji}</span>
              </button>
            )
          })}
          {prefixElement}
        </div>
      </div>

      <Dialog open={!!viewingArtifact} onOpenChange={(open) => !open && setViewingArtifact(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              {viewingArtifact?.icon}
              {viewingArtifact?.label}
            </DialogTitle>
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
                  content={viewingArtifact ? (findDbContent(viewingArtifact) || `# ${viewingArtifact.label}\n\n${viewingArtifact.description}\n\nNo content available yet — artifact will be generated during this phase.`) : ''}
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
