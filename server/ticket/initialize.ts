import { mkdirSync, writeFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { generateCodebaseMapYaml } from './codebaseMap'

interface InitializeOptions {
  externalId: string
  projectFolder: string
}

export interface InitializeTicketResult {
  success: boolean
  created: boolean
  ticketDir: string
  codebaseMapPath: string
  error?: string
}

export function initializeTicket(options: InitializeOptions): InitializeTicketResult {
  const ticketRoot = resolve(process.cwd(), '.looptroop/worktrees', options.externalId)
  const ticketDir = resolve(ticketRoot, '.ticket')
  const codebaseMapPath = resolve(ticketDir, 'codebase-map.yaml')

  try {
    // Idempotent: check if already initialized
    if (existsSync(resolve(ticketDir, 'initialized'))) {
      return { success: true, created: false, ticketDir, codebaseMapPath }
    }

    // Create ticket directory structure
    const dirs = [
      ticketDir,
      resolve(ticketDir, 'meta'),
      resolve(ticketDir, 'approvals'),
      resolve(ticketDir, 'runtime'),
      resolve(ticketDir, 'runtime', 'streams'),
      resolve(ticketDir, 'runtime', 'sessions'),
      resolve(ticketDir, 'runtime', 'locks'),
      resolve(ticketDir, 'runtime', 'tmp'),
      resolve(ticketDir, 'beads', 'main', '.beads'),
    ]

    for (const dir of dirs) {
      mkdirSync(dir, { recursive: true })
    }

    // Create .gitignore for runtime churn
    writeFileSync(
      resolve(ticketDir, '.gitignore'),
      [
        'runtime/**',
        'locks/**',
        'streams/**',
        'sessions/**',
        'tmp/**',
        '*.tmp',
      ].join('\n') + '\n',
    )

    // Generate codebase-map.yaml using spec-compliant schema
    writeFileSync(
      codebaseMapPath,
      generateCodebaseMapYaml(options.projectFolder, options.externalId),
    )

    // Mark as initialized
    writeFileSync(resolve(ticketDir, 'initialized'), new Date().toISOString())

    return { success: true, created: true, ticketDir, codebaseMapPath }
  } catch (err) {
    return {
      success: false,
      created: false,
      ticketDir,
      codebaseMapPath,
      error: err instanceof Error ? err.message : 'Unknown initialization error',
    }
  }
}
