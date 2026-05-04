# AGENTS.md

## Core Agent Rules

### Documentation
- **Always keep documentation up to date**. Whenever you add, remove, or change functionality, update **all** relevant documentation.
- For any status that is modified, also update:
  - The status description
  - The detailed description (the content shown when clicking the "Details" button)

### Decision Making
- If there are multiple valid ways forward or you are uncertain about the best approach, **ask me for clarification** before proceeding.

### Planning & Scope
- Do **not** spend time making existing projects or tickets backward compatible.
- Existing projects/tickets can be deleted if it simplifies the solution.
- Prefer keeping existing projects/tickets when possible, but do not force compatibility.
- You are free to create new tickets or even new projects for testing or implementation purposes.

### Efficiency
- Use **sub-agents** or **parallel agents** whenever it improves efficiency.
- Especially during the **implementation phase** of a plan, leverage sub-agents for parallel work.

### Impact Analysis
- Consider and document how the proposed changes will impact **other parts** of the application.

### Verification & Quality
- After finishing changes, always run:
  - Linters
  - Tests (unit + relevant integration)
  - Any other required checks
- Fix **all** failing tests, lint errors, and warnings — even those unrelated to the current task.
- Do **not** perform end-to-end tests or full lifecycle testing. The user will handle these manually.

## Git Workflow
- Check if anything new should be added to `.gitignore`.
- **Commit only the files you modified or created** during this session.
- **Never** use `git add .` or `git commit -a`.
- **Under no circumstances** should you delete, stage, or touch existing uncommitted files (e.g. other work-in-progress files in the working directory).
- **Always create a detailed commit message** that clearly explains:
  - What was changed; Why it was changed; Key implementation decisions; Any side effects or areas impacted.
- After committing your changes, push to the current branch.

### UI Changes
- Use available agent skills/tools for UI modifications.
- If you need up-to-date documentation (especially for OpenCode or new frameworks), search online.

### Status System Improvements
- When modifying or creating statuses, review previous/high-quality statuses in the project.
- Apply best practices regarding:
  - Strict output formats
  - Better prompts
  - Parsers
  - Any other relevant patterns

## Development Environment

- **Primary start command**: `npm run dev`
- **Primary environment**: WSL
- **Preferred browser**: Thorium

> **Important**: Although the developer mainly uses WSL + Thorium, **this project is OS, projects and terminal agnostic**.
> Do not hardcode WSL-specific paths, commands, or assumptions. All scripts and instructions should work on macOS, Linux, and Windows (PowerShell/WSL) where possible.
