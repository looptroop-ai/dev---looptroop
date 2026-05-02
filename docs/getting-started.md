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

## 💸 Configuring Free AI Models

You no longer need to burn expensive tokens to run autonomous agents. LoopTroop supports all major API Gateways that provide state-of-the-art **Mixture-of-Experts (MoE)** models for free. 

### Option A: OpenRouter Free Models (Recommended)
OpenRouter provides a unified API with a dynamic router that automatically selects available zero-cost models.

1. Create a free account at [https://openrouter.ai/](https://openrouter.ai/).
2. In your project's `.env` file set:
   ```bash
   PROVIDER=openrouter
   OPENROUTER_API_KEY="your-api-key"
   ```
3. **Select the Model:** 
   * **The Auto-Router:** Set your model to `openrouter/free`. LoopTroop will automatically route tasks to available free models capable of tool-calling.
   * **Specific High-Capacity Free Models:** 
     * `nvidia/nemotron-3-super-120b-a12b:free` (120B parameters, 1M context window)
     * `qwen/qwen3-coder:free` (480B parameters, best for heavy repository logic)
     * `inclusionai/ling-2.6-flash:free` (Extremely fast, highly token-efficient)
     * `google/gemma-4-31b-it:free` (Excellent for multimodal tasks)

### Option B: NVIDIA NIM API Catalog
NVIDIA provides highly optimized, GPU-accelerated endpoints. Signing up gives you 1,000 base credits (up to 5,000 total trial credits).

1. Go to [build.nvidia.com](https://build.nvidia.com/) and create a Developer account.
2. Generate a personal key in the API Keys section.
3. In your `.env` file:
   ```bash
   PROVIDER=nvidia-nim
   NVIDIA_API_KEY="your-ngc-api-key"
   ```
4. **Recommended Free/Trial Models:**
   * `nemotron-3-super-120b-a12b`
   * `nemotron-3-nano-30b-a3b`
   * `mistral-small-4-119b-2603`

### Option C: OpenCode Free Network
OpenCode curates a validated list of models specifically benchmarked for agentic coding. 

1. Obtain your OpenCode API key from [opencode.ai](https://opencode.ai).
2. In your `.env` file:
   ```bash
   PROVIDER=opencode
   OPENCODE_API_KEY="your-opencode-key"
   ```
3. **Recommended Free Models:**
   * `big-pickle`
   * `nemotron-3-super-free`
   * `minimax-m2.5-free`
   * `mimo-v2-pro-free`

---

## 📊 Latency & Model Tracking Tools

Because free APIs can occasionally experience rate-limiting or latency spikes, the community maintains active trackers to help you route your agents efficiently:

*   **(https://github.com/ShaikhWarsi/free-ai-tools):** The master directory of over 550 free APIs, IDEs, and local RAG stacks. Check this repository frequently for newly added free models and quota details.
*   **(https://github.com/BlockRunAI/ClawRouter):** An open-source routing layer that tracks the real-time latency of top-tier free models and handles load balancing.
*   **[https://github.com/jyoung105/frouter](https://github.com/jyoung105/frouter):** A fast CLI tool to ping free models and test Time To First Token (TTFT) before starting your loop. 

---

### How to connect OpenCode to OpenRouter:
When running `opencode serve`, ensure your environment variables are set to use OpenRouter as your provider and supply your OpenRouter API key. See the OpenCode documentation for exact provider configuration.

## 3. Installation

Clone the LoopTroop repository and install the dependencies:

```bash
git clone https://github.com/looptroop-ai/LoopTroop.git
cd LoopTroop
npm install
```

## 4. Starting the Application

The main development command starts the frontend, backend, docs, and the OpenCode watcher stack all at once. (you can even skip npm install as this command will do that too)

```bash
npm run dev
```

Before the watchers launch, LoopTroop now runs a dev preflight that:

- upgrades the local `opencode` CLI to the latest available version when the binary is installed
- checks your direct dependencies against npm `latest`
- updates behind direct dependencies to the latest stable releases
- runs `npm audit fix` without `--force`
- prints a concise unresolved audit summary before the stack starts
- prints a startup plan showing which command is used for each dev service and why it is being launched

That means `npm run dev` is intentionally **mutating** when it finds a stale local OpenCode CLI, stale direct dependencies, or safe audit fixes.

To keep startup fast, the expensive networked maintenance work is daily-gated during normal `npm run dev` usage. The OpenCode CLI upgrade check, direct dependency sync, and npm audit remediation run on the first local dev start of the day. If `package.json` or `package-lock.json` changes later the same day, the affected maintenance step runs again immediately.

If you want a non-mutating startup for a single run, use:

```bash
LOOPTROOP_DEV_SKIP_DEPS=1 npm run dev
```

If you only want to skip the local OpenCode CLI upgrade step, use:

```bash
LOOPTROOP_DEV_SKIP_OPENCODE_UPGRADE=1 npm run dev
```

If you want to bypass the once-per-day gate and force all maintenance checks on this run, use:

```bash
LOOPTROOP_DEV_FORCE_MAINTENANCE=1 npm run dev
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

The backend watcher now prefers native file watching on normal local filesystems and only auto-enables chokidar polling for mounted-drive workspaces such as `/mnt/...` under WSL. You can still override that manually with `CHOKIDAR_USEPOLLING=1` if your environment needs it.

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
npm run opencode:upgrade
```

### Runtime Stall Diagnostics

If the UI feels slow, tickets disappear after refresh, or the app appears to stall, run the diagnostic command while `npm run dev` is still running:

```bash
npm run diagnose:stall
```

The report is saved under `tmp/diagnostics/` and includes endpoint latency, backend/frontend/OpenCode activity, whole-system CPU/RSS/I/O consumers, pressure-stall metrics, SQLite/WAL state, attached project health, active sessions, git responsiveness, and a `Likely Causes` summary.

Use `--sample-ms <ms>` to catch longer CPU or I/O spikes, and `--timeout-ms <ms>` if the app is already responding slowly. See [Runtime Diagnostics](diagnostics.md) for the full report guide.

### Environment Variables

If you need to customize ports or paths, you can use these environment variables:

| Variable | Purpose |
| --- | --- |
| `LOOPTROOP_FRONTEND_PORT` | Override frontend port |
| `LOOPTROOP_FRONTEND_ORIGIN` | Override full frontend origin URL (e.g. `http://my-server:5173`); takes precedence over `LOOPTROOP_FRONTEND_PORT` |
| `LOOPTROOP_BACKEND_PORT` | Override backend port |
| `LOOPTROOP_DOCS_PORT` | Override docs port |
| `LOOPTROOP_DOCS_ORIGIN` | Override full docs origin URL (e.g. `http://my-server:5174`); takes precedence over `LOOPTROOP_DOCS_PORT` |
| `LOOPTROOP_OPENCODE_BASE_URL` | Point LoopTroop at a specific OpenCode server |
| `LOOPTROOP_CONFIG_DIR` | Override the app config directory |
| `LOOPTROOP_APP_DB_PATH` | Override the app database path directly |
| `LOOPTROOP_DEV_VERBOSE=1` | Print full dependency/audit/process details during dev preflight |
| `LOOPTROOP_DEV_SKIP_DEPS=1` | Skip automatic dependency sync and audit remediation during `npm run dev` |
| `LOOPTROOP_DEV_SKIP_OPENCODE_UPGRADE=1` | Skip the automatic local OpenCode CLI upgrade during `npm run dev` |
| `LOOPTROOP_DEV_FORCE_MAINTENANCE=1` | Bypass the once-per-day maintenance gate and force all startup maintenance checks now |

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
