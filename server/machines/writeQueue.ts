type WriteOperation = () => void | Promise<void>

class WriteQueue {
  private queue: WriteOperation[] = []
  private processing = false

  async enqueue(op: WriteOperation): Promise<void> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          await op()
          resolve()
        } catch (err) {
          reject(err)
        }
      })
      if (!this.processing) {
        this.process()
      }
    })
  }

  private async process() {
    this.processing = true
    while (this.queue.length > 0) {
      const op = this.queue.shift()
      if (op) {
        try {
          await op()
        } catch (err) {
          console.error('[writeQueue] Operation failed:', err)
        }
      }
    }
    this.processing = false
  }
}

export const writeQueue = new WriteQueue()
