// Persistence and SSE notification are handled by the subscription in
// persistence.ts (attachPersistenceSubscription). No inline action stubs
// are needed — the subscription fires on every actor snapshot change and
// calls persistSnapshot(), which writes to SQLite and broadcasts via SSE.
