import { describe, expect, it } from 'vitest'
import {
  describePortOccupants,
  formatPortOccupantLabel,
  formatPortOccupantSummary,
  inspectPortOccupants,
  listPortOccupantPids,
} from '../scripts/port-occupants'

describe('port occupant inspection', () => {
  it('prefers lsof results, enriches them with ps and cwd data, and keeps the ss snapshot for verbose logs', () => {
    const inspection = inspectPortOccupants(4096, {
      runCommand: (file, args) => {
        if (file === 'lsof') {
          return [
            'COMMAND     PID  USER   FD   TYPE DEVICE SIZE/OFF NODE NAME',
            'kilo       3251 liviu   19u  IPv4  11146      0t0  TCP 127.0.0.1:4096 (LISTEN)',
            'node      15556 liviu   28u  IPv4 429721      0t0  TCP 127.0.0.1:4096 (LISTEN)',
          ].join('\n')
        }

        if (file === 'ss') {
          return [
            'State  Recv-Q Send-Q  Local Address:Port  Peer Address:PortProcess',
            'LISTEN 0      512     127.0.0.1:4096     0.0.0.0:*    users:(("kilo",pid=3251,fd=19))',
          ].join('\n')
        }

        if (file === 'ps' && args[1] === '3251') {
          return '3251 3058 kilo /home/liviu/.vscode-server/bin/kilo serve --port 0'
        }

        if (file === 'ps' && args[1] === '15556') {
          return '15556 15500 node /mnt/d/LoopTroop/node_modules/.bin/vite'
        }

        return null
      },
      readCwd: (pid) => {
        if (pid === 3251) return '/mnt/c/Users/avana/AppData/Local/Programs/Microsoft VS Code Insiders'
        if (pid === 15556) return '/mnt/d/LoopTroop'
        return null
      },
    })

    expect(inspection.rawSocketSnapshot).toContain('127.0.0.1:4096')
    expect(inspection.occupants).toEqual([
      {
        pid: 3251,
        ppid: 3058,
        program: 'kilo',
        command: '/home/liviu/.vscode-server/bin/kilo serve --port 0',
        cwd: '/mnt/c/Users/avana/AppData/Local/Programs/Microsoft VS Code Insiders',
        source: 'lsof',
      },
      {
        pid: 15556,
        ppid: 15500,
        program: 'node',
        command: '/mnt/d/LoopTroop/node_modules/.bin/vite',
        cwd: '/mnt/d/LoopTroop',
        source: 'lsof',
      },
    ])
  })

  it('falls back to ss when lsof is unavailable and dedupes repeated pid entries', () => {
    const pids = listPortOccupantPids(5173, {
      runCommand: (file, args) => {
        if (file === 'lsof') {
          return null
        }

        if (file === 'ss') {
          return [
            'State  Recv-Q Send-Q  Local Address:Port  Peer Address:PortProcess',
            'LISTEN 0      511     127.0.0.1:5173     0.0.0.0:*    users:(("node-MainThread",pid=15556,fd=28),("node-MainThread",pid=15556,fd=30))',
          ].join('\n')
        }

        if (file === 'ps' && args[1] === '15556') {
          return '15556 15500 node /mnt/d/LoopTroop/node_modules/.bin/vite'
        }

        return null
      },
      readCwd: () => '/mnt/d/LoopTroop',
    })

    expect(pids).toEqual([15556])
  })

  it('caps formatted output to the first two occupants and appends the overflow count', () => {
    const label = formatPortOccupantLabel([
      { pid: 1, program: 'alpha', command: 'alpha serve' },
      { pid: 2, program: 'beta', command: 'beta watch' },
      { pid: 3, program: 'gamma', command: 'gamma worker' },
    ])

    expect(label).toBe(
      'Occupants: alpha (pid 1, cmd: alpha serve); beta (pid 2, cmd: beta watch) (+1 more).',
    )
  })

  it('falls back to pid-only summaries and generic wording when richer details are unavailable', () => {
    expect(formatPortOccupantSummary({ pid: 404 })).toBe('pid 404')
    expect(describePortOccupants(4096, {
      port: 4096,
      occupants: [],
      rawSocketSnapshot: null,
    })).toBe('Port 4096 is in use by another process.')
  })

  it('shows the full cwd path without shortening it', () => {
    expect(formatPortOccupantSummary({
      pid: 3251,
      program: 'kilo',
      command: 'kilo serve --port 0',
      cwd: '/mnt/c/Users/avana/AppData/Local/Programs/Microsoft VS Code Insiders',
    })).toBe(
      'kilo (pid 3251, cmd: kilo serve --port 0, cwd: /mnt/c/Users/avana/AppData/Local/Programs/Microsoft VS Code Insiders)',
    )
  })
})
