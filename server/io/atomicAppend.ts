import { closeSync, fstatSync, fsyncSync, mkdirSync, openSync, readSync, writeSync } from 'fs'
import { dirname } from 'path'

export function safeAtomicAppend(filePath: string, line: string): void {
  mkdirSync(dirname(filePath), { recursive: true })

  const fd = openSync(filePath, 'a+')
  try {
    const stats = fstatSync(fd)
    let prefix = ''

    if (stats.size > 0) {
      const trailingByte = Buffer.alloc(1)
      readSync(fd, trailingByte, 0, 1, stats.size - 1)
      if (trailingByte.toString('utf-8') !== '\n') {
        prefix = '\n'
      }
    }

    writeSync(fd, `${prefix}${line}\n`, undefined, 'utf-8')
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}
