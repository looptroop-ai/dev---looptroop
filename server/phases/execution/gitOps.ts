// Git operations for bead execution — allowlist-based

const ALLOWED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.json',
  '.yaml',
  '.yml',
  '.css',
  '.scss',
  '.html',
  '.md',
  '.txt',
  '.svg',
  '.py',
  '.rb',
  '.rs',
  '.go',
  '.java',
  '.kt',
  '.sh',
  '.toml',
  '.lock',
  '.gitignore',
])

const BLOCKED_PATTERNS = [
  /\.ticket\/runtime\//,
  /\.ticket\/locks\//,
  /\.ticket\/streams\//,
  /\.ticket\/sessions\//,
  /\.ticket\/tmp\//,
  /node_modules\//,
  /\.looptroop\//,
  /dist\//,
  /build\//,
]

export function isAllowedFile(path: string): boolean {
  // Check blocked patterns
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(path)) return false
  }

  // Check extension
  const ext = path.slice(path.lastIndexOf('.'))
  return ALLOWED_EXTENSIONS.has(ext)
}

export function filterAllowedFiles(files: string[]): string[] {
  return files.filter(isAllowedFile)
}
