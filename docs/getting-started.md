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

The main development command starts the frontend, backend, and the OpenCode watcher stack all at once.

```bash
npm run dev
```

By default, the services run on these ports:

| Service | Address |
| --- | --- |
| **Frontend** (UI) | `http://localhost:5173` |
| **Backend** (API) | `http://localhost:3000` |
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

### Environment Variables

If you need to customize ports or paths, you can use these environment variables:

| Variable | Purpose |
| --- | --- |
| `LOOPTROOP_FRONTEND_PORT` | Override frontend port |
| `LOOPTROOP_BACKEND_PORT` | Override backend port |
| `LOOPTROOP_OPENCODE_BASE_URL` | Point LoopTroop at a specific OpenCode server |
| `LOOPTROOP_CONFIG_DIR` | Override the app config directory |
| `LOOPTROOP_APP_DB_PATH` | Override the app database path directly |

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

## Next Steps

To dive deeper into how LoopTroop actually plans and executes your code, check out:
- [Core Philosophy](core-philosophy.md)
- [Frequently Asked Questions](faq.md)
