/**
 * Pool de workers sobre una cola plana de tareas independientes.
 *
 * Lo usa el backfill de cohort-stats: cada evaluación es su propia transacción
 * idempotente y no comparte filas con las demás (`DELETE`+`INSERT` filtrando por
 * `assessment_id`), así que no hay orden que preservar ni contención entre tareas. El
 * trabajo está dominado por la LATENCIA de red (runner en Azure, RDS en us-east-1, por
 * un túnel SSM), no por CPU: por eso paralelizar sirve acá.
 *
 * Política de error, deliberada: la primera tarea que falla corta la toma de tareas
 * NUEVAS, pero se espera a que las que ya están en vuelo terminen — abortar una
 * transacción a la mitad no aporta nada y ensucia el log. Las tareas que nunca
 * arrancaron se devuelven en `skipped` para que quien llama pueda salir con código != 0
 * y decir exactamente qué quedó sin procesar. Un backfill parcial NUNCA debe reportarse
 * como completo: eso estamparía un read-model incompleto como bueno.
 */

export type PooledFailure<T> = { index: number; task: T; error: unknown };

export type PooledOutcome<T, R> = {
  /** Resultados de las tareas que terminaron bien, en el ORDEN original de la cola. */
  results: R[];
  /** Tareas que fallaron (con la política de arriba, a lo sumo una por worker en vuelo). */
  failures: PooledFailure<T>[];
  /** Tareas que nunca arrancaron porque un error cortó la toma. */
  skipped: T[];
};

export async function runPooled<T, R>(
  tasks: readonly T[],
  concurrency: number,
  run: (task: T, index: number) => Promise<R>,
): Promise<PooledOutcome<T, R>> {
  const workers = Math.max(1, Math.min(Math.floor(concurrency), tasks.length));
  const started = new Array<boolean>(tasks.length).fill(false);
  const results = new Array<{ index: number; value: R }>();
  const failures: PooledFailure<T>[] = [];
  let next = 0;
  let aborted = false;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (aborted) return;
      const index = next++;
      if (index >= tasks.length) return;
      started[index] = true;
      const task = tasks[index] as T;
      try {
        results.push({ index, value: await run(task, index) });
      } catch (error) {
        failures.push({ index, task, error });
        aborted = true;
        return;
      }
    }
  };

  if (tasks.length > 0) {
    await Promise.all(Array.from({ length: workers }, () => worker()));
  }

  results.sort((a, b) => a.index - b.index);
  const skipped = tasks.filter((_, i) => !started[i]);
  return { results: results.map((r) => r.value), failures, skipped };
}

/** Lee una concurrencia de flag/env, con default y tope de cordura. */
export function resolveConcurrency(raw: string | undefined, fallback: number, max = 32): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(`Concurrencia inválida: "${raw}" (se espera un entero >= 1)`);
  }
  return Math.min(Math.floor(n), max);
}
