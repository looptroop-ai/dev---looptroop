# Operations Guide

This guide covers the parts of LoopTroop you deal with after the first run: startup maintenance, runtime storage, project-local Git hygiene, worktree cleanup, diagnostics, and common local service issues.

## Quick Reference

| Task | Start here |
| --- | --- |
| Start the full local stack | `npm run dev` |
| Start once without dependency/audit mutation | `LOOPTROOP_DEV_SKIP_DEPS=1 npm run dev` |
| Skip only the local OpenCode CLI upgrade | `LOOPTROOP_DEV_SKIP_OPENCODE_UPGRADE=1 npm run dev` |
| Force all startup maintenance now | `LOOPTROOP_DEV_FORCE_MAINTENANCE=1 npm run dev` |
| Show raw maintenance output | `LOOPTROOP_DEV_VERBOSE=1 npm run dev` |
| Diagnose slow UI or ticket refresh stalls | `npm run diagnose:stall` |
| Clean tracked LoopTroop runtime paths from a project | `git rm --cached -r .looptroop` inside the attached project |

## Runtime Storage

LoopTroop deliberately separates app-level state from project-level runtime state.

| Location | Contents | Notes |
| --- | --- | --- |
| `~/.config/looptroop/app.sqlite` | App settings, profiles, and attached-project registry | Override with `LOOPTROOP_CONFIG_DIR` or `LOOPTROOP_APP_DB_PATH` |
| `<project>/.looptroop/db.sqlite` | Project tickets, phase artifacts, attempts, sessions, status history, and error occurrences | Project-local operational database |
| `<project>/.looptroop/worktrees/<ticket>/` | Ticket-owned Git worktree and `.ticket/**` runtime artifacts | One worktree per ticket |
| `<ticket-worktree>/.ticket/runtime/` | Execution logs, stream state, locks, session records, temporary files, and state projection | Preserved or cleaned according to ticket outcome and cleanup choice |

LoopTroop adds `/.looptroop/` to the repository-local `.git/info/exclude` file when a project is attached. That keeps runtime state out of normal Git status without modifying the project's committed `.gitignore`.

## Startup Maintenance

`npm run dev` starts the frontend, backend, docs server, and OpenCode watcher stack. Before those services launch, LoopTroop runs a dev preflight that:

- upgrades the local `opencode` CLI to the latest available version when the binary is installed
- checks direct dependencies against npm `latest`
- updates stale direct dependencies to latest stable releases
- runs `npm audit fix` without `--force`
- prints an unresolved audit summary before the stack starts
- prints the startup plan for each dev service

This means `npm run dev` can intentionally mutate local dependency files when safe updates or audit fixes are available.

The expensive networked maintenance work is daily-gated. OpenCode CLI upgrade checks, direct dependency sync, and npm audit remediation run on the first local dev start of the day. If `package.json` or `package-lock.json` changes later the same day, the affected maintenance step runs again immediately.

## Maintenance Commands

Run the individual maintenance steps directly when you need tighter control:

```bash
npm run deps:sync
npm run audit:remediate
npm run opencode:upgrade
```

Use one-run startup flags when you want to change `npm run dev` behavior:

```bash
LOOPTROOP_DEV_SKIP_DEPS=1 npm run dev
LOOPTROOP_DEV_SKIP_OPENCODE_UPGRADE=1 npm run dev
LOOPTROOP_DEV_FORCE_MAINTENANCE=1 npm run dev
LOOPTROOP_DEV_VERBOSE=1 npm run dev
```

## Environment Variables

| Variable | Purpose |
| --- | --- |
| `LOOPTROOP_FRONTEND_PORT` | Override frontend port |
| `LOOPTROOP_FRONTEND_ORIGIN` | Override full frontend origin URL, for example `http://my-server:5173`; takes precedence over `LOOPTROOP_FRONTEND_PORT` |
| `LOOPTROOP_BACKEND_PORT` | Override backend port |
| `LOOPTROOP_DOCS_PORT` | Override docs port |
| `LOOPTROOP_DOCS_ORIGIN` | Override full docs origin URL, for example `http://my-server:5174`; takes precedence over `LOOPTROOP_DOCS_PORT` |
| `LOOPTROOP_OPENCODE_BASE_URL` | Point LoopTroop at a specific OpenCode server |
| `LOOPTROOP_CONFIG_DIR` | Override the app config directory |
| `LOOPTROOP_APP_DB_PATH` | Override the app database path directly |
| `LOOPTROOP_DEV_VERBOSE=1` | Print full dependency, audit, and process details during dev preflight |
| `LOOPTROOP_DEV_SKIP_DEPS=1` | Skip automatic dependency sync and audit remediation during `npm run dev` |
| `LOOPTROOP_DEV_SKIP_OPENCODE_UPGRADE=1` | Skip the automatic local OpenCode CLI upgrade during `npm run dev` |
| `LOOPTROOP_DEV_FORCE_MAINTENANCE=1` | Bypass the once-per-day maintenance gate and force all startup maintenance checks now |

