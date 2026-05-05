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

The main development command starts the frontend, backend, docs, and the OpenCode watcher stack all at once. It also runs the normal startup maintenance checks for dependencies, npm audit fixes, and the local OpenCode CLI.

```bash
npm run dev
```

For non-mutating startup, forced maintenance, verbose startup output, and manual maintenance commands, see [Operations Guide](operations.md).

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

## Operations and Troubleshooting

For runtime storage, environment variables, startup maintenance, disk cleanup, diagnostics, and OpenCode troubleshooting, see [Operations Guide](operations.md).

## Next Steps

To dive deeper into how LoopTroop actually plans and executes your code, check out:
- [Core Philosophy](core-philosophy.md)
- [Frequently Asked Questions](faq.md)
