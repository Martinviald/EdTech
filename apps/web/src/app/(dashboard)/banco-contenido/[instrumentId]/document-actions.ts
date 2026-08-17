'use server';

import { apiPost } from '@/lib/api';
import type { DocumentModel } from '@soe/types';

type ApiError = Error & { status?: number };

export type CreatePrintableMaterialResult =
  | { ok: true; data: DocumentModel }
  | { ok: false; message: string };

/**
 * Arma un documento tipo evaluación en el Editor de Materiales a partir de las
 * secciones/pasajes/ítems del instrumento (`POST /documents/from-instrument/:id`,
 * propuesta §8). El backend responde 400 si el instrumento no tiene ítems y la
 * autorización la aplica el guard del endpoint (`DOCUMENT_EDITOR_ROLES`).
 */
export async function createPrintableMaterial(
  instrumentId: string,
): Promise<CreatePrintableMaterialResult> {
  try {
    const data = await apiPost<DocumentModel>(`/documents/from-instrument/${instrumentId}`, {});
    return { ok: true, data };
  } catch (e) {
    return { ok: false, message: (e as ApiError).message };
  }
}
