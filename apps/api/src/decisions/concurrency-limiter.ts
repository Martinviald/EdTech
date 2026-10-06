export class ConcurrencyLimiter {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly max: number) {
    if (!Number.isInteger(max) || max < 1) {
      throw new Error(`ConcurrencyLimiter: max debe ser un entero >= 1 (recibido ${max})`);
    }
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  get running(): number {
    return this.active;
  }

  get pending(): number {
    return this.queue.length;
  }

  private acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  private release(): void {
    const handOffToNext = this.queue.shift();
    if (handOffToNext) {
      handOffToNext();
    } else {
      this.active--;
    }
  }
}
