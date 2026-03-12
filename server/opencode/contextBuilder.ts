import type { PromptPart } from './types'
import { logIfVerbose, warnIfVerbose } from '../runtime'

// Phase allowlists — only specified sources are included
// Phase allowlists derived from cl-prompt.md PROM context_input specs
const PHASE_ALLOWLISTS: Record<string, string[]> = {
  // PROM1: "Project codebase map + ticket details"
  interview_draft: ['codebase_map', 'ticket_details'],
  // PROM2: "Codebase map + ticket details + all interview drafts"
  interview_vote: ['codebase_map', 'ticket_details', 'drafts'],
  // PROM3: "Codebase map + ticket details + all interview drafts"
  interview_refine: ['codebase_map', 'ticket_details', 'drafts'],
  // PROM4: "Codebase map + ticket details + final question set + user answers so far"
  interview_qa: ['codebase_map', 'ticket_details', 'interview', 'user_answers'],
  // PROM5: "Ticket description + collected answers + current Interview Results"
  interview_coverage: ['ticket_details', 'user_answers', 'interview'],
  // PROM10: "Codebase map + ticket details + final Interview Results"
  prd_draft: ['codebase_map', 'ticket_details', 'interview'],
  // PROM11: "Codebase map + ticket details + final Interview Results + all PRD drafts"
  prd_vote: ['codebase_map', 'ticket_details', 'interview', 'drafts'],
  // PROM12: "Codebase map + ticket details + final Interview Results + all PRD drafts"
  prd_refine: ['codebase_map', 'ticket_details', 'interview', 'drafts'],
  // PROM13: "Final Interview Results + final PRD"
  prd_coverage: ['interview', 'prd'],
  // PROM20: "Codebase map + ticket details + final PRD"
  beads_draft: ['codebase_map', 'ticket_details', 'prd'],
  // PROM21: "Codebase map + ticket details + final PRD + all bead drafts"
  beads_vote: ['codebase_map', 'ticket_details', 'prd', 'drafts'],
  // PROM22: "Codebase map + ticket details + final PRD + all bead drafts"
  beads_refine: ['codebase_map', 'ticket_details', 'prd', 'drafts'],
  // PROM23: "Codebase map + ticket details + final PRD + refined beads draft"
  beads_expand: ['codebase_map', 'ticket_details', 'prd', 'beads_draft'],
  // PROM24: "Final PRD + Beads graph + tests"
  beads_coverage: ['prd', 'beads', 'tests'],
  // Execution: bead data + notes from previous iterations
  coding: ['bead_data', 'bead_notes'],
  // PROM51: "Current bead data + error context from failed iteration"
  context_wipe: ['bead_data', 'error_context'],
  // PROM52: "Ticket details + Interview Results + PRD + Beads list"
  final_test: ['ticket_details', 'interview', 'prd', 'beads'],
  // Pre-flight check
  preflight: ['codebase_map', 'ticket_details'],
}

// Token budget per call (approximate)
const DEFAULT_TOKEN_BUDGET = 100000
// Trim order: lowest priority sources removed first
// Maps trim key to the source names used in parts[]
const TRIM_PRIORITY: { key: string; sources: string[] }[] = [
  { key: 'error_context', sources: ['error_context'] },
  { key: 'bead_notes', sources: ['bead_note'] },
  { key: 'user_answers', sources: ['user_answers'] },
  { key: 'tests', sources: ['tests'] },
  { key: 'votes', sources: ['vote'] },
  { key: 'drafts', sources: ['draft'] },
  { key: 'beads_draft', sources: ['beads_draft'] },
  { key: 'beads', sources: ['beads'] },
  { key: 'interview', sources: ['interview'] },
  { key: 'prd', sources: ['prd'] },
  { key: 'codebase_map', sources: ['codebase_map'] },
  { key: 'ticket_details', sources: ['ticket_details'] },
]

// Simple token estimator (1 token ≈ 4 characters)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

