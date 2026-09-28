import { ConcurrencyLimiter } from './concurrency-limiter';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flushMicrotasks = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('ConcurrencyLimiter', () => {
  it('rechaza un máximo inválido', () => {
    expect(() => new ConcurrencyLimiter(0)).toThrow();
    expect(() => new ConcurrencyLimiter(1.5)).toThrow();
  });

  it('nunca corre más de `max` tareas a la vez y respeta el orden de llegada', async () => {
    const limiter = new ConcurrencyLimiter(2);
    const gates = [deferred(), deferred(), deferred()];
    const started: number[] = [];

    const runs = gates.map((gate, i) =>
      limiter.run(async () => {
        started.push(i);
        await gate.promise;
        return i;
      }),
    );

    await flushMicrotasks();
    expect(started).toEqual([0, 1]);
    expect(limiter.running).toBe(2);
    expect(limiter.pending).toBe(1);

    gates[0]!.resolve();
    await runs[0];
    await flushMicrotasks();
    expect(started).toEqual([0, 1, 2]);
    expect(limiter.running).toBe(2);

    gates[1]!.resolve();
    gates[2]!.resolve();
    await expect(Promise.all(runs)).resolves.toEqual([0, 1, 2]);
    expect(limiter.running).toBe(0);
    expect(limiter.pending).toBe(0);
  });

  it('libera el turno aunque la tarea falle', async () => {
    const limiter = new ConcurrencyLimiter(1);
    await expect(limiter.run(() => Promise.reject(new Error('falla')))).rejects.toThrow('falla');
    await expect(limiter.run(() => Promise.resolve('ok'))).resolves.toBe('ok');
    expect(limiter.running).toBe(0);
  });
});
