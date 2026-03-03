import { readdirSync, existsSync } from 'fs'
import { join, relative, extname } from 'path'

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.looptroop',
  '.next', '.nuxt', '.output', '__pycache__', '.venv',
  'vendor', 'target', 'coverage', '.pytest_cache',
])

const MANIFEST_FILES = new Set([
  'package.json', 'Cargo.toml', 'go.mod', 'requirements.txt',
  'pyproject.toml', 'Gemfile', 'pom.xml', 'build.gradle',
  'composer.json', 'mix.exs', 'pubspec.yaml',
])

const EXT_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript',
  '.js': 'JavaScript', '.jsx': 'JavaScript',
  '.py': 'Python', '.rs': 'Rust', '.go': 'Go',
  '.java': 'Java', '.rb': 'Ruby', '.md': 'Markdown',
  '.yaml': 'YAML', '.yml': 'YAML', '.json': 'JSON',
  '.css': 'CSS', '.scss': 'SCSS', '.html': 'HTML',
  '.sh': 'Shell', '.sql': 'SQL', '.c': 'C', '.cpp': 'C++',
}

export function scanCodebase(rootDir: string, maxDepth = 4): {
  files: string[]
  manifests: string[]
  byLanguage: Record<string, number>
} {
  const files: string[] = []
  const manifests: string[] = []
  const byLanguage: Record<string, number> = {}

  function scan(dir: string, depth: number) {
    if (depth > maxDepth) return
    if (!existsSync(dir)) return

    try {
      const items = readdirSync(dir, { withFileTypes: true })
      for (const item of items) {
        if (item.name.startsWith('.') && item.name !== '.ticket') continue
        if (IGNORE_DIRS.has(item.name)) continue

        const fullPath = join(dir, item.name)
        const relPath = relative(rootDir, fullPath)

        if (item.isDirectory()) {
          // Paths-only map: no directory entries per spec
          scan(fullPath, depth + 1)
        } else if (item.isFile()) {
          files.push(relPath)
          if (MANIFEST_FILES.has(item.name)) {
            manifests.push(relPath)
          }
          const lang = EXT_TO_LANGUAGE[extname(item.name)]
          if (lang) {
            byLanguage[lang] = (byLanguage[lang] ?? 0) + 1
          }
        }
      }
    } catch { /* skip inaccessible directories */ }
  }

  scan(rootDir, 0)
  return { files, manifests, byLanguage }
}

export function generateCodebaseMapYaml(rootDir: string, ticketId?: string): string {
  const { files, manifests, byLanguage } = scanCodebase(rootDir)
  const now = new Date().toISOString()

  const langLines = Object.entries(byLanguage)
    .sort(([, a], [, b]) => b - a)
    .map(([lang, count]) => `    ${lang}: ${count}`)

  const lines = [
    'schema_version: 1',
    `ticket_id: "${ticketId ?? ''}"`,
    'artifact: "codebase_map"',
    'generated_by: "SYS"',
    `generated_at: "${now}"`,
    'source:',
    '  root: "."',
    '  ignore:',
    '    - ".git/"',
    '    - "node_modules/"',
    '    - ".venv/"',
    '    - ".pytest_cache/"',
    'summary:',
    `  total_files: ${files.length}`,
    '  by_language:',
    ...langLines,
    ...(manifests.length > 0 ? ['manifests:', ...manifests.map(m => `  - "${m}"`)] : ['manifests: []']),
    'files:',
    ...files.map(f => `  - "${f}"`),
    '',
  ]

  return lines.join('\n')
}