// Context slice cache per ticket
const contextCache = new Map<string, { content: string; timestamp: number }>()
const CACHE_TTL = 300000 // 5 minutes

function getCachedContext(key: string): string | null {
  const cached = contextCache.get(key)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.content
  }
  contextCache.delete(key)
  return null
}

function setCachedContext(key: string, content: string) {
  contextCache.set(key, { content, timestamp: Date.now() })
}

function formatTicketDetails(title: string, description: string): string {
  const detail = description.trim() || 'No description provided.'
  return [
    '## Primary User Requirement For This Ticket',
    'This is the exact requirement provided by the user for this ticket. Treat it as the primary source of truth for scope and intent.',
    '',
    `# Ticket: ${title}`,
    detail,
  ].join('\n')
}

interface ContextSourcePart {
  source: string
  content: string
  order: number
}

function sortContextParts(parts: ContextSourcePart[]): ContextSourcePart[] {
  const priority = (source: string): number => {
    if (source === 'ticket_details') return 0
    return 1
  }

  return [...parts].sort((a, b) => {
    const priorityDiff = priority(a.source) - priority(b.source)
    if (priorityDiff !== 0) return priorityDiff
    return a.order - b.order
  })
}

export interface TicketState {
  ticketId: string
  title?: string
  description?: string
  userBackground?: string | null
  disableAnalogies?: boolean
  codebaseMap?: string
  interview?: string
  prd?: string
  beads?: string
  beadsDraft?: string
  drafts?: string[]
  votes?: string[]
  beadData?: string
  beadNotes?: string[]
  userAnswers?: string
  tests?: string
  errorContext?: string
}

