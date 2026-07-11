'use server';

import {
  generateRemedialSchema,
  reviewRemedialSchema,
  updateRemedialSchema,
  type RemedialMaterialModel,
  type RemedialMaterialType,
  type RemedialStatus,
  type RemedialContent,
} from '@soe/types';
import { apiGet, apiPost, apiPatch } from '@/lib/api';

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
  force?: boolean;
}): Promise<{ materialId: string; status: RemedialStatus }> {
  const dto = generateRemedialSchema.parse({
    type: input.type,
    nodeId: input.nodeId,
    assessmentId: input.assessmentId,
    classGroupId: input.classGroupId,
    sourceAnalysisId: input.sourceAnalysisId,
    itemCount: input.itemCount,
    force: input.force ?? false,
  });

  return apiPost<{ materialId: string; status: RemedialStatus }>('/remedial/generate', dto);
}

/**
 * Reconsulta el estado de un material remedial (polling desde el cliente). Solo
 * devuelve el `status`: el render del contenido lo hace el Server Component tras
 * `refresh`.
 */
export async function pollRemedialStatus(materialId: string): Promise<{ status: RemedialStatus }> {
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

  return apiPatch<RemedialMaterialModel>(`/remedial/${input.materialId}/review`, dto);
}

/**
 * Edición humana del material en borrador (TKT-17 c): persiste el `content`
 * editado en `editedContent` vía `PATCH /remedial/:id`, sin tocar la salida IA
 * (`content`, evidencia §8.3). Aplica a TODOS los tipos (guide | practice_set |
 * group_plan); el content se valida por `type` en el backend. Solo mientras el
 * material está en `ready`. La autorización efectiva la aplica el guard del
 * endpoint (`REMEDIAL_APPROVER_ROLES`).
 */
export async function updateRemedialContent(input: {
  materialId: string;
  content: RemedialContent;
}): Promise<RemedialMaterialModel> {
  const dto = updateRemedialSchema.parse({ content: input.content });

  return apiPatch<RemedialMaterialModel>(`/remedial/${input.materialId}`, dto);
}
