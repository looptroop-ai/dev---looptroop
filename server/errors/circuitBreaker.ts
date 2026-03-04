export class CircuitBreaker {
  private failures = new Map<string, number>()
  private readonly maxFailures: number

  constructor(maxFailures: number = 3) {
    this.maxFailures = maxFailures
  }

  recordFailure(key: string): boolean {
    const count = (this.failures.get(key) ?? 0) + 1
    this.failures.set(key, count)
    return count >= this.maxFailures
  }

  recordSuccess(key: string) {
    this.failures.delete(key)
  }

  isTripped(key: string): boolean {
    return (this.failures.get(key) ?? 0) >= this.maxFailures
  }

  getFailureCount(key: string): number {
    return this.failures.get(key) ?? 0
  }

  reset(key: string) {
    this.failures.delete(key)
  }

  resetAll() {
    this.failures.clear()
  }
}

export const persistenceCircuitBreaker = new CircuitBreaker(3)
