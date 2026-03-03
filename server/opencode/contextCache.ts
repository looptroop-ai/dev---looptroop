// Reusable context slice cache — shared across phases within a ticket

interface CacheEntry {
  content: string
  tokenCount: number
  timestamp: number
}

class ContextCache {
  private cache = new Map<string, CacheEntry>()
  private readonly TTL = 300000 // 5 minutes

  get(ticketId: string, sliceKey: string): string | null {
    const key = `${ticketId}:${sliceKey}`
    const entry = this.cache.get(key)
    if (!entry) return null
    if (Date.now() - entry.timestamp > this.TTL) {
      this.cache.delete(key)
      return null
    }
    return entry.content
  }

  set(ticketId: string, sliceKey: string, content: string, tokenCount: number) {
    const key = `${ticketId}:${sliceKey}`
    this.cache.set(key, { content, tokenCount, timestamp: Date.now() })
  }

  invalidate(ticketId: string) {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${ticketId}:`)) {
        this.cache.delete(key)
      }
    }
  }

  clear() {
    this.cache.clear()
  }
}

export const contextCache = new ContextCache()
