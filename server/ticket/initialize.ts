import { mkdirSync, writeFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { generateCodebaseMapYaml } from './codebaseMap'

interface InitializeOptions {
  externalId: string
  projectFolder: string
}

export function initializeTicket(options: InitializeOptions): { success: boolean; error?: string } {
  const ticketRoot = resolve(process.cwd(), '.looptroop/worktrees', options.externalId)
  const ticketDir = resolve(ticketRoot, '.ticket')

  try {
    // Idempotent: check if already initialized
    if (existsSync(resolve(ticketDir, 'initialized'))) {
      return { success: true }
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
      resolve(ticketDir, 'codebase-map.yaml'),
      generateCodebaseMapYaml(options.projectFolder, options.externalId),
    )

    // Mark as initialized
    writeFileSync(resolve(ticketDir, 'initialized'), new Date().toISOString())

    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown initialization error',
    }
  }
}
