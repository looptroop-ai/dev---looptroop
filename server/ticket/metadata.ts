import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { safeAtomicWrite } from '../io/atomicWrite'
import { detectGitBaseBranch, getTicketDir } from '../storage/paths'

export interface TicketMetaRecord {
  externalId?: string
  title?: string
  createdAt?: string
  baseBranch?: string
}

export function getTicketMetaPath(projectRoot: string, externalId: string): string {
  return resolve(getTicketDir(projectRoot, externalId), 'meta', 'ticket.meta.json')
}

export function readTicketMeta(projectRoot: string, externalId: string): TicketMetaRecord {
  const path = getTicketMetaPath(projectRoot, externalId)
  if (!existsSync(path)) return {}

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as TicketMetaRecord
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function writeTicketMeta(projectRoot: string, externalId: string, meta: TicketMetaRecord): TicketMetaRecord {
  const path = getTicketMetaPath(projectRoot, externalId)
  mkdirSync(dirname(path), { recursive: true })
  safeAtomicWrite(path, JSON.stringify(meta, null, 2))
  return meta
}

export function updateTicketMeta(
  projectRoot: string,
  externalId: string,
  patch: Partial<TicketMetaRecord>,
): TicketMetaRecord {
  const current = readTicketMeta(projectRoot, externalId)
  return writeTicketMeta(projectRoot, externalId, { ...current, ...patch })
}

export function resolveTicketBaseBranch(projectRoot: string, externalId: string): string {
  const meta = readTicketMeta(projectRoot, externalId)
  if (typeof meta.baseBranch === 'string' && meta.baseBranch.trim().length > 0) {
    return meta.baseBranch.trim()
  }

  const detected = detectGitBaseBranch(projectRoot)
  updateTicketMeta(projectRoot, externalId, { baseBranch: detected })
  return detected
}

export function getTicketBeadsDir(
  projectRoot: string,
  externalId: string,
  baseBranch?: string,
): string {
  const resolvedBaseBranch = baseBranch ?? resolveTicketBaseBranch(projectRoot, externalId)
  return resolve(getTicketDir(projectRoot, externalId), 'beads', resolvedBaseBranch, '.beads')
}

export function getTicketBeadsPath(
  projectRoot: string,
  externalId: string,
  baseBranch?: string,
): string {
  return resolve(getTicketBeadsDir(projectRoot, externalId, baseBranch), 'issues.jsonl')
}
