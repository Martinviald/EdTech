'use server';

import {
  generateRemedialSchema,
  reviewRemedialSchema,
  updateRemedialItemSchema,
  type RemedialMaterialModel,
  type RemedialMaterialType,
  type RemedialMethod,
  type RemedialStatus,
  type RemedialContent,
  type RemedialPracticeItemPreview,
  type RemedialStimulusRef,
  type StimulusKind,
  type StimulusSource,
  type UpdateRemedialItemDto,
} from '@soe/types';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api';

/**
 * Pasaje fallado candidato (modo A · Ola 2.1a). Espejo del shape backend-interno
 * de `GET /remedial/candidate-stimuli` (`FailedStimulus`), que no vive en `@soe/types`
 * por ser BE-only. `gap` es la brecha agregada del pasaje (0–100).
 */
export interface FailedStimulus {
  sectionId: string;
  kind: StimulusKind;
  source: StimulusSource;
  title: string | null;
  text: string | null;
  textType: string | null; // passage_format (plain | markdown | html)
  itemPositions: number[];
  gap: number;
}

/** Respuesta del picker de pasaje: fallados de la evaluación + alternativas del banco. */
export interface CandidateStimuliResponse {
  fromAssessment: FailedStimulus[];
  fromBank: RemedialStimulusRef[];
}

/**
 * Gatilla la generación (o regeneración con `force`) de un material remedial a
 * partir de una brecha (`nodeId`). El backend crea/reutiliza el registro y encola
 * la ejecución async; responde `{ materialId, status }` para que el cliente haga
 * polling con `GET /remedial/:id`. La autorización efectiva la aplica el guard del
 * endpoint (`REMEDIAL_GENERATOR_ROLES`).
 */
export async function generateRemedial(input: {
  type: RemedialMaterialType;
  nodeId: string;
  assessmentId?: string;
  classGroupId?: string;
  sourceAnalysisId?: string;
  itemCount?: number;
  /** Ola 2.1a: método del set (solo practice_set). El backend resuelve el default. */
  method?: RemedialMethod;
  /** Ola 2.1a: pasaje elegido por el docente (override) cuando `method='reuse_stimulus'`. */
  stimulusId?: string;
  force?: boolean;
}): Promise<{ materialId: string; status: RemedialStatus }> {
  const dto = generateRemedialSchema.parse({
    type: input.type,
    nodeId: input.nodeId,
    assessmentId: input.assessmentId,
    classGroupId: input.classGroupId,
    sourceAnalysisId: input.sourceAnalysisId,
    itemCount: input.itemCount,
    method: input.method,
    stimulusId: input.stimulusId,
    force: input.force ?? false,
  });

  return apiPost<{ materialId: string; status: RemedialStatus }>(
    '/remedial/generate',
    dto,
  );
}

/**
 * Lista los pasajes candidatos para el picker del modo A (Ola 2.1a): los fallados
 * de la evaluación (mayor brecha primero, default del picker) y las alternativas
 * publicadas del banco. La autorización efectiva la aplica el guard del endpoint
 * (`REMEDIAL_GENERATOR_ROLES`); el `orgId` sale del token en el backend.
 */
export async function getCandidateStimuli(
  assessmentId: string,
  nodeId: string,
): Promise<CandidateStimuliResponse> {
  const query = new URLSearchParams({ assessmentId, nodeId }).toString();
  return apiGet<CandidateStimuliResponse>(`/remedial/candidate-stimuli?${query}`);
}

/**
 * Reconsulta el estado de un material remedial (polling desde el cliente). Solo
 * devuelve el `status`: el render del contenido lo hace el Server Component tras
 * `refresh`.
 */
export async function pollRemedialStatus(
  materialId: string,
): Promise<{ status: RemedialStatus }> {
  const material = await apiGet<RemedialMaterialModel>(`/remedial/${materialId}`);
  return { status: material.status };
}

/**
 * Revisión humana (H9.5): aprobar o descartar un material en estado `ready`. Al
 * aprobar se puede enviar el `content` editado por el humano (override) — la IA
 * propone, el humano ajusta y aprueba. La autorización efectiva la aplica el guard
 * del endpoint (`REMEDIAL_APPROVER_ROLES`).
 */
export async function reviewRemedial(input: {
  materialId: string;
  action: 'approve' | 'discard';
  content?: RemedialContent;
}): Promise<RemedialMaterialModel> {
  const dto = reviewRemedialSchema.parse({
    action: input.action,
    content: input.content,
  });

  return apiPatch<RemedialMaterialModel>(
    `/remedial/${input.materialId}/review`,
    dto,
  );
}

/**
 * Edición humana (Ola 1-resto G2) de un ítem `draft` de un `practice_set` en `ready`:
 * enunciado, alternativas, cuál es la correcta y explicación. La IA propone; el humano
 * ajusta antes de publicar. La regla "exactamente una correcta" la revalida el service
 * (400). Devuelve el preview hidratado del ítem actualizado para reflejar la edición.
 * La autorización efectiva la aplica el guard del endpoint (`REMEDIAL_APPROVER_ROLES`).
 */
export async function updateRemedialItem(
  materialId: string,
  itemId: string,
  dto: UpdateRemedialItemDto,
): Promise<RemedialPracticeItemPreview> {
  const body = updateRemedialItemSchema.parse(dto);

  return apiPatch<RemedialPracticeItemPreview>(
    `/remedial/${materialId}/items/${itemId}`,
    body,
  );
}

/**
 * Quita un ítem `draft` del `practice_set` (soft-delete + reindexado de posiciones).
 * El backend no permite dejar el set vacío (responde 400). Devuelve el material
 * hidratado. La autorización efectiva la aplica el guard del endpoint
 * (`REMEDIAL_APPROVER_ROLES`).
 */
export async function removeRemedialItem(
  materialId: string,
  itemId: string,
): Promise<RemedialMaterialModel> {
  return apiDelete<RemedialMaterialModel>(
    `/remedial/${materialId}/items/${itemId}`,
  );
}
