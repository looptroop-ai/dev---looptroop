// Barrel re-exports – all public API from sub-modules
export type {
  PublicTicket,
  PublicPhaseArtifactRow,
  TicketContext,
  TicketErrorOccurrence,
  TicketErrorResolutionStatus,
} from './ticketQueries'
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
