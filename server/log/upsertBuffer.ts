/*
 * ── Upsert entry tracking ───────────────────────────────────────────────
 *
 * Streaming upsert events are NO LONGER flushed to disk. They are delivered
 * to the UI exclusively via SSE (broadcaster.broadcast in helpers.ts).
 * Only the final 'finalize' event is persisted to execution-log.jsonl.
 *
 * This buffer exists solely so that `removeBuffered(entryId)` can be called
 * when a finalize event arrives, keeping the tracked set clean. The periodic
 * flush-to-disk logic was removed because intermediate snapshots caused
 * quadratic content growth (each snapshot carried the full accumulated text,
 * producing ~90 progressive copies for a 5-minute streaming session).
 *
 * See LOG SIZE BUDGET comment in executionLog.ts for the full rationale.
 * ─────────────────────────────────────────────────────────────────────────
 */

const trackedEntries = new Set<string>()

export function bufferUpsert(entryId: string): void {
  trackedEntries.add(entryId)
}

export function removeBuffered(entryId: string): void {
  trackedEntries.delete(entryId)
}

export function startUpsertBuffer(): void {
  // No-op — kept for API compatibility with server/index.ts lifecycle hooks.
}

export function stopUpsertBuffer(): void {
  trackedEntries.clear()
}
