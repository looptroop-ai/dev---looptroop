import { readFileSync, existsSync } from 'node:fs'
import { getTicketPaths } from '../../storage/tickets'
import { upsertLatestPhaseArtifact } from '../../storage/ticketArtifacts'

function nowIso(): string {
  return new Date().toISOString()
}

function resolveBeadsPath(ticketId: string): string {
  const paths = getTicketPaths(ticketId)
  if (!paths) {
    throw new Error('Ticket workspace not initialized')
  }
  return paths.beadsPath
}

export function approveBeadsDocument(ticketId: string): {
  beadCount: number
  approvedAt: string
} {
  const beadsPath = resolveBeadsPath(ticketId)
  if (!existsSync(beadsPath)) {
    throw new Error('Beads artifact not found')
  }

  const content = readFileSync(beadsPath, 'utf-8')
  const lines = content.split('\n').filter((line) => line.trim() !== '')
  const beadCount = lines.length

  if (beadCount === 0) {
    throw new Error('Beads artifact is empty')
  }

  // Validate that all lines are valid JSON objects with required fields
  for (const [index, line] of lines.entries()) {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      throw new Error(`Invalid JSON at bead line ${index + 1}`)
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(`Bead at line ${index + 1} is not a JSON object`)
    }
    const record = parsed as Record<string, unknown>
    if (typeof record.id !== 'string' || !record.id.trim()) {
      throw new Error(`Bead at line ${index + 1} is missing a valid "id" field`)
    }
    if (typeof record.title !== 'string' || !record.title.trim()) {
      throw new Error(`Bead at line ${index + 1} is missing a valid "title" field`)
    }
  }

  const approvedAt = nowIso()
  const approvalReceipt = JSON.stringify({
    approved_by: 'user',
    approved_at: approvedAt,
    bead_count: beadCount,
  })

  upsertLatestPhaseArtifact(ticketId, 'approval_receipt', 'WAITING_BEADS_APPROVAL', approvalReceipt)

  return { beadCount, approvedAt }
}