Default local service addresses:

| Service | Address |
| --- | --- |
| Frontend | `http://localhost:5173` |
| Backend | `http://localhost:3000` |
| Docs | `http://localhost:5174` |
| OpenCode | `http://127.0.0.1:4096` |

## Project Git Hygiene

If `.looptroop` was already tracked before the project was attached, ticket startup is blocked with `INIT_LOOPTROOP_TRACKED`. This prevents nested or stale LoopTroop worktree data from being checked out into every new ticket worktree.

Clean that repository from the attached project root:

```bash
git rm --cached -r .looptroop
git commit -m "Stop tracking LoopTroop runtime data"
```

This removes LoopTroop runtime paths from the Git index without deleting the local runtime files from disk.

After cleanup, `git status --short .looptroop` should not show tracked `.looptroop` entries. Runtime files may still exist locally, but they should be ignored by the repo-local exclude.

## Worktree Disk Cleanup

Over time `.looptroop/worktrees/` can grow large as completed and canceled tickets leave behind code checkouts, execution logs, and generated file artifacts.

Use the UI cleanup flow:

1. Open **Settings -> Projects** and click **Edit** on the project you want to clean up.
2. Click **Free Disk Space...** at the bottom-left, next to **Delete Project**.
3. Click **Calculate Size** to see how much space can be freed.
4. Click **Delete Worktrees** to remove worktrees for completed and canceled tickets.

**Deleted:** temporary directories at `.looptroop/worktrees/<ticket>/` for tickets in the Completed or Canceled column, including code checkouts, execution logs, and AI-generated file artifacts.

**Preserved:**

- project source code and normal repository files
- active, queued, and draft ticket worktrees
- ticket records in the dashboard, including title, description, and status

## Diagnostics

If the UI feels slow, tickets disappear after refresh, or the app appears to stall, run the diagnostic command while `npm run dev` is still running:

```bash
npm run diagnose:stall
```

The report is saved under `tmp/diagnostics/` and includes endpoint latency, backend/frontend/OpenCode activity, whole-system CPU/RSS/I/O consumers, pressure-stall metrics, SQLite/WAL state, attached project health, active sessions, Git responsiveness, and a likely-causes summary.

Useful options:

```bash
npm run diagnose:stall -- --sample-ms 5000
npm run diagnose:stall -- --timeout-ms 8000
npm run diagnose:stall -- --trend-ms 120000 --trend-interval-ms 1000
```

For the full report guide, see [Runtime Diagnostics](diagnostics.md).

## OpenCode Reachability

Symptoms:

- the model list in the UI is empty
- ticket logs show connection errors
- phases that need a model block before drafting, setup, or execution

Checks:

1. Ensure OpenCode is running: `opencode serve`.
2. Ping the backend health endpoint: `curl http://localhost:3000/api/health/opencode`.
3. If OpenCode is on a non-default port, set `LOOPTROOP_OPENCODE_BASE_URL`, for example `export LOOPTROOP_OPENCODE_BASE_URL=http://127.0.0.1:4097`.

## Watcher and Filesystem Notes

The backend watcher prefers native file watching on normal local filesystems. Under WSL, mounted-drive workspaces such as `/mnt/...` can be slower and may need polling. LoopTroop auto-enables chokidar polling for those mounted-drive workspaces.

If your environment still misses file changes, force polling for the run:

```bash
CHOKIDAR_USEPOLLING=1 npm run dev
```

## Audit Warnings

Even after updating to the latest stable direct dependencies and running `npm audit fix`, some warnings can remain because the fix only exists upstream in a beta/prerelease line or has not shipped in stable yet.

- `better-sqlite3` still installs through deprecated `prebuild-install` on the latest stable line. LoopTroop keeps `better-sqlite3` for now instead of doing a driver migration just to remove that warning.
- `drizzle-kit` stable still depends on deprecated `@esbuild-kit/*`. The upstream issue is tracked here: [drizzle-team/drizzle-orm#3067](https://github.com/drizzle-team/drizzle-orm/issues/3067).
- `vitepress` stable still brings its own older Vite/esbuild line, so `npm audit` can report a leftover advisory until a new stable VitePress release lands: [GHSA-p9ff-h696-f583](https://github.com/advisories/GHSA-p9ff-h696-f583).
- `mermaid` stable still depends on `uuid < 14`. The current advisory targets `uuid` `v3`/`v5`/`v6` buffer writes and is tracked here: [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq).
- The older esbuild advisory commonly attached to Vite is documented by the Vite maintainers here: [vitejs/vite#19412](https://github.com/vitejs/vite/issues/19412).

## Related Docs

- [Getting Started](getting-started.md)
- [System Architecture](system-architecture.md)
- [Runtime Diagnostics](diagnostics.md)
- [OpenCode Integration](opencode-integration.md)
