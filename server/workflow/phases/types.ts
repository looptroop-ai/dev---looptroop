import type { DraftResult, MemberOutcome, Vote, VotePresentationOrder } from '../../council/types'
import type { PromptPart } from '../../opencode/types'
import type { TicketState } from '../../opencode/contextBuilder'

/** Intermediate data stored between draft→vote→refine state machine phases. */
export interface PhaseIntermediateData {
  drafts: DraftResult[]
  memberOutcomes: Record<string, MemberOutcome>
  contextBuilder?: (step: 'vote' | 'refine') => PromptPart[]
  worktreePath: string
  phase: string
  ticketState?: TicketState
  votes?: Vote[]
  presentationOrders?: Record<string, VotePresentationOrder>
  winnerId?: string
}

export type StructuredLogAudience = 'all' | 'ai' | 'debug'
export type StructuredLogKind = 'milestone' | 'reasoning' | 'text' | 'tool' | 'step' | 'session' | 'prompt' | 'error' | 'test'
export type StructuredLogOp = 'append' | 'upsert' | 'finalize'

export interface StructuredLogFields extends Record<string, unknown> {
  entryId: string
  audience: StructuredLogAudience
  kind: StructuredLogKind
  op: StructuredLogOp
  source: string
  modelId?: string
  sessionId?: string
  streaming?: boolean
  suppressDebugMirror?: boolean
}

export interface OpenCodeStreamState {
  seenFirstActivity: boolean
  liveKinds: Map<string, StructuredLogKind>
  liveContents: Map<string, string>
}
