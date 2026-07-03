import type { ItemInsightSnapshot } from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import type { LlmImagePart } from '../llm/llm.types';

/**
 * Puerto del ensamblador de snapshot determinista POR-PREGUNTA (F2 S2 — H20.8).
 *
 * Reúsa `ItemAnalysisService.getQuestionAnalysis` + psicometría (KR-20 /
 * punto-biserial) + pasaje + imágenes (base64, best-effort). El runner lo inyecta
 * por token. El snapshot NUNCA contiene PII (sin nombres ni RUT): solo el
 * contenido del ítem + agregados.
 */
export interface ItemInsightBuildOptions {
  assessmentId: string;
  classGroupId?: string;
}

/**
 * Resultado del ensamblado: el snapshot tipado (contrato compartido, solo
 * URL/metadata de imágenes para el prompt) y, aparte, las imágenes ya en base64
 * que el runner pasa a `completeMultimodal`. El base64 NO vive en el snapshot
 * compartido (que se serializa al prompt); va en un canal separado.
 */
export interface ItemInsightBuildResult {
  snapshot: ItemInsightSnapshot;
  images: LlmImagePart[];
}

export interface ItemInsightBuilder {
  build(
    user: JwtPayload,
    itemId: string,
    opts: ItemInsightBuildOptions,
  ): Promise<ItemInsightBuildResult>;
}

/** Token de inyección NestJS para el puerto ItemInsightBuilder. */
export const ITEM_INSIGHT_BUILDER = 'ITEM_INSIGHT_BUILDER';
