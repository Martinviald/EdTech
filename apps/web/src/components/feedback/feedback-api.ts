'use client';

import type { CreateFeedbackDto, FileUploadUrlResponse } from '@soe/types';
import { apiClientPost } from '@/lib/api-client';

export function submitFeedback(dto: CreateFeedbackDto): Promise<{ id: string }> {
  return apiClientPost<{ id: string }>('/feedback', dto);
}

/**
 * Sube la captura opcional a S3 (presigned en tres pasos, igual que el resto de
 * archivos de la plataforma) y devuelve el `fileId` a adjuntar al comentario.
 *
 * Devuelve `null` ante cualquier fallo: una captura que no sube NO debe impedir
 * que se envíe el comentario. El texto es lo que importa.
 */
export async function uploadFeedbackScreenshot(file: File): Promise<string | null> {
  try {
    const intent = await apiClientPost<FileUploadUrlResponse>('/feedback/screenshot-url', {
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    });

    const put = await fetch(intent.uploadUrl, {
      method: 'PUT',
      body: file,
      headers: intent.headers,
    });
    if (!put.ok) return null;

    await apiClientPost(`/feedback/screenshot/${intent.fileId}/confirm`, {});
    return intent.fileId;
  } catch {
    return null;
  }
}
