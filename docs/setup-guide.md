# Setup Guide

This guide reflects the current local development setup for LoopTroop.

## Prerequisites

You need:

- Node.js and npm
- git
- a GitHub-backed repository to attach as a project
- an OpenCode server

LoopTroop is designed around attached git repositories whose `origin` resolves to GitHub.

## Install

```bash
npm install
```

## Start The Dev Stack

The main development command starts frontend, backend, and the OpenCode watcher stack.

```bash
npm run dev
```

Current defaults:

| Service | Default |
| --- | --- |
| Frontend | `http://localhost:5173` |
| Backend | `http://localhost:3000` |
| OpenCode | `http://127.0.0.1:4096` |

Useful alternatives:

```bash
npm run dev:app
npm run dev:frontend
npm run dev:backend
npm run dev:opencode
```

## Environment Variables

| Variable | Purpose |
| --- | --- |
| `LOOPTROOP_FRONTEND_PORT` | Override frontend port |
| `LOOPTROOP_BACKEND_PORT` | Override backend port |
| `LOOPTROOP_FRONTEND_ORIGIN` | Override backend CORS origin |
| `LOOPTROOP_OPENCODE_BASE_URL` | Point LoopTroop at a specific OpenCode server |
| `LOOPTROOP_OPENCODE_MODE` | Use `mock` to switch to the mock adapter |
| `LOOPTROOP_CONFIG_DIR` | Override the app config directory |
| `LOOPTROOP_APP_DB_PATH` | Override the app database path directly |
| `OPENCODE_SERVER_USERNAME` | Optional OpenCode basic-auth username |
| `OPENCODE_SERVER_PASSWORD` | Optional OpenCode basic-auth password |

Example:

```bash
export LOOPTROOP_OPENCODE_BASE_URL=http://127.0.0.1:4096
export LOOPTROOP_BACKEND_PORT=3000
export LOOPTROOP_FRONTEND_PORT=5173
npm run dev
```

## First Run Behavior

On startup the backend:

1. initializes the databases
2. creates indexes
3. recovers orphan temp files and log corruption where possible
4. checks OpenCode health
5. hydrates ticket actors from attached project databases
6. attempts to reconnect owned OpenCode sessions

This is why the app can resume long-running work after restarts.

## Project Attachment Requirements

A folder must pass these checks before it can be attached:

- it exists
- it is inside a git repository
- its repository `origin` resolves to GitHub

The frontend uses:

- `GET /api/projects/check-git?path=...`
- `GET /api/projects/ls?path=...`

to drive that flow.

## Filesystem Layout

App-level storage:

```text
~/.config/looptroop/
  app.sqlite
```

Project-level storage:

```text
<project>/.looptroop/
  db.sqlite
  worktrees/
    <ticket>/
      .ticket/
        relevant-files.yaml
        interview.yaml
        prd.yaml
        beads/
          <flow>/
            .beads/
              issues.jsonl
        runtime/
          execution-log.jsonl
          state.yaml
          execution-setup-profile.json
```

## Verification Commands

Useful local checks:

```bash
npm run typecheck
npm run lint
npm run test
```

More targeted commands:

```bash
npm run test:client
npm run test:server
npm run build
```

## Troubleshooting

### OpenCode Is Not Reachable

Symptoms:

- `/api/models` returns an empty list with a message
- `/api/health/opencode` reports `unavailable`

Checks:

```bash
opencode serve
curl http://localhost:3000/api/health/opencode
```

If you use a non-default base URL, set `LOOPTROOP_OPENCODE_BASE_URL`.

### Backend Starts On The Wrong Port

LoopTroop's current default backend port is `3000`. If you see older docs or scripts mentioning `3001`, ignore them and use the current config in `shared/appConfig.ts`.

### App State Location

If you need the app DB somewhere else, set either:

- `LOOPTROOP_CONFIG_DIR`
- `LOOPTROOP_APP_DB_PATH`

The second variable wins if both are set.

## Related Docs

- [System Architecture](system-architecture.md)
- [Database Schema](database-schema.md)
- [API Reference](api-reference.md)
