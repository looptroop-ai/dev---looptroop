// Barrel re-exports – all public API from sub-modules
export type { PublicTicket, PublicPhaseArtifactRow, TicketContext } from './ticketQueries'
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
} from './ticketQueries'

export {
  createTicket,
  updateTicket,
  patchTicket,
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
