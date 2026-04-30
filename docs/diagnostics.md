# Runtime Diagnostics

LoopTroop includes a local runtime diagnostic command for investigating slow refreshes, intermittent stalls, missing tickets after reload, OpenCode reachability problems, and machine-level resource pressure.

Run it while `npm run dev` is already running, ideally during the slowdown:

```bash
npm run diagnose:stall
```

The command writes a timestamped report under `tmp/diagnostics/`, for example:

```text
tmp/diagnostics/runtime-stall-YYYYMMDD-HHMMSS.log
```

## Platform Support

The diagnostic script runs on **Linux**, **WSL2**, **macOS**, and **Windows**.

| Feature | Linux/WSL | macOS | Windows |
|---|---|---|---|
| Process `/proc` inspection | ✅ | — | — |
| Pressure-stall metrics | ✅ | — | — |
| Cgroup resource snapshot | ✅ | — | — |
| TCP stats | ✅ (ss) | ✅ (netstat) | ✅ (netstat) |
| FD limits | ✅ | ✅ | — |
| Zombie process count | ✅ | ✅ | — |
| macOS vm_stat / top | — | ✅ | — |
| Shell baseline | bash / sh | bash / sh | PowerShell |

## What It Captures

The report is read-only. It does not repair state, mutate tickets, or modify attached projects.

It captures:

- **Disk Write Latency** — Direct measurement of storage responsiveness (crucial for WSL/mounted drive diagnostics).
- frontend, backend, ticket-list, project-list, startup-status, and OpenCode health probe latency
- repeated backend health and ticket-list samples
- a 3-minute runtime observation window that samples backend health, `/api/tickets`, watched process CPU/RSS/I/O, Linux pressure deltas, and app/project DB/WAL/log growth
- backend, frontend, and OpenCode process memory, thread, wait-state, file descriptor, CPU, and I/O activity
- whole-system top CPU, RSS, read-I/O, and write-I/O consumers during the sample window
- system load, memory, Linux pressure-stall metrics, cgroup resource state, `vmstat`, and `iostat` or `/proc/diskstats`
- workspace, app DB, and attached-project mount, disk, inode, SQLite, WAL, and filesystem latency data
- attached project ticket counts, active OpenCode sessions, recent ticket states, execution-log tail, and git responsiveness
- **Advanced Diagnostics**: event-loop lag, DNS probe, FD limits, TCP connection states, zombie process count, diagnostic heap snapshot, and swap pressure
- macOS-specific: `vm_stat`, load average, CPU count, and top processes (macOS only)

## Useful Options

```bash
npm run diagnose:stall -- --timeout-ms 8000
```

Use a larger timeout if the app is already struggling and you want slow probes to complete instead of timing out quickly.

```bash
npm run diagnose:stall -- --sample-ms 5000
```

Use a longer sample window when CPU or I/O spikes are brief and hard to catch. The default is `1000ms`.

```bash
npm run diagnose:stall -- --trend-ms 120000 --trend-interval-ms 1000
```

Use a different trend window when you need to catch changing latency, process spikes, pressure-stall movement, or growing DB/WAL/log files over time. The default is `180000ms` (3 minutes); pass `--trend-ms 0` to disable it.

```bash
npm run diagnose:stall -- --backend-port 3001 --frontend-port 5175 --opencode-url http://127.0.0.1:4097
```

Use explicit ports if you started the stack with non-default runtime ports.

```bash
npm run diagnose:stall -- --no-color
```

Disable colored output. Useful when piping or running in CI. Also respected via the `NO_COLOR` environment variable.

## Reading The Report

Read the report by category:

- **🔍 ENVIRONMENT & CONFIGURATION**: Resolved ports, PIDs, shell startup latency, and backend env vars.
- **🌐 NETWORK & ENDPOINT HEALTH**: HTTP probe results for frontend, backend, and OpenCode.
- **🔁 STALL CORRELATION SAMPLES**: Repeated backend/ticket probes — whether the app was actually unresponsive during capture.
- **Runtime Observation Trend**: Per-interval backend health, `/api/tickets`, watched process, pressure, and file-growth changes, plus aggregate spikes and totals.
- **⚙️ APPLICATION PROCESS ACTIVITY**: Per-process CPU, I/O, FD counts, and memory for backend, frontend, and OpenCode.
- **💻 SYSTEM RESOURCES**: Pressure-stall metrics, cgroup state, uptime, memory, and top process consumers.
- **💾 STORAGE, MOUNTS & FILESYSTEM**: Mount type, disk space, inodes, and filesystem latency for workspace and project paths.
- **🗄️ DATABASE & PROJECT STATE**: App DB and project DB inspection, WAL/SHM file sizes, ticket and session state.
- **🔀 GIT RESPONSIVENESS**: Git status, Trace2 perf output, and branch resolution for attached projects.
- **🧬 ADVANCED DIAGNOSTICS**: Event-loop lag, DNS probe for localhost, FD limits, TCP states, zombie count, diagnostic heap, and swap pressure.

For intermittent stalls, save at least one report from a healthy moment and one from a slow moment. The differences are usually more useful than either report alone.
