# Troubleshooting Guide

Common issues and solutions when using LoopTroop.

---

## Table of Contents

- [Installation Issues](#installation-issues)
- [OpenCode Issues](#opencode-issues)
- [Database Issues](#database-issues)
- [Git Issues](#git-issues)
- [AI Model Issues](#ai-model-issues)
- [Frontend Issues](#frontend-issues)
- [SSE / Streaming Issues](#sse--streaming-issues)
- [Performance Issues](#performance-issues)
- [Test Issues](#test-issues)
- [Common Error Messages](#common-error-messages)

---

## Installation Issues

### `npm install` fails with native module errors

**Symptom:** Errors related to `better-sqlite3` compilation

**Cause:** Missing build tools for native Node.js modules

**Fix:**
```bash
# Ubuntu/Debian
sudo apt-get install build-essential python3

# macOS
xcode-select --install

# Windows (WSL)
sudo apt-get install build-essential python3
```

### Node.js version mismatch

**Symptom:** `SyntaxError: Unexpected token` or module resolution errors

**Cause:** Wrong Node.js version (requires v24.x LTS)

**Fix:**
```bash
nvm install 24
nvm use 24
node --version  # Verify v24.x.x
```

### TypeScript errors on fresh install

**Symptom:** `npm run typecheck` shows errors after install

**Fix:**
```bash
rm -rf node_modules package-lock.json
npm install
npm run typecheck
```

---

## OpenCode Issues

### "Cannot connect to OpenCode server"

**Symptom:** Health check fails, ticket start is blocked

**Cause:** OpenCode server not running or on wrong port

**Fix:**
```bash
# Start OpenCode
opencode serve

# Verify it's running (default port 4096)
curl http://localhost:4096/health

# If using a different port, check OpenCode config
```

### "No models available"

**Symptom:** GET /api/models returns empty array

**Cause:** No AI models configured in OpenCode

**Fix:**
1. Open your OpenCode configuration
2. Add at least one AI provider with a valid API key
3. Restart OpenCode: `opencode serve`
4. Verify: `GET http://localhost:5173/api/models`

### OpenCode session reuse failures

**Symptom:** "Session not found" or "Invalid session" errors after restart

**Cause:** LoopTroop tries to reattach an expired/invalid OpenCode session

**Fix:** This is handled automatically — LoopTroop creates a fresh session if the old one is invalid. If the issue persists:
1. Stop LoopTroop
2. Restart OpenCode: `opencode serve`
3. Restart LoopTroop: `npm run dev`

---

## Database Issues

### "SQLITE_BUSY: database is locked"

**Symptom:** Operations fail intermittently with busy errors

**Cause:** Multiple processes competing for SQLite access

**Fix:**
1. Stop all LoopTroop processes
2. Check for zombie processes: `pgrep -f "tsx.*server"` and kill them
3. Restart: `npm run dev`

**Prevention:** LoopTroop uses WAL mode with a 5000ms busy timeout, which should handle normal concurrency. If you're running multiple instances, stop all but one.

### Database corruption

**Symptom:** Queries return errors or unexpected data

**Cause:** Rare — power failure during non-WAL write, or disk corruption

**Fix:**
```bash
# Check database integrity
sqlite3 .looptroop/db.sqlite "PRAGMA integrity_check;"

# If corrupt, the database must be recreated
# (tickets and state will be lost)
rm .looptroop/db.sqlite
npm run dev  # New database is created automatically
```

### Circuit breaker tripped

**Symptom:** "Circuit breaker OPEN" errors, all DB operations rejected

**Cause:** 3+ consecutive database failures

**Fix:** Wait for the cooldown period (30s), then operations will resume automatically. If the issue persists, restart the server.

---

## Git Issues

### "Working tree is not clean" during pre-flight

**Symptom:** PRE_FLIGHT_CHECK fails with git dirty error

**Cause:** Uncommitted changes in the project's git working tree

**Fix:**
```bash
cd /path/to/your/project
git status                    # See what's dirty
git add . && git commit -m "Clean up"  # Commit changes
# Then retry the ticket
```

### Git merge conflicts during integration

**Symptom:** INTEGRATING_CHANGES fails → BLOCKED_ERROR

**Cause:** Changes in the ticket branch conflict with main

**Fix:**
```bash
# Navigate to the ticket's worktree
cd /path/to/project/.looptroop/worktrees/<ticket-id>/

# Resolve conflicts manually
git status
# Edit conflicting files
git add <resolved-files>
git commit

# Then click Retry in the LoopTroop dashboard
```

### Worktree already exists

**Symptom:** Ticket start fails with "worktree already exists" error

**Cause:** A previous ticket used the same worktree path (edge case)

**Fix:**
```bash
# List worktrees
cd /path/to/your/project
git worktree list

# Remove the stale worktree
git worktree remove .looptroop/worktrees/<ticket-id> --force
# Then retry starting the ticket
```

---

## AI Model Issues

### Council quorum not met

**Symptom:** BLOCKED_ERROR with "Quorum not met" message

**Cause:** Too many council members timed out or returned invalid output

**Fix:**
1. Check if your AI provider is experiencing issues
2. Increase `councilResponseTimeout` in profile settings
3. Reduce `minCouncilQuorum` to 1 (single model mode)
4. Click Retry

### Model timeout during bead execution

**Symptom:** BLOCKED_ERROR during CODING phase

**Cause:** Bead implementation took longer than `perIterationTimeout`

**Fix:**
1. Increase `perIterationTimeout` in profile settings (try 60 min for complex beads)
2. Check if the bead is too large — consider editing the beads to make them smaller
3. Click Retry (the retry gets fresh context + previous attempt notes)

### Invalid model output

**Symptom:** "Invalid output" errors, repeated failures

**Cause:** AI model returning malformed responses

**Fix:**
1. Try a different model (edit profile or project council members)
2. If using a smaller model, switch to a more capable one
3. Check if the prompt is too complex — try simpler ticket descriptions

### Rate limiting

**Symptom:** Intermittent failures, "429 Too Many Requests" in logs

**Cause:** AI provider rate limits exceeded

**Fix:**
1. Increase timeouts to allow for rate limit cooldowns
2. Reduce the number of concurrent council members
3. Check your AI provider's rate limits and quotas

---

## Frontend Issues

### Blank page after starting

**Symptom:** `http://localhost:5173` shows blank page

**Cause:** Vite build error or missing dependencies

**Fix:**
```bash
# Check for build errors
npm run build

# If errors, reinstall dependencies
rm -rf node_modules
npm install
npm run dev
```

### SSE connection not established

**Symptom:** No real-time updates, ticket appears stuck

**Cause:** Vite proxy not forwarding SSE correctly

**Fix:**
1. Check browser DevTools → Network tab → Filter by "EventStream"
2. Look for the `/api/stream` connection
3. If missing, check that both frontend and backend are running
4. Hard refresh: Ctrl+Shift+R

### Dashboard doesn't update

**Symptom:** Ticket state changes but UI doesn't reflect them

**Cause:** SSE disconnected or TanStack Query cache stale

**Fix:**
1. Check SSE connection (Network tab → EventStream)
2. Close and reopen the ticket dashboard
3. If still stuck: refresh the browser page

---

## SSE / Streaming Issues

### Events not arriving

**Symptom:** Dashboard shows no activity for an active ticket

**Cause:** SSE connection dropped

**Fix:**
1. The client auto-reconnects after 3s — wait a moment
2. If still stuck: close and reopen the dashboard
3. Check browser console for WebSocket/SSE errors
4. Verify backend is running: `curl http://localhost:5173/api/health`

### Missing events after reconnection

**Symptom:** Some state changes were missed during a disconnect

**Cause:** Event buffer overflow (gap too large)

**Fix:** The server sends a full state refresh if the gap is too large. If the UI appears incorrect:
1. Close the ticket dashboard
2. Reopen it — a fresh state is loaded from the API
3. SSE reconnects and resumes real-time updates

### High latency / delayed updates

**Symptom:** Updates arrive seconds after they happen

**Cause:** Network congestion or server overloaded

**Fix:**
1. Check if the server is responsive: `curl http://localhost:5173/api/health`
2. Check system resources (CPU, memory)
3. If running many tickets: close completed ticket dashboards

---

## Performance Issues

### High memory usage

**Symptom:** Node.js process using > 2 GB RAM

**Fix:**
```bash
# Boot with increased memory limit
NODE_OPTIONS="--max-old-space-size=4096" npm run dev
```

### Slow startup

**Symptom:** Server takes > 30s to start

**Cause:** Many non-terminal tickets being hydrated

**Fix:**
1. Cancel or complete stale tickets
2. Terminal tickets (COMPLETED, CANCELED) are not hydrated — clean up old tickets

### Slow test execution

**Symptom:** `npm run test` takes > 60s

**Fix:** Tests use in-memory SQLite and don't connect to OpenCode. If slow:
```bash
# Run specific test files
npx vitest run server/machines/__tests__/ticketMachine.test.ts

# Run with reporter for debugging
npx vitest run --reporter=verbose
```

---

## Test Issues

### Tests pass locally but fail in CI

**Cause:** Environment differences (Node.js version, OS)

**Fix:** Ensure CI uses Node.js v24.x and has `build-essential` for native modules.

### Test database interference

**Cause:** Tests should use in-memory SQLite (`:memory:`)

**Verification:**
```bash
# Run tests and check for database files
npm run test
ls /tmp/looptroop-test-*  # Should see temporary directories
```

---

## Common Error Messages

| Error | Meaning | Fix |
|-------|---------|-----|
| `Circuit breaker OPEN` | Too many consecutive failures | Wait 30s, then retry |
| `Quorum not met` | Not enough council members responded | Increase timeout or reduce quorum |
| `Session not found` | OpenCode session expired | Automatic — fresh session created |
| `SQLITE_BUSY` | Database locked | Stop other processes, restart |
| `Pre-flight: git not clean` | Uncommitted changes | Commit or stash changes |
| `Max iterations reached` | Bead failed too many times | Edit bead spec, then retry |
| `Invalid completion marker` | AI didn't output BEAD_STATUS correctly | Retry (fresh context) |
| `BLOCKED_ERROR` | Ticket needs user intervention | Check error details, retry or cancel |
