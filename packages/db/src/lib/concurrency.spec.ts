import { runPooled, resolveConcurrency } from './concurrency';

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('runPooled', () => {
  it('procesa todas las tareas y devuelve los resultados EN ORDEN de la cola', async () => {
    const tasks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    // Duraciones deliberadamente desparejas: si el pool devolviera por orden de
    // terminación, este test fallaría.
    const outcome = await runPooled(tasks, 4, async (n) => {
      await tick((10 - n) * 2);
      return n * 10;
    });

    expect(outcome.results).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(outcome.failures).toEqual([]);
    expect(outcome.skipped).toEqual([]);
  });

  it('nunca corre más de `concurrency` tareas a la vez', async () => {
    let inFlight = 0;
    let peak = 0;
    await runPooled(
      Array.from({ length: 40 }, (_, i) => i),
      6,
      async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await tick(1);
        inFlight -= 1;
        return null;
      },
    );
    expect(peak).toBe(6);
  });

  it('con concurrency 1 es equivalente al loop en serie', async () => {
    const order: number[] = [];
    const outcome = await runPooled([3, 1, 2], 1, async (n) => {
      await tick((4 - n) * 3);
      order.push(n);
      return n;
    });
    expect(order).toEqual([3, 1, 2]);
    expect(outcome.results).toEqual([3, 1, 2]);
  });

  it('ante un error corta la toma de tareas nuevas pero deja terminar las en vuelo', async () => {
    const finished: number[] = [];
    const outcome = await runPooled(
      Array.from({ length: 20 }, (_, i) => i),
      4,
      async (n) => {
        if (n === 1) {
          await tick(1);
          throw new Error('boom');
        }
        await tick(5);
        finished.push(n);
        return n;
      },
    );

    expect(outcome.failures).toHaveLength(1);
    expect(outcome.failures[0]?.task).toBe(1);
    // Las 3 tareas hermanas que ya estaban corriendo terminaron; no se abortaron.
    expect(finished).toEqual(expect.arrayContaining([0, 2, 3]));
    // Y quedaron tareas sin arrancar, reportadas para poder salir != 0.
    expect(outcome.skipped.length).toBeGreaterThan(0);
    expect(outcome.results.length + outcome.failures.length + outcome.skipped.length).toBe(20);
  });

  it('no arranca ningún worker con la cola vacía', async () => {
    const run = jest.fn();
    const outcome = await runPooled([], 8, run as never);
    expect(run).not.toHaveBeenCalled();
    expect(outcome).toEqual({ results: [], failures: [], skipped: [] });
  });
});

describe('resolveConcurrency', () => {
  it('usa el default cuando no hay valor', () => {
    expect(resolveConcurrency(undefined, 6)).toBe(6);
    expect(resolveConcurrency('  ', 6)).toBe(6);
  });

  it('lee el valor explícito y lo topa', () => {
    expect(resolveConcurrency('8', 6)).toBe(8);
    expect(resolveConcurrency('999', 6, 32)).toBe(32);
  });

  it('rechaza valores inválidos en vez de caer al default en silencio', () => {
    expect(() => resolveConcurrency('0', 6)).toThrow(/Concurrencia inválida/);
    expect(() => resolveConcurrency('-2', 6)).toThrow(/Concurrencia inválida/);
    expect(() => resolveConcurrency('muchas', 6)).toThrow(/Concurrencia inválida/);
  });
});
