/**
 * Puerto de despacho de jobs asíncronos (F2 S0 — H19.20).
 *
 * En F2 la implementación es in-process (semáforo de concurrencia + reaper de
 * colgados). Mantener este puerto permite migrar a BullMQ+Redis sin tocar a los
 * callers cuando un gatillo de escala lo justifique (multi-instancia / ráfaga /
 * jobs recurrentes).
 */
export interface EnqueuedJob {
  /** id del registro de dominio cuyo estado refleja el job (p.ej. ai_analyses.id). */
  id: string;
  /** clase de job para routing/métricas (p.ej. 'ai_analysis'). */
  kind: string;
  /** unidad de trabajo; debe actualizar el estado en su tabla de dominio. */
  run: () => Promise<void>;
}

export interface JobDispatcher {
  /** Encola un job; corre async respetando el límite de concurrencia global. */
  enqueue(job: EnqueuedJob): void;
}

/** Token de inyección NestJS para el puerto JobDispatcher. */
export const JOB_DISPATCHER = 'JOB_DISPATCHER';
