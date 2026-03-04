import { readdirSync, renameSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

// Scan for orphan .tmp files and promote them
export function recoverOrphanTmpFiles(rootDir: string): string[] {
  const recovered: string[] = []

  function scanDir(dir: string) {
    if (!existsSync(dir)) return
    try {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
          scanDir(fullPath)
        } else if (entry.name.endsWith('.tmp')) {
          const targetPath = fullPath.slice(0, -4) // remove .tmp
          try {
            renameSync(fullPath, targetPath)
            recovered.push(targetPath)
          } catch (err) {
            console.error(`[recovery] Failed to promote ${fullPath}:`, err)
          }
        }
      }
    } catch {
      // Ignore unreadable directories
    }
  }

  scanDir(rootDir)
  return recovered
}

// Fix trailing-line corruption in JSONL files
export function fixTrailingLineCorruption(filePath: string): boolean {
  if (!existsSync(filePath)) return false

  const content = readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')

  // Remove empty trailing lines
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === '') {
    lines.pop()
  }

  // Check last line is valid JSON
  if (lines.length > 0) {
    const lastLine = lines[lines.length - 1]
    if (lastLine) {
      try {
        JSON.parse(lastLine)
      } catch {
        // Last line is corrupt, remove it
        console.warn(`[recovery] Truncating corrupt last line in ${filePath}`)
        lines.pop()
        writeFileSync(filePath, lines.join('\n') + (lines.length > 0 ? '\n' : ''), 'utf-8')
        return true
      }
    }
  }

  return false
}
