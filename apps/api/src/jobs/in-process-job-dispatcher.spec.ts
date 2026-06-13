import { Logger } from '@nestjs/common';
import type { EnqueuedJob } from './job-dispatcher';
import { InProcessJobDispatcher } from './in-process-job-dispatcher';

// ──────────────────────────────────────────────────────────────────────────────
// Helpers de control de timing.
//
// `deferred()` crea una promesa cuyo `resolve`/`reject` exponemos para controlar
// manualmente cuándo "termina" un job. `flush()` cede el event loop para que las
// microtareas pendientes (los `.then`/`finally` del dispatcher) se ejecuten.
// ──────────────────────────────────────────────────────────────────────────────

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (err: unknown) => void;
};

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Cede el event loop varias veces para drenar microtareas encadenadas. */
async function flush(times = 5): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

/**
 * Construye un dispatcher con un `JOB_MAX_CONCURRENCY` específico, restaurando el
 * env al finalizar.
 */
function withConcurrency(value: string | undefined): InProcessJobDispatcher {
  const prev = process.env.JOB_MAX_CONCURRENCY;
  if (value === undefined) {
    delete process.env.JOB_MAX_CONCURRENCY;
  } else {
    process.env.JOB_MAX_CONCURRENCY = value;
  }
  try {
    return new InProcessJobDispatcher();
  } finally {
    if (prev === undefined) {
      delete process.env.JOB_MAX_CONCURRENCY;
    } else {
      process.env.JOB_MAX_CONCURRENCY = prev;
    }
  }
}

describe('InProcessJobDispatcher', () => {
  beforeEach(() => {
    // Silenciar el Logger para no ensuciar la salida de los tests de error.
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function job(id: string, run: () => Promise<void>): EnqueuedJob {
    return { id, kind: 'test', run };
  }

  it('ejecuta el job de forma asíncrona (no bloquea enqueue)', async () => {
    const dispatcher = withConcurrency('4');
    let ran = false;
    dispatcher.enqueue(job('j1', async () => { ran = true; }));

    // enqueue retorna síncronamente; el job aún no necesariamente corrió.
    await flush();
    expect(ran).toBe(true);
  });

  it('nunca excede el límite de concurrencia (cap = 2)', async () => {
    const dispatcher = withConcurrency('2');
    const gates = [deferred(), deferred(), deferred(), deferred()];
    let active = 0;
    let maxActive = 0;

    gates.forEach((gate, i) => {
      dispatcher.enqueue(
        job(`j${i}`, async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await gate.promise;
          active -= 1;
        }),
      );
    });

    await flush();
    expect(active).toBe(2); // sólo 2 arrancaron
    expect(maxActive).toBe(2);

    // Liberar el primero → entra el tercero, sigue en 2.
    gates[0].resolve();
    await flush();
    expect(maxActive).toBe(2);
    expect(active).toBe(2);

    gates[1].resolve();
    gates[2].resolve();
    gates[3].resolve();
    await flush();
    expect(active).toBe(0);
    expect(maxActive).toBe(2);
  });

  it('drena la cola FIFO al liberarse slots (cap = 1)', async () => {
    const dispatcher = withConcurrency('1');
    const gates = [deferred(), deferred(), deferred()];
    const startOrder: string[] = [];

    gates.forEach((gate, i) => {
      dispatcher.enqueue(
        job(`j${i}`, async () => {
          startOrder.push(`j${i}`);
          await gate.promise;
        }),
      );
    });

    await flush();
    // Sólo el primero arrancó (cap = 1).
    expect(startOrder).toEqual(['j0']);

    gates[0].resolve();
    await flush();
    expect(startOrder).toEqual(['j0', 'j1']);

    gates[1].resolve();
    await flush();
    expect(startOrder).toEqual(['j0', 'j1', 'j2']);

    gates[2].resolve();
    await flush();
  });

  it('respeta el orden FIFO de despacho', async () => {
    const dispatcher = withConcurrency('1');
    const finished: string[] = [];

    for (const id of ['a', 'b', 'c', 'd']) {
      dispatcher.enqueue(job(id, async () => { finished.push(id); }));
    }

    await flush(10);
    expect(finished).toEqual(['a', 'b', 'c', 'd']);
  });

  it('un job que rechaza no rompe el dispatcher ni propaga', async () => {
    const dispatcher = withConcurrency('2');
    let okRan = false;

    // No debe lanzar de forma síncrona ni dejar un unhandled rejection.
    expect(() => {
      dispatcher.enqueue(job('bad', async () => { throw new Error('boom'); }));
    }).not.toThrow();
    dispatcher.enqueue(job('good', async () => { okRan = true; }));

    await flush();
    expect(okRan).toBe(true);
  });

  it('loguea el error de un job que rechaza con el Logger de NestJS', async () => {
    const errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const dispatcher = withConcurrency('2');

    dispatcher.enqueue(job('bad', async () => { throw new Error('boom'); }));
    await flush();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [message] = errorSpy.mock.calls[0];
    expect(String(message)).toContain('boom');
    expect(String(message)).toContain('bad');
  });

  it('un job que rechaza libera su slot y desbloquea la cola', async () => {
    const dispatcher = withConcurrency('1');
    let secondRan = false;

    dispatcher.enqueue(job('bad', async () => { throw new Error('boom'); }));
    dispatcher.enqueue(job('next', async () => { secondRan = true; }));

    await flush();
    expect(secondRan).toBe(true);
  });

  it('un rechazo no-Error también se captura sin propagar', async () => {
    const dispatcher = withConcurrency('1');
    let after = false;

    dispatcher.enqueue(job('bad', async () => { throw 'string-error'; }));
    dispatcher.enqueue(job('after', async () => { after = true; }));

    await flush();
    expect(after).toBe(true);
  });

  it('usa el default 4 cuando JOB_MAX_CONCURRENCY es inválido', async () => {
    const dispatcher = withConcurrency('not-a-number');
    const gates = Array.from({ length: 6 }, () => deferred());
    let active = 0;
    let maxActive = 0;

    gates.forEach((gate, i) => {
      dispatcher.enqueue(
        job(`j${i}`, async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await gate.promise;
          active -= 1;
        }),
      );
    });

    await flush();
    expect(active).toBe(4); // default
    expect(maxActive).toBe(4);
    gates.forEach((g) => g.resolve());
    await flush();
  });

  it('procesa todos los jobs encolados eventualmente', async () => {
    const dispatcher = withConcurrency('3');
    const total = 20;
    let done = 0;

    for (let i = 0; i < total; i += 1) {
      dispatcher.enqueue(job(`j${i}`, async () => { done += 1; }));
    }

    await flush(50);
    expect(done).toBe(total);
  });

  it('con cap alto corre todos en paralelo sin encolar', async () => {
    const dispatcher = withConcurrency('10');
    const gates = Array.from({ length: 5 }, () => deferred());
    let active = 0;
    let maxActive = 0;

    gates.forEach((gate, i) => {
      dispatcher.enqueue(
        job(`j${i}`, async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await gate.promise;
          active -= 1;
        }),
      );
    });

    await flush();
    expect(maxActive).toBe(5); // los 5 a la vez, bajo el cap de 10
    gates.forEach((g) => g.resolve());
    await flush();
    expect(active).toBe(0);
  });
});
