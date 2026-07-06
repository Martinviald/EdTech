import { Injectable } from '@nestjs/common';
import type { JudgeVerdict, QualityReport } from '@soe/types';
import type { RemedialJudgeItem } from './remedial.generator';

/** Tope de rondas de generación (ronda 0 + hasta 2 regeneraciones). */
export const DEFAULT_MAX_ITERATIONS = 3;

/**
 * Un "batch" que el loop sabe manejar: cualquier resultado de generación que exponga
 * los `judgeItems` (lo que el juez necesita). El loop es genérico sobre el resto del
 * batch (content/audit/costo) — solo lee `judgeItems` y devuelve el batch final tal cual.
 */
export interface QualityLoopBatch {
  judgeItems: RemedialJudgeItem[];
}

/** Puertos que el runner inyecta al loop (curried con input/estímulo/orgId). */
export interface QualityLoopParams<TBatch extends QualityLoopBatch> {
  /** Genera un set. `feedback` = objeciones de la ronda previa (undefined en la ronda 0). */
  generate: (feedback: string[] | undefined) => Promise<TBatch>;
  /** Juzga los ítems del batch (un veredicto por ítem). */
  judge: (judgeItems: RemedialJudgeItem[]) => Promise<JudgeVerdict[]>;
  /** Soft-delete de los ítems de la ronda anterior (para que solo sobreviva el set final). */
  softDeletePrevious: (batch: TBatch) => Promise<void>;
  /** Tope de rondas (default 3). */
  maxIter?: number;
}

/** Resultado del loop: el set final (draft, converged o exhausted) + el reporte del juez. */
export interface QualityLoopResult<TBatch extends QualityLoopBatch> {
  finalBatch: TBatch;
  qualityReport: QualityReport;
}

/**
 * Loop de calidad del material remedial (Ola 2.1b): generar → juzgar → si hay fallas de
 * hard-gate, REGENERAR TODO EL SET inyectando las objeciones → re-juzgar, hasta que
 * converja o se agoten las rondas (máx 3).
 *
 * **Decisión (esta primera versión): regeneración de TODO el set**, no por-ítem — más
 * simple y fiable. La regeneración por-ítem (preservar los buenos, regenerar solo los
 * fallidos) es una optimización futura (ver §5 diseño): abarataría el costo pero exige
 * fusionar ítems buenos + nuevos y re-mapear posiciones/refs; se deja anotada.
 *
 * **hard-gate** (gatilla regeneración) = algún veredicto con `!answerable ||
 * !uniqueCorrect || !factual`. **`skillMatch=false` es BLANDO**: no regenera, solo se
 * reporta al docente. El material SIEMPRE queda draft (converged o exhausted); el
 * `qualityReport` (con las objeciones) viaja para que el docente revise.
 *
 * Servicio PURO (sin deps): el runner le pasa `generate`/`judge`/`softDeletePrevious`
 * ya curried (con el input, el estímulo, el orgId y los timeouts). No conoce DB ni LLM.
 */
@Injectable()
export class RemedialQualityLoop {
  async run<TBatch extends QualityLoopBatch>(
    params: QualityLoopParams<TBatch>,
  ): Promise<QualityLoopResult<TBatch>> {
    const maxIter = params.maxIter ?? DEFAULT_MAX_ITERATIONS;

    // Ronda 0: sin feedback.
    let batch = await params.generate(undefined);
    let verdicts = await params.judge(batch.judgeItems);
    let iterations = 1;

    while (hasHardFailure(verdicts) && iterations < maxIter) {
      // Soft-delete de la ronda que vamos a reemplazar (solo sobrevive el set final).
      await params.softDeletePrevious(batch);
      // Regenera TODO el set con las objeciones agregadas de la ronda anterior.
      batch = await params.generate(objectionsFrom(verdicts));
      verdicts = await params.judge(batch.judgeItems);
      iterations++;
    }

    const finalStatus: QualityReport['finalStatus'] = hasHardFailure(verdicts)
      ? 'exhausted'
      : 'converged';

    return {
      finalBatch: batch,
      qualityReport: { iterations, finalStatus, verdicts },
    };
  }
}

/** Hay falla dura si algún ítem no es respondible, no tiene clave única o es no-factual. */
export function hasHardFailure(verdicts: JudgeVerdict[]): boolean {
  return verdicts.some((v) => !v.answerable || !v.uniqueCorrect || !v.factual);
}

/**
 * Objeciones agregadas (dedup) de los veredictos con falla DURA — las que deben guiar la
 * regeneración. Un `skillMatch=false` sin falla dura NO aporta objeciones (es blando y no
 * gatilla regeneración).
 */
export function objectionsFrom(verdicts: JudgeVerdict[]): string[] {
  const failing = verdicts.filter((v) => !v.answerable || !v.uniqueCorrect || !v.factual);
  const all = failing.flatMap((v) => v.objections).map((o) => o.trim()).filter((o) => o.length > 0);
  return [...new Set(all)];
}
