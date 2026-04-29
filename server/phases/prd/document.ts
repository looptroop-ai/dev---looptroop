import { eq } from 'drizzle-orm'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import type { PrdDocument } from '../../structuredOutput/types'
import { phaseArtifacts } from '../../db/schema'
import { safeAtomicWrite } from '../../io/atomicWrite'
import { clearContextCache } from '../../opencode/contextBuilder'
import { clearExecutionSetupState } from '../executionSetup/storage'
import { broadcaster } from '../../sse/broadcaster'
import { getActivePhaseAttempt, getTicketByRef, getTicketContext, getTicketPaths } from '../../storage/tickets'
import { upsertLatestPhaseArtifact } from '../../storage/ticketArtifacts'
import { normalizePrdYamlOutput } from '../../structuredOutput'
import { buildYamlDocument } from '../../structuredOutput/yamlUtils'
import { phaseIntermediate } from '../../workflow/phases/state'
import { nowIso } from '../../lib/dateUtils'

const BEADS_DOWNSTREAM_PHASES = new Set([
  'DRAFTING_BEADS',
  'COUNCIL_VOTING_BEADS',
  'REFINING_BEADS',
  'VERIFYING_BEADS_COVERAGE',
  'WAITING_BEADS_APPROVAL',
])

const BEADS_DOWNSTREAM_ARTIFACT_TYPES = new Set([
  'ui_state:approval_beads',
])

const PRD_APPROVAL_SNAPSHOT_ARTIFACT = 'approval_snapshot:prd'

function getPrdPath(ticketId: string): string {
  const paths = getTicketPaths(ticketId)
  if (!paths) {
    throw new Error('Ticket workspace not initialized')
  }
  return resolve(paths.ticketDir, 'prd.yaml')
}

function readPrdYaml(ticketId: string): string {
  const prdPath = getPrdPath(ticketId)
  if (!existsSync(prdPath)) {
    throw new Error('PRD artifact not found')
  }
  return readFileSync(prdPath, 'utf-8')
}

function readInterviewContent(ticketId: string): string {
  const paths = getTicketPaths(ticketId)
  if (!paths) throw new Error('Ticket workspace not initialized')
  const interviewPath = resolve(paths.ticketDir, 'interview.yaml')
  if (!existsSync(interviewPath)) throw new Error('Interview artifact not found')
  return readFileSync(interviewPath, 'utf-8')
}

function normalizePrdDocumentForTicket(ticketId: string, rawContent: string): PrdDocument {
  const ticket = getTicketByRef(ticketId)
  if (!ticket) {
    throw new Error('Ticket not found')
  }

  const interviewContent = readInterviewContent(ticketId)

  const result = normalizePrdYamlOutput(rawContent, {
    ticketId: ticket.externalId,
    interviewContent,
  })
  if (!result.ok) {
    throw new Error(result.error)
  }

  return {
    ...result.value,
    ticket_id: ticket.externalId,
    artifact: 'prd',
  }
}

export function writePrdDocument(ticketId: string, document: PrdDocument): string {
  const prdPath = getPrdPath(ticketId)
  const nextRaw = buildYamlDocument(document)
  safeAtomicWrite(prdPath, nextRaw)
  upsertLatestPhaseArtifact(
    ticketId,
    PRD_APPROVAL_SNAPSHOT_ARTIFACT,
    'WAITING_PRD_APPROVAL',
    JSON.stringify({ raw: nextRaw }),
  )
  return nextRaw
}

export function buildDraftPrdDocumentFromRawContent(
  ticketId: string,
  rawContent: string,
): PrdDocument {
  return toDraftPrdDocument(normalizePrdDocumentForTicket(ticketId, rawContent))
}

export function buildDraftPrdDocumentFromStructuredContent(
  ticketId: string,
  document: PrdDocument,
): PrdDocument {
  return buildDraftPrdDocumentFromRawContent(ticketId, buildYamlDocument(document))
}

export function readPrdDocument(ticketId: string): {
  raw: string
  document: PrdDocument
} {
  const raw = readPrdYaml(ticketId)
  return {
    raw,
    document: normalizePrdDocumentForTicket(ticketId, raw),
  }
}

