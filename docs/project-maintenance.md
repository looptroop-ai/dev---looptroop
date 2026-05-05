# Project Maintenance

LoopTroop stores project-local runtime state under `.looptroop/` inside each attached repository. This page covers maintenance tasks for that runtime data after a project has already been attached.

## Runtime Data and Git

When a project is attached, LoopTroop adds `/.looptroop/` to the repository-local `.git/info/exclude` file so runtime state stays out of normal Git status and future commits.

If `.looptroop` was already tracked before the project was attached, ticket startup is blocked to prevent nested or stale worktree data from being checked out into every new ticket worktree. Clean that repository with:

```bash
git rm --cached -r .looptroop
git commit -m "Stop tracking LoopTroop runtime data"
```

This removes LoopTroop runtime paths from the Git index without deleting the local runtime files from disk.

## Reclaiming Disk Space

Over time the `.looptroop/worktrees/` directory can grow large as completed and canceled tickets leave behind their code checkouts, execution logs, and generated files. You can reclaim that space without affecting your project or any active tickets.

1. Open **Settings -> Projects** and click **Edit** on the project you want to clean up.
2. Click **Free Disk Space...** at the bottom-left, next to **Delete Project**.
3. In the dialog, click **Calculate Size** to see how much space can be freed.
4. Click **Delete Worktrees** to remove the worktrees for all completed and canceled tickets.

**What gets deleted:** The temporary working directories (`.looptroop/worktrees/<ticket>/`) for every ticket in the Completed or Canceled column, including code checkouts, execution logs, and AI-generated file artifacts.

**What is preserved:**

- Your project's source code and every other file in the repository are never touched.
- Active, queued, or draft tickets are completely unaffected.
- All tickets remain visible in the dashboard with their descriptions and status. Only the logs and file-level artifacts become unavailable after cleanup.

## Related Docs

- [Getting Started](getting-started.md)
- [System Architecture](system-architecture.md)
- [Runtime Diagnostics](diagnostics.md)
