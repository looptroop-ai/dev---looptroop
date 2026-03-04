import { writeFileSync, renameSync, openSync, fsyncSync, closeSync, mkdirSync } from 'fs'
import { dirname } from 'path'

export function safeAtomicWrite(filePath: string, content: string): void {
  const tmpPath = `${filePath}.tmp`
  const dir = dirname(filePath)

  // Ensure directory exists
  mkdirSync(dir, { recursive: true })

  // Write to temp file
  writeFileSync(tmpPath, content, 'utf-8')

  // Fsync the temp file
  const fd = openSync(tmpPath, 'r')
  fsyncSync(fd)
  closeSync(fd)

  // Atomic rename
  renameSync(tmpPath, filePath)
}
