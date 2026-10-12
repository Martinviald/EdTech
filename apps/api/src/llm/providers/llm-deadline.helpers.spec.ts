import { LlmTimeoutError, runWithinDeadline, type LlmDeadline } from './llm-deadline.helpers';

function abortRejection(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal.addEventListener('abort', () =>
      reject(Object.assign(new Error('Request was aborted.'), { name: 'APIUserAbortError' })),
    );
  });
}

describe('runWithinDeadline', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('rechaza con LlmTimeoutError y aborta la señal cuando la tarea nunca termina', async () => {
    let captured: LlmDeadline | null = null;
    const outcome = runWithinDeadline(1_000, (deadline) => {
      captured = deadline;
      return new Promise<never>(() => undefined);
    }).catch((error: unknown) => error);

    await jest.advanceTimersByTimeAsync(1_000);

    const error = await outcome;
    expect(error).toBeInstanceOf(LlmTimeoutError);
    expect((error as Error).name).toBe('TimeoutError');
    expect((error as Error).message).toMatch(/timeout de 1000 ms/);
    expect(captured).not.toBeNull();
    expect(captured!.signal.aborted).toBe(true);
  });

  it('reporta timeout aunque la tarea rechace primero por el aborto de la señal', async () => {
    const outcome = runWithinDeadline(500, (deadline) => abortRejection(deadline.signal)).catch(
      (error: unknown) => error,
    );

    await jest.advanceTimersByTimeAsync(500);

    expect(await outcome).toBeInstanceOf(LlmTimeoutError);
  });

  it('el tiempo restante baja a medida que pasa el tiempo y nunca llega a cero', async () => {
    const seen: number[] = [];
    const outcome = runWithinDeadline(1_000, async (deadline) => {
      seen.push(deadline.remainingMs());
      await new Promise((resolve) => setTimeout(resolve, 300));
      seen.push(deadline.remainingMs());
      await new Promise((resolve) => setTimeout(resolve, 900));
      seen.push(deadline.remainingMs());
      return 'listo';
    }).catch((error: unknown) => error);

    await jest.advanceTimersByTimeAsync(1_200);

    expect(await outcome).toBeInstanceOf(LlmTimeoutError);
    expect(seen).toEqual([1_000, 700, 1]);
  });

  it('devuelve el resultado y no deja el temporizador armado', async () => {
    await expect(runWithinDeadline(1_000, () => Promise.resolve(42))).resolves.toBe(42);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('propaga el error de la tarea si el plazo no venció', async () => {
    const failure = new Error('400 bad request');
    await expect(runWithinDeadline(1_000, () => Promise.reject(failure))).rejects.toBe(failure);
    expect(jest.getTimerCount()).toBe(0);
  });
});
