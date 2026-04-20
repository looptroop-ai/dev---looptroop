import { extractLogFingerprint } from '@shared/logIdentity'

interface IndexedLogRecord {
  index: number
  entry: Record<string, unknown>
}

function mergeFingerprintDuplicate(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {
    ...previous,
    ...next,
  }

  if (typeof previous.timestamp === 'string') {
    merged.timestamp = previous.timestamp
  }
  if (typeof previous.entryId === 'string') {
    merged.entryId = previous.entryId
  }

  const fingerprint = extractLogFingerprint(previous)
  if (fingerprint) {
    merged.fingerprint = fingerprint
  }

  return merged
}

export function foldPersistedLogEntries(entries: Record<string, unknown>[]): Record<string, unknown>[] {
  const passthrough: IndexedLogRecord[] = []
  const foldedStreaming = new Map<string, IndexedLogRecord>()
  const dedupedFingerprints = new Map<string, IndexedLogRecord>()

  entries.forEach((entry, index) => {
    const entryId = typeof entry.entryId === 'string' ? entry.entryId : undefined
    const op = typeof entry.op === 'string' ? entry.op : 'append'
    const fingerprint = extractLogFingerprint(entry)

    if (op !== 'append' && entryId) {
      const previous = foldedStreaming.get(entryId)
      if (!previous) {
        foldedStreaming.set(entryId, { index, entry })
        return
      }

      foldedStreaming.set(entryId, {
        index: previous.index,
        entry: { ...previous.entry, ...entry },
      })
      return
    }

    if (op === 'append' && fingerprint) {
      const previous = dedupedFingerprints.get(fingerprint)
      if (!previous) {
        dedupedFingerprints.set(fingerprint, { index, entry })
        return
      }

      dedupedFingerprints.set(fingerprint, {
        index: previous.index,
        entry: mergeFingerprintDuplicate(previous.entry, entry),
      })
      return
    }

    passthrough.push({ index, entry })
  })

  return [
    ...passthrough,
    ...Array.from(foldedStreaming.values()),
    ...Array.from(dedupedFingerprints.values()),
  ]
    .sort((a, b) => a.index - b.index)
    .map(item => item.entry)
}
