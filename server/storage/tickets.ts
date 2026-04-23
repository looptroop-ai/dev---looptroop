// Barrel re-exports – all public API from sub-modules
export type {
  PublicTicket,
  PublicPhaseArtifactRow,
  TicketContext,
  TicketErrorOccurrence,
  TicketErrorResolutionStatus,
} from './ticketQueries'
export type { PublicTicketPhaseAttemptRow } from './ticketPhaseAttempts'
export {
  buildTicketRef,
  parseTicketRef,
  listTickets,
  getTicketByRef,
  findTicketRefByLocalId,
  getTicketContext,
  getTicketStorageContext,
  listNonTerminalTickets,
  getTicketPaths,
  findProjectExecutionBandConflict,
} from './ticketQueries'

export {
  createTicket,
  updateTicket,
  patchTicket,
  recordTicketErrorOccurrence,
  resolveLatestTicketErrorOccurrence,
  lockTicketStartConfiguration,
  deleteTicket,
} from './ticketMutations'

export {
  listPhaseArtifacts,
  getLatestPhaseArtifact,
  countPhaseArtifacts,
  insertPhaseArtifact,
  upsertLatestPhaseArtifact,
} from './ticketArtifacts'

export {
  INTERVIEW_EDIT_RESTART_PHASES,
  PRD_EDIT_RESTART_PHASES,
  isAttemptTrackedPhase,
  getActivePhaseAttempt,
  resolvePhaseAttempt,
  ensureActivePhaseAttempt,
  listPhaseAttempts,
  archiveActivePhaseAttempts,
  createFreshPhaseAttempts,
} from './ticketPhaseAttempts'