export function buildApprovedPrdDocument(document: PrdDocument, approvedAt: string): PrdDocument {
  return {
    ...document,
    status: 'approved',
    approval: {
      ...document.approval,
      approved_by: 'user',
      approved_at: approvedAt,
    },
  }
}

export function toDraftPrdDocument(document: PrdDocument): PrdDocument {
  return {
    ...document,
    status: 'draft',
    approval: {
      ...document.approval,
      approved_by: '',
      approved_at: '',
    },
  }
}

export function approvePrdDocument(ticketId: string): {
  raw: string
  document: PrdDocument
} {
  const current = readPrdDocument(ticketId)
  const document = buildApprovedPrdDocument(current.document, nowIso())
  const raw = writePrdDocument(ticketId, document)
  return { raw, document }
}

export function invalidateDownstreamBeadsArtifacts(ticketId: string): {
  removedArtifacts: number
  removedFiles: string[]
} {
  const ticketContext = getTicketContext(ticketId)
  if (!ticketContext) {
    throw new Error('Ticket not found')
  }

  const removedFiles: string[] = []
  const ticketPaths = getTicketPaths(ticketId)
  if (ticketPaths) {
    const beadsDir = resolve(ticketPaths.ticketDir, 'beads')
    if (existsSync(beadsDir)) {
      rmSync(beadsDir, { recursive: true, force: true })
      removedFiles.push(beadsDir)
    }
  }

  const executionSetupInvalidation = clearExecutionSetupState(ticketId)
  removedFiles.push(...executionSetupInvalidation.removedFiles)

  const artifacts = ticketContext.projectDb
    .select()
    .from(phaseArtifacts)
    .where(eq(phaseArtifacts.ticketId, ticketContext.localTicketId))
    .all()

  let removedArtifacts = 0
  for (const artifact of artifacts) {
    const artifactType = artifact.artifactType ?? ''
    if (!BEADS_DOWNSTREAM_PHASES.has(artifact.phase) && !BEADS_DOWNSTREAM_ARTIFACT_TYPES.has(artifactType)) {
      continue
    }
    if (BEADS_DOWNSTREAM_PHASES.has(artifact.phase)) {
      const activeAttempt = getActivePhaseAttempt(ticketId, artifact.phase)
      if (activeAttempt != null && artifact.phaseAttempt !== activeAttempt) {
        continue
      }
    }
    ticketContext.projectDb
      .delete(phaseArtifacts)
      .where(eq(phaseArtifacts.id, artifact.id))
      .run()
    removedArtifacts += 1
  }

  phaseIntermediate.delete(`${ticketId}:beads`)
  clearContextCache(ticketId)

  removedArtifacts += executionSetupInvalidation.removedArtifacts

  if (removedArtifacts > 0 || removedFiles.length > 0) {
    broadcaster.broadcast(ticketId, 'artifact_change', {
      ticketId,
      invalidated: true,
      reason: 'prd_edit',
      removedArtifacts,
      removedFiles,
    })
  }

  return { removedArtifacts, removedFiles }
}

export function savePrdRawContent(
  ticketId: string,
  rawContent: string,
): {
  raw: string
  document: PrdDocument
  invalidation: { removedArtifacts: number; removedFiles: string[] }
} {
  return savePrdDocument(ticketId, buildDraftPrdDocumentFromRawContent(ticketId, rawContent))
}

export function savePrdStructuredContent(
  ticketId: string,
  document: PrdDocument,
): {
  raw: string
  document: PrdDocument
  invalidation: { removedArtifacts: number; removedFiles: string[] }
} {
  return savePrdDocument(ticketId, buildDraftPrdDocumentFromStructuredContent(ticketId, document))
}

export function savePrdDocument(
  ticketId: string,
  document: PrdDocument,
): {
  raw: string
  document: PrdDocument
  invalidation: { removedArtifacts: number; removedFiles: string[] }
} {
  const raw = writePrdDocument(ticketId, document)
  const invalidation = invalidateDownstreamBeadsArtifacts(ticketId)
  return { raw, document, invalidation }
}

export function saveApprovedPrdDocument(
  ticketId: string,
  document: PrdDocument,
): {
  raw: string
  document: PrdDocument
  invalidation: { removedArtifacts: number; removedFiles: string[] }
} {
  return savePrdDocument(ticketId, buildApprovedPrdDocument(document, nowIso()))
}
