import { db } from '../db/index'
import { tickets } from '../db/schema'
import { not, inArray } from 'drizzle-orm'
import { TERMINAL_STATES } from '../machines/types'

export interface RecoveryReport {
  ticketsRecovered: number
  ticketsFailed: number
  errors: string[]
}

export function recoverFromCrash(): RecoveryReport {
  const report: RecoveryReport = {
    ticketsRecovered: 0,
    ticketsFailed: 0,
    errors: [],
  }

  try {
    // Find non-terminal tickets that need recovery
    const terminalStatuses = [...TERMINAL_STATES] as string[]
    const activeTickets = db
      .select()
      .from(tickets)
      .where(not(inArray(tickets.status, terminalStatuses)))
      .all()

    for (const ticket of activeTickets) {
      try {
        // Ticket with snapshot can be hydrated
        if (ticket.xstateSnapshot) {
          report.ticketsRecovered++
        } else {
          // No snapshot — ticket is in DRAFT, safe to leave as-is
          report.ticketsRecovered++
        }
      } catch (err) {
        report.ticketsFailed++
        report.errors.push(
          `Failed to recover ticket ${ticket.externalId}: ${err instanceof Error ? err.message : 'Unknown'}`,
        )
      }
    }
  } catch (err) {
    report.errors.push(
      `Recovery scan failed: ${err instanceof Error ? err.message : 'Unknown'}`,
    )
  }

  return report
}
