// Action stubs — referenced by ticketMachine via inline no-ops.
// These will be wired up when the corresponding infrastructure is ready.

export const persistState = () => {
  // TODO: Persist XState snapshot to SQLite via db.update(tickets).set({ snapshot })
  // so ticket state survives server restarts. See architecture.md §7.2.
}

export const persistBeadsTracker = () => {
  // TODO: Write bead progress to .looptroop/worktrees/<id>/.ticket/beads/issues.jsonl
  // after each bead completion. See architecture.md §6.3.
}

export const notifyFrontend = () => {
  // TODO: Call broadcaster.broadcast(ticketId, 'state_change', payload)
  // to push SSE events to connected frontend clients. The broadcaster
  // module exists at server/sse/broadcaster.ts.
}

export const gitCommitAndPush = () => {
  // TODO: Run git add (allowlisted paths only) + git commit + git push
  // on the ticket worktree branch. See architecture.md §8.1 for allowlist rules.
}

export const finalMergeToMain = () => {
  // TODO: Merge ticket branch to main via fast-forward or squash merge.
  // Requires squash.ts to produce a real commit first.
}
