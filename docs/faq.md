# Frequently Asked Questions

If you're new to LoopTroop, some of the terminology and processes might seem unfamiliar. Here are answers to common questions about how LoopTroop works.

## What is a "Bead"?
A **Bead** is the smallest unit of executable work. Instead of telling the AI to "build this entire feature," LoopTroop breaks the feature down into a string of small, manageable tasks (Beads). 
Each bead has specific files to edit, acceptance criteria, and its own isolated testing phase. This prevents the AI from getting overwhelmed.

## Why use LoopTroop instead of just asking ChatGPT or Claude?
When you ask a chat interface to build a complex feature, it works well at first. But as the conversation grows, the AI suffers from **Context Degradation** (it starts forgetting earlier constraints or hallucinating). Furthermore, if it makes a mistake, it tries to fix it *within the same broken conversation*, often spiraling out of control.

LoopTroop solves this by:
1. Orchestrating a **Council** of AIs to plan the feature properly before writing any code.
2. Breaking the work into **Beads**.
3. Starting a **fresh, clean session** for every single coding attempt, giving the AI only the exact files and context it needs.

## What is the "Ralph Loop"?
If an AI model fails to write the correct code for a Bead, LoopTroop uses a bounded "Ralph-Style Retry." 
Instead of letting the AI apologize and try again in the same chat thread, LoopTroop:
1. Writes a "Wipe Note" (a short summary of what went wrong).
2. Hard resets the code back to the starting point.
3. Starts a completely new chat session with the fresh code and the Wipe Note.

This acts like taking a breather and starting over with a clear head, preventing the "death spiral" of bad code.

## Why does LoopTroop use multiple models (an LLM Council)?
Single-draft planning is risky because every AI model has blind spots. By forcing multiple models to draft plans independently, and then having them vote and refine the best ideas, you end up with a much more robust architecture and edge-case coverage. It's exactly like how human engineering teams review each other's work before merging a PR.

## Does LoopTroop edit my main codebase directly?
**No.** LoopTroop does all of its execution inside isolated `git worktrees`. This means your main branch and your current working directory remain completely untouched while the AI experiments and builds. Only when all tests pass and you approve the changes does it generate a Pull Request.

## How do I customize which AI models LoopTroop uses?
You configure your available models through your **OpenCode** server. We highly recommend using services like **OpenRouter** which aggregate many models (including high-quality free ones like `Llama-3.3-70B-Instruct`) so your AI Council has a diverse set of "brains" to draw from.

For more details, see the [Getting Started Guide](getting-started.md).
