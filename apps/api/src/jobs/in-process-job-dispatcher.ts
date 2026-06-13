import { Injectable, Logger } from '@nestjs/common';
import type { EnqueuedJob, JobDispatcher } from './job-dispatcher';

/**
 * Implementación in-process del puerto {@link JobDispatcher} (H19.20 · F2 S0).
 *
 * `enqueue(job)` dispara `job.run()` de forma asíncrona respetando un **límite de
 * concurrencia global** (semáforo simple en memoria). Cuando el número de jobs en
 * vuelo alcanza el límite, los jobs entrantes se acumulan en una **cola FIFO** y se
 * despachan al liberarse un slot. Si `run()` rechaza, el error se captura y se
 * loguea con el `Logger` de NestJS — **nunca se propaga**, para no tumbar el proceso
 * (una promesa rechazada sin manejar terminaría el event loop).
 *
 * No toca la base de datos ni implementa reaper de colgados: el manejo de timeouts /
 * jobs colgados lo realiza el módulo de dominio (`ai-analysis`) que conoce su tabla.
 *
 * Cuando un gatillo de escala lo justifique (multi-instancia, ráfaga, jobs
 * recurrentes), este provider se reemplaza por uno basado en BullMQ+Redis sin tocar
 * a los callers, que dependen del puerto.
 */
@Injectable()
export class InProcessJobDispatcher implements JobDispatcher {
  private readonly logger = new Logger(InProcessJobDispatcher.name);

  /** Límite máximo de jobs ejecutándose en paralelo. */
  private readonly maxConcurrency: number;

  /** Número de jobs actualmente en ejecución. */
  private activeCount = 0;

  /** Cola FIFO de jobs en espera de un slot libre. */
  private readonly queue: EnqueuedJob[] = [];

  constructor() {
    this.maxConcurrency = InProcessJobDispatcher.resolveMaxConcurrency();
  }

  /**
   * Resuelve el límite de concurrencia desde `JOB_MAX_CONCURRENCY` (default 4).
   * Valores no numéricos o ≤ 0 caen al default para evitar bloqueos o jobs perdidos.
   */
  private static resolveMaxConcurrency(): number {
    const raw = process.env.JOB_MAX_CONCURRENCY;
    if (raw === undefined || raw.trim() === '') {
      return 4;
    }
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return 4;
    }
    return parsed;
  }

  /**
   * Encola un job. Si hay un slot libre, lo despacha de inmediato; si no, lo deja en
   * la cola FIFO. Retorna sincrónicamente (fire-and-forget); el resultado del job se
   * observa por el estado en su tabla de dominio.
   */
  enqueue(job: EnqueuedJob): void {
    this.queue.push(job);
    this.drain();
  }

  /** Despacha jobs de la cola mientras haya slots libres. */
  private drain(): void {
    while (this.activeCount < this.maxConcurrency && this.queue.length > 0) {
      const job = this.queue.shift() as EnqueuedJob;
      this.activeCount += 1;
      void this.execute(job);
    }
  }

  /**
   * Ejecuta un job aislando cualquier rechazo y liberando el slot al finalizar.
   * El `finally` re-invoca {@link drain} para procesar la cola pendiente.
   */
  private async execute(job: EnqueuedJob): Promise<void> {
    try {
      await job.run();
    } catch (error) {
      this.logger.error(
        `Job falló (kind=${job.kind} id=${job.id}): ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.activeCount -= 1;
      this.drain();
    }
  }
}