export function buildMinimalContext(
  phase: string,
  ticketState: TicketState,
  activeItem?: string,
): PromptPart[] {
  const allowlist = PHASE_ALLOWLISTS[phase]
  if (!allowlist) {
    throw new Error(
      `Unknown phase: ${phase}. Valid phases: ${Object.keys(PHASE_ALLOWLISTS).join(', ')}`,
    )
  }

  logIfVerbose(`[contextBuilder] buildMinimalContext phase=${phase} ticket=${ticketState.ticketId} allowlist=[${allowlist.join(',')}]`)

  const parts: ContextSourcePart[] = []
  let order = 0

  // Assemble allowed context sources
  for (const source of allowlist) {
    const cacheKey = `${ticketState.ticketId}:${source}`

    switch (source) {
      case 'ticket_details': {
        const title = ticketState.title ?? 'Untitled'
        const desc = ticketState.description ?? ''
        const contentSections = [formatTicketDetails(title, desc)]
        if (phase === 'interview_qa' && ticketState.userBackground?.trim()) {
          contentSections.push(
            [
              '## User Interview Profile',
              `Background / expertise: ${ticketState.userBackground.trim()}`,
              ticketState.disableAnalogies
                ? 'Adapt phrasing to the user background, but avoid analogies unless they are essential for clarity.'
                : 'Adapt phrasing to the user background and use analogies only when they improve clarity.',
            ].join('\n'),
          )
        }
        const content = contentSections.join('\n\n')
        if (!desc) {
          warnIfVerbose(`[contextBuilder] ticket_details: description is empty for ticket=${ticketState.ticketId}`)
        }
        logIfVerbose(`[contextBuilder] ticket_details: title="${title}" descLength=${desc.length}`)
        parts.push({ source, content, order: order++ })
        break
      }
      case 'codebase_map': {
        const cached = getCachedContext(cacheKey)
        const content = cached ?? ticketState.codebaseMap ?? '# Codebase map not yet generated'
        if (!cached && ticketState.codebaseMap) setCachedContext(cacheKey, content)
        if (!ticketState.codebaseMap && !cached) {
          warnIfVerbose(`[contextBuilder] codebase_map: not available for ticket=${ticketState.ticketId}, using placeholder`)
        } else {
          logIfVerbose(`[contextBuilder] codebase_map: loaded (${content.length} chars, cached=${!!cached})`)
        }
        parts.push({ source, content, order: order++ })
        break
      }
      case 'interview': {
        const cached = getCachedContext(cacheKey)
        const content = cached ?? ticketState.interview ?? ''
        if (!cached && ticketState.interview) setCachedContext(cacheKey, content)
        if (content) parts.push({ source, content, order: order++ })
        break
      }
      case 'prd': {
        const cached = getCachedContext(cacheKey)
        const content = cached ?? ticketState.prd ?? ''
        if (!cached && ticketState.prd) setCachedContext(cacheKey, content)
        if (content) parts.push({ source, content, order: order++ })
        break
      }
      case 'beads': {
        const content = ticketState.beads ?? ''
        if (content) parts.push({ source, content, order: order++ })
        break
      }
      case 'drafts': {
        if (ticketState.drafts) {
          for (const draft of ticketState.drafts) {
            parts.push({ source: 'draft', content: draft, order: order++ })
          }
        }
        break
      }
      case 'votes': {
        if (ticketState.votes) {
          for (const vote of ticketState.votes) {
            parts.push({ source: 'vote', content: vote, order: order++ })
          }
        }
        break
      }
      case 'bead_data': {
        const content = ticketState.beadData ?? ''
        if (content) parts.push({ source, content, order: order++ })
        if (activeItem) {
          parts.push({ source: 'active_bead', content: `Active bead: ${activeItem}`, order: order++ })
        }
        break
      }
      case 'bead_notes': {
        if (ticketState.beadNotes) {
          for (const note of ticketState.beadNotes) {
            parts.push({ source: 'bead_note', content: note, order: order++ })
          }
        }
        break
      }
      case 'user_answers': {
        const content = ticketState.userAnswers ?? ''
        if (content) parts.push({ source, content, order: order++ })
        break
      }
      case 'tests': {
        const content = ticketState.tests ?? ''
        if (content) parts.push({ source, content, order: order++ })
        break
      }
      case 'error_context': {
        const content = ticketState.errorContext ?? ''
        if (content) parts.push({ source, content, order: order++ })
        break
      }
      case 'beads_draft': {
        const content = ticketState.beadsDraft ?? ''
        if (content) parts.push({ source, content, order: order++ })
        break
      }
    }
  }

  const orderedParts = sortContextParts(parts)

  // Apply token budget and trimming
  let totalTokens = orderedParts.reduce((sum, p) => sum + estimateTokens(p.content), 0)

  if (totalTokens > DEFAULT_TOKEN_BUDGET) {
    // Trim in priority order (lowest priority trimmed first)
    for (const { key, sources } of TRIM_PRIORITY) {
      if (totalTokens <= DEFAULT_TOKEN_BUDGET) break
      const matchSources = [key, ...sources]
      const idx = orderedParts.findIndex((p) => matchSources.includes(p.source))
      if (idx !== -1) {
        const part = orderedParts[idx]!
        totalTokens -= estimateTokens(part.content)
        orderedParts.splice(idx, 1)
      }
    }
  }

  logIfVerbose(`[contextBuilder] phase=${phase} assembled ${orderedParts.length} parts, totalTokens=${orderedParts.reduce((s, p) => s + estimateTokens(p.content), 0)}`)
  if (orderedParts.length === 0) {
    warnIfVerbose(`[contextBuilder] WARNING: context is empty for phase=${phase} ticket=${ticketState.ticketId}`)
  }

  // Convert to PromptParts
  return orderedParts.map((p) => ({
    type: 'text' as const,
    content: p.content,
    source: p.source,
  }))
}

// Clear cache for a specific ticket
export function clearContextCache(ticketId: string) {
  for (const key of contextCache.keys()) {
    if (key.startsWith(`${ticketId}:`)) {
      contextCache.delete(key)
    }
  }
}

// Export for testing
export { contextCache, PHASE_ALLOWLISTS }
