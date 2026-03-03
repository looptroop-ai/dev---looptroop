import { readFileSync, existsSync } from 'fs'
import { safeAtomicWrite } from './atomicWrite'

// Simple YAML read/write helpers
// Note: Using JSON-compatible YAML subset for simplicity
// Full YAML parsing will be added if needed

export function readYamlFile(filePath: string): string | null {
  if (!existsSync(filePath)) return null
  return readFileSync(filePath, 'utf-8')
}

export function writeYamlFile(filePath: string, content: string): void {
  safeAtomicWrite(filePath, content)
}
