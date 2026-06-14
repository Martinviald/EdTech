import type { RemedialContent, RemedialMaterialType } from '@soe/types';
import type { RemedialMaterial } from '@soe/db';
import type { RemedialCurriculumContext } from './remedial-context.service';

/**
 * Datos de entrada que el runner entrega a cada generador: el registro de dominio
 * (para id/orgId/parámetros deterministas) y el contexto curricular RAG ya
 * ensamblado (sin PII).
 */
export interface RemedialGenerationInput {
  material: RemedialMaterial;
  orgId: string;
  curriculum: RemedialCurriculumContext;
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

/** Token de inyección NestJS para el array de generadores registrados. */
export const REMEDIAL_GENERATORS = 'REMEDIAL_GENERATORS';
