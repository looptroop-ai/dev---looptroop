function normalizeFilesystemPath(input: string): string {
  return input.trim().replace(/\\/g, '/').replace(/\/+$/, '')
}

export function isWslWindowsMountPath(input: string): boolean {
  const normalized = normalizeFilesystemPath(input)
  if (!normalized) return false
  if (/^[A-Za-z]:\//.test(normalized)) return true
  return /^\/mnt\/[A-Za-z](?:\/|$)/.test(normalized)
}

export function buildWslAppMountedDriveWarning(appPath: string): string {
  const normalizedPath = normalizeFilesystemPath(appPath)
  return `LoopTroop is running from ${normalizedPath} inside WSL. Keeping the app on a Windows-mounted drive can significantly degrade file watching, Git, and overall app performance. If you want to use WSL, move or install LoopTroop under /home or another Linux filesystem path.`
}

export function buildWslProjectMountedDriveWarning(projectPath: string): string {
  const normalizedPath = normalizeFilesystemPath(projectPath)
  return `This project folder resolves to ${normalizedPath} while LoopTroop is running in WSL. Windows-mounted drives can significantly degrade Git, scanning, and workflow performance. Prefer a copy under /home or another Linux filesystem path.`
}
