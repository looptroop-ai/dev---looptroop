# Contributing

LoopTroop is early-alpha local AI coding orchestration for repo-scale work. Contributions should preserve the core safety model: explicit approval gates, durable state, isolated git worktrees, and inspectable agent artifacts.

## Local Setup

```bash
npm install
npm run dev
```

Use the dashboard docs button or start from [Docs Home](docs/index.md) for the current architecture and workflow.

## Before Opening a PR

Run the checks that match your change:

```bash
npm run typecheck
npm run lint
npm test
```

For documentation-only changes, at least run:

```bash
npm run docs:build
```

## Contribution Guidelines

- Keep changes scoped to one behavior, workflow phase, or documentation topic.
- Add or update tests when changing state transitions, OpenCode orchestration, retry behavior, artifact formats, or UI review flows.
- Preserve human approval gates before irreversible actions.
- Avoid logging secrets, private repository contents beyond the needed artifact boundary, or raw model transcripts where summaries are enough.
- Update docs when changing terminology, phase behavior, environment variables, commands, or user-facing workflow.

## Security

Do not report vulnerabilities in public issues. Follow [Security Policy](SECURITY.md) for command execution, workspace isolation, prompt injection, secret exposure, and PR automation concerns.
