# Setup Guide

A complete step-by-step guide to installing and running LoopTroop.

---

## Table of Contents

- [System Requirements](#system-requirements)
- [Step 1: Install Node.js 24.x](#step-1-install-nodejs-24x)
- [Step 2: Install OpenCode](#step-2-install-opencode)
- [Step 3: Configure AI Models](#step-3-configure-ai-models)
- [Step 4: Install LoopTroop](#step-4-install-looptroop)
- [Step 5: Prepare Your Project](#step-5-prepare-your-project)
- [Step 6: Start Everything](#step-6-start-everything)
- [Step 7: First-Time Configuration](#step-7-first-time-configuration)
- [Verifying the Installation](#verifying-the-installation)
- [Environment Recommendations](#environment-recommendations)

---

## System Requirements

| Requirement | Minimum | Recommended |
|------------|---------|-------------|
| **RAM** | 4 GB | 8 GB+ |
| **Disk Space** | 15 GB free | 50 GB+ |
| **Node.js** | v24.x LTS | v24.x LTS |
| **OS** | Linux / macOS / Windows (WSL) | Linux or WSL |
| **Git** | 2.x+ | Latest |
| **Network** | Internet access (for AI APIs) | Stable broadband |

### Important Notes

- **Sleep/Hibernation:** Your host system must be configured to prevent sleep/hibernation during execution. Bead execution can run for 10+ hours unattended.
- **Isolation:** It's strongly recommended to run LoopTroop in an isolated environment (VM, container, VPS, or disposable cloud desktop). The AI agents have full read/write access to your project folder.
- **Memory:** For long unattended runs, boot Node.js with `--max-old-space-size=4096`.

---

## Step 1: Install Node.js 24.x

### Using nvm (recommended)

```bash
# Install nvm if you haven't
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash

# Restart your terminal, then:
nvm install 24
nvm use 24
nvm alias default 24

# Verify
node --version   # Should show v24.x.x
npm --version    # Should show 10.x.x+
```

### Using Official Installer

Download from [nodejs.org](https://nodejs.org/) and install the v24.x LTS package for your OS.

### Using Package Manager (Linux)

```bash
# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs

# Fedora/RHEL
curl -fsSL https://rpm.nodesource.com/setup_24.x | sudo bash -
sudo dnf install -y nodejs
```

---

## Step 2: Install OpenCode

OpenCode is the AI gateway that LoopTroop uses to communicate with AI models. It runs as a separate long-lived background process.

```bash
# Install OpenCode CLI
# (See https://opencode.ai for the latest installation instructions)

# Verify installation
opencode --version
```

OpenCode runs on **port 4096** by default. LoopTroop connects to it as a client using the `@opencode-ai/sdk` package.

---

## Step 3: Configure AI Models

Before using LoopTroop, you need at least one AI model configured in OpenCode.

```bash
# Edit your OpenCode configuration
# (location depends on your OS and OpenCode version)

# Add API keys for your AI providers
# Example providers: Anthropic (Claude), OpenAI (GPT-4), Google (Gemini)
```

For the best results with LoopTroop's council pipeline, configure **3 or more models** from different providers. This enables diverse drafts during the council deliberation phases.

### Model Recommendations

| Use Case | Recommended Models |
|----------|-------------------|
| **Main Implementer** | Claude 3.5 Sonnet, GPT-4 Turbo |
| **Council Members** | Mix of Claude, GPT-4, Gemini Pro |
| **Minimum Setup** | 1 model (council disabled, single-draft mode) |
| **Recommended Setup** | 3-4 models for full council deliberation |

---

## Step 4: Install LoopTroop

```bash
# Clone the repository
git clone https://github.com/liviux/test-sonnet.git
cd test-sonnet

# Install all dependencies
npm install
```

This installs:
- Frontend dependencies (React 19, Tailwind CSS, shadcn/ui, TanStack Query)
- Backend dependencies (Hono, better-sqlite3, Drizzle ORM, XState v5)
- Development tools (Vitest, TypeScript, ESLint, Vite)

No database setup is needed — SQLite is initialized automatically on first run with WAL mode pragmas.

---

## Step 5: Prepare Your Project

LoopTroop works with git-initialized project repositories. For each project you want to manage:

```bash
# Navigate to your project
cd /path/to/your/project

# Initialize git (if not already)
git init
git add .
git commit -m "Initial commit"

# Ensure there's a clean working tree (no uncommitted changes)
git status  # Should show "nothing to commit"
```

### What LoopTroop Does with Your Project

When you start a ticket, LoopTroop:
1. Creates a directory at `.looptroop/` in your project root
2. Creates an isolated git worktree at `.looptroop/worktrees/<ticket-id>/`
3. Works exclusively in that worktree (never touches your main branch directly)
4. On completion, squashes commits and merges to main

---

## Step 6: Start Everything

You need **two terminal windows** (or use the combined command):

### Terminal 1: Start OpenCode

```bash
opencode serve
```

This starts the OpenCode server on port 4096. Keep this running.

### Terminal 2: Start LoopTroop

```bash
cd /path/to/test-sonnet
npm run dev
```

This starts both:
- **Vite frontend** at `http://localhost:5173`
- **Hono backend** with hot reload

### Single-Terminal Alternative

If you prefer, you can start just the components you need:

```bash
# Frontend only
npm run dev:frontend

# Backend only
npm run dev:backend

# Both together (default: npm run dev)
npm run dev
```

### For Long Unattended Runs

```bash
NODE_OPTIONS="--max-old-space-size=4096" npm run dev
```

Open your browser to **http://localhost:5173**.

---

## Step 7: First-Time Configuration

1. **Open the app** at `http://localhost:5173`
2. **Create your profile** (click the gear/config button):
   - **Username** — Your display name
   - **Background** — Your expertise level (optional, affects interview style)
   - **Main Implementer** — Select your primary AI model for coding tasks
   - **Council Members** — Select 2-4 AI models for council deliberation
   - Leave other settings at defaults initially
3. **Create a project** (click "New Project"):
   - **Name** — Your project's name
   - **Shortname** — 3-5 uppercase letters (e.g., `PROJ`)
   - **Folder Path** — Absolute path to your git repo
4. **Create a ticket** (click "New Ticket"):
   - **Title** — What you want built
   - **Description** — Detailed requirements
   - **Project** — Select your project

You're ready to go! Click "Start" on your ticket to begin the AI council pipeline.

---

## Verifying the Installation

Run these commands to verify everything is working:

```bash
# 1. Check TypeScript types
npm run typecheck
# Expected: no errors

# 2. Check code quality
npm run lint
# Expected: 0 errors (4 pre-existing warnings are normal)

# 3. Run all tests
npm run test
# Expected: 238 tests pass across 22 files

# 4. Verify build
npm run build
# Expected: successful build output
```

---

## Environment Recommendations

### Development (your machine)

```bash
# Simple setup for trying out LoopTroop
opencode serve &
npm run dev
```

### Production / Long Runs (isolated environment)

```bash
# Recommended: run in a VM or container
# Prevent sleep/hibernation
# Use tmux or screen for persistence

tmux new -s looptroop
NODE_OPTIONS="--max-old-space-size=4096" npm run dev

# Detach with Ctrl+B, then D
# Reattach with: tmux attach -t looptroop
```

### Docker (future)

Docker support is planned but not yet available. For now, use a VM or native installation.
