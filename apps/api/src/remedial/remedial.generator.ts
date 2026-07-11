import type { RemedialContent, RemedialMaterialType, RemedialStimulus } from '@soe/types';
import type { RemedialMaterial } from '@soe/db';
import type { RemedialBrief } from './remedial-brief.service';
import type { RemedialCurriculumContext } from './remedial-context.service';
import { estimateLlmCostUsd } from '../llm/llm.pricing';
import type { LlmCompletionResult } from '../llm/llm.types';

/**
 * Datos de entrada que el runner entrega a cada generador: el registro de dominio
 * (para id/orgId/parámetros deterministas), el contexto curricular RAG ya ensamblado
 * (sin PII) y, opcionalmente, el brief diagnóstico anclado a la evidencia del error
 * (G4). El `brief` es OPCIONAL: `guide`/`group_plan` pueden ignorarlo; `practice_set`
 * lo usa para que las alternativas incorrectas capturen el error real.
 *
 * `stimulus` es OPCIONAL (Ola 2.1a): cuando el runner lo resuelve (Opción A), el
 * `practice_set` genera preguntas ANCLADAS al pasaje (respondibles solo desde su
 * texto). `null`/ausente → modo self_contained (comportamiento actual).
 *
 * `feedback` es OPCIONAL (Ola 2.1b · modo regeneración): objeciones agregadas del
 * juez de la ronda anterior. Cuando viene, el prompt agrega "EVITA ESTOS PROBLEMAS
 * DETECTADOS: …" para que la regeneración corrija lo objetado. `undefined`/`[]` en
 * la ronda 0 (comportamiento actual).
 */
export interface RemedialGenerationInput {
  material: RemedialMaterial;
  orgId: string;
  curriculum: RemedialCurriculumContext;
  brief?: RemedialBrief | null;
  stimulus?: RemedialStimulus | null;
  feedback?: string[];
}

/**
 * Ítem listo para el juez automático (Ola 2.1b). El generador lo arma de
 * `validatedContents` + los ítems recién insertados (no re-lee de DB). Lleva la
 * `isCorrect` de cada alternativa (la clave real) para el solve-then-check del
 * SERVICE — el juez NUNCA la ve: `RemedialJudgeService` la elimina antes de armar
 * el prompt. `itemId` permite el soft-delete de la ronda al regenerar.
 */
export interface RemedialJudgeItem {
  position: number;
  itemId: string;
  stem: string;
  alternatives: { key: string; text: string; isCorrect: boolean }[];
  explanation: string | null;
}

/**
 * Salida de un generador: el `content` validado del material + (opcional) los
 * ids de ítems a publicar al aprobar (solo `practice_set`) + trazabilidad IA.
 */
export interface RemedialGenerationResult {
  content: RemedialContent;
  promptVersion: string;
  /** Contexto enviado al modelo (auditoría RAG, sin PII). */
  audit: Record<string, unknown>;
  /** Modelo efectivo usado (para observabilidad de costo). `null` si desconocido. */
  model: string | null;
  /** Uso de tokens del turno. `null` si el provider no lo reporta. */
  tokens: { input: number; output: number } | null;
  /** Costo estimado en USD (string decimal 6). `null` si no se pudo estimar. */
  costUsd: string | null;
  /**
   * Ola 2.1b: ítems para el juez automático (SOLO `practice_set`). El generador los
   * arma de `validatedContents` + los ítems insertados para no re-leer de DB.
   * `undefined` para `guide`/`group_plan` (no pasan por el juez/loop).
   */
  judgeItems?: RemedialJudgeItem[];
}

/**
 * Puerto de un generador de material remedial. Cada tipo (`guide`,
 * `practice_set`, `group_plan`) implementa esta interfaz; el runner resuelve el
 * generador por `type`.
 */
export interface RemedialGenerator {
  readonly type: RemedialMaterialType;
  generate(input: RemedialGenerationInput): Promise<RemedialGenerationResult>;
}

/**
 * Deriva los campos de observabilidad (`model`/`tokens`/`costUsd`) desde el
 * resultado de `LlmService.completeWithUsage`. Fuente única para los 3 generadores
 * (DRY): el costo se estima con `estimateLlmCostUsd` (tarifas en `llm.pricing`).
 */
export function remedialUsageFields(
  completion: LlmCompletionResult,
): Pick<RemedialGenerationResult, 'model' | 'tokens' | 'costUsd'> {
  return {
    model: completion.model,
    tokens: completion.usage
      ? {
          input: completion.usage.inputTokens,
          output: completion.usage.outputTokens,
        }
      : null,
    costUsd: estimateLlmCostUsd(completion.model, completion.usage),
  };
}

/** Token de inyección NestJS para el array de generadores registrados. */
export const REMEDIAL_GENERATORS = 'REMEDIAL_GENERATORS';
