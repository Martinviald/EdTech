export class LlmTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`La llamada al proveedor de IA superó el timeout de ${timeoutMs} ms`);
    this.name = 'TimeoutError';
  }
}

export interface LlmDeadline {
  readonly signal: AbortSignal;
  remainingMs(): number;
}

export async function runWithinDeadline<T>(
  timeoutMs: number,
  run: (deadline: LlmDeadline) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const expiresAt = Date.now() + timeoutMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new LlmTimeoutError(timeoutMs);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  const deadline: LlmDeadline = {
    signal: controller.signal,
    remainingMs: () => Math.max(1, expiresAt - Date.now()),
  };
  try {
    return await Promise.race([run(deadline), expired]);
  } catch (error) {
    if (controller.signal.aborted) throw new LlmTimeoutError(timeoutMs);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
