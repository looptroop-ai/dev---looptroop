# Getting Started

Welcome to LoopTroop! This guide will take you from zero to running your first AI-driven development cycle on your repository.

> [!TIP]
> LoopTroop works best when it has a powerful "Council" of AI models to brainstorm ideas. You don't need a massive budget to get started—check out the **Free AI Models** section below!

## 1. Prerequisites

You need a few basic developer tools:

- **Node.js** and **npm**
- **git**
- A local git repository that has an `origin` pointing to GitHub.
- An **OpenCode** server running locally (this handles the interaction with AI models).

## 2. Setting Up Your AI Council (For Free!)

LoopTroop relies on an OpenCode server to connect to AI models. You can configure OpenCode to use **OpenRouter**, which provides access to many highly capable models for free. 

This means you can have a full "AI Council" brainstorming and reviewing your code without spending a dime.

> [!NOTE]
> **Recommended Free Models via OpenRouter:**
> - `meta-llama/llama-3.3-70b-instruct:free`
> - `google/gemma-2-27b-it:free` (or `gemma-4-31b-it:free`)
> - `deepseek/deepseek-r1:free`
> - `nvidia/nemotron-4-340b-instruct:free`
>
> *(Note: Free model availability on OpenRouter changes dynamically, so check their site for the latest list.)*

### How to connect OpenCode to OpenRouter:
When running `opencode serve`, ensure your environment variables are set to use OpenRouter as your provider and supply your OpenRouter API key. See the OpenCode documentation for exact provider configuration.

## 3. Installation

Clone the LoopTroop repository and install the dependencies:

```bash
npm install
```

## 4. Starting the Application

The main development command starts the frontend, backend, docs, and the OpenCode watcher stack all at once.

```bash
npm run dev
```

Before the watchers launch, LoopTroop now runs a dev preflight that:

- checks your direct dependencies against npm `latest`
- updates behind direct dependencies to the latest stable releases
- runs `npm audit fix` without `--force`
- prints a concise unresolved audit summary before the stack starts

That means `npm run dev` is intentionally **mutating** when it finds stale direct dependencies or safe audit fixes.

If you want a non-mutating startup for a single run, use:

```bash
LOOPTROOP_DEV_SKIP_DEPS=1 npm run dev
```

If you want the raw maintenance/install output, use:

```bash
LOOPTROOP_DEV_VERBOSE=1 npm run dev
```

By default, the services run on these ports:

| Service | Address |
| --- | --- |
| **Frontend** (UI) | `http://localhost:5173` |
| **Backend** (API) | `http://localhost:3000` |
| **Docs** | `http://localhost:5174` |
| **OpenCode** | `http://127.0.0.1:4096` |

> [!IMPORTANT]
> If OpenCode is running on a different port, you can tell LoopTroop where to find it using an environment variable:
> `export LOOPTROOP_OPENCODE_BASE_URL=http://127.0.0.1:YOUR_PORT`

## 5. Attaching Your First Project

Once the frontend is up:
1. Open `http://localhost:5173` in your browser.
2. Click **Add Project** and provide the absolute path to your local git repository.
3. LoopTroop will verify that it is a valid git repository with a GitHub origin.
4. You're ready to create your first Ticket!

---

## Advanced Configuration & Troubleshooting

### Manual Maintenance Commands

If you want to run the maintenance steps outside `npm run dev`, these scripts use the same shared logic:

```bash
npm run deps:sync
npm run audit:remediate
```

### Environment Variables

If you need to customize ports or paths, you can use these environment variables:

| Variable | Purpose |
| --- | --- |
| `LOOPTROOP_FRONTEND_PORT` | Override frontend port |
| `LOOPTROOP_BACKEND_PORT` | Override backend port |
| `LOOPTROOP_DOCS_PORT` | Override docs port |
| `LOOPTROOP_OPENCODE_BASE_URL` | Point LoopTroop at a specific OpenCode server |
| `LOOPTROOP_CONFIG_DIR` | Override the app config directory |
| `LOOPTROOP_APP_DB_PATH` | Override the app database path directly |
| `LOOPTROOP_DEV_VERBOSE=1` | Print full dependency/audit/process details during dev preflight |
| `LOOPTROOP_DEV_SKIP_DEPS=1` | Skip automatic dependency sync and audit remediation during `npm run dev` |

### Where is my data saved?

LoopTroop safely isolates its data so it doesn't mess with your main repository.

- **App Settings & Globals:** `~/.config/looptroop/app.sqlite`
- **Project Specific Data:** Inside your attached project folder, inside `.looptroop/`.
- **Execution Data:** When a ticket is running, all work is done in isolated worktrees (e.g., `.looptroop/worktrees/<ticket>/.ticket/`).

### Troubleshooting: OpenCode Is Not Reachable

**Symptoms:**
- The model list in the UI is empty.
- You see connection errors in the logs.

**Checks:**
1. Ensure OpenCode is actually running: `opencode serve`.
2. Ping the health endpoint: `curl http://localhost:3000/api/health/opencode`.
3. If using a non-default base URL, double check your `LOOPTROOP_OPENCODE_BASE_URL` variable.

### Expected Remaining Stable-Upstream Warnings

Even after updating to the latest stable direct dependencies and running `npm audit fix`, some warnings can still remain because the fix only exists upstream in a beta/prerelease line or has not shipped in stable yet.

- `better-sqlite3` still installs through deprecated `prebuild-install` on the latest stable line. LoopTroop keeps `better-sqlite3` for now instead of doing a driver migration just to remove that warning.
- `drizzle-kit` stable still depends on deprecated `@esbuild-kit/*`. The upstream issue is tracked here: [drizzle-team/drizzle-orm#3067](https://github.com/drizzle-team/drizzle-orm/issues/3067).
- `vitepress` stable still brings its own older Vite/esbuild line, so `npm audit` can report a leftover advisory until a new stable VitePress release lands: [GHSA-p9ff-h696-f583](https://github.com/advisories/GHSA-p9ff-h696-f583).
- `mermaid` stable still depends on `uuid < 14`. The current advisory targets `uuid` `v3`/`v5`/`v6` buffer writes and is tracked here: [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq).
- The older esbuild advisory commonly attached to Vite is documented by the Vite maintainers here: [vitejs/vite#19412](https://github.com/vitejs/vite/issues/19412).

## Next Steps

To dive deeper into how LoopTroop actually plans and executes your code, check out:
- [Core Philosophy](core-philosophy.md)
- [Frequently Asked Questions](faq.md)
