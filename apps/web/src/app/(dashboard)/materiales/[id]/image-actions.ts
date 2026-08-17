'use server';

import { apiPost } from '@/lib/api';
import type {
  DocumentImageConfirmResponse,
  DocumentImageUploadRequestDto,
  FileUploadUrlResponse,
} from '@soe/types';

type ApiError = Error & { status?: number };

export type DocumentImageUploadUrlResult =
  | { ok: true; data: FileUploadUrlResponse }
  | { ok: false; message: string; storageUnavailable: boolean };

export type DocumentImageConfirmResult =
  | { ok: true; data: DocumentImageConfirmResponse }
  | { ok: false; message: string };

export async function requestDocumentImageUploadUrl(
  documentId: string,
  input: DocumentImageUploadRequestDto,
): Promise<DocumentImageUploadUrlResult> {
  try {
    const data = await apiPost<FileUploadUrlResponse>(
      `/documents/${documentId}/images/upload-url`,
      input,
    );
    return { ok: true, data };
  } catch (e) {
    const err = e as ApiError;
    if (err.status === 503) {
      return {
        ok: false,
        storageUnavailable: true,
        message:
          'El almacenamiento de archivos no está configurado en este entorno. No es posible subir imágenes por ahora.',
      };
    }
    return { ok: false, storageUnavailable: false, message: err.message };
  }
}

export async function confirmDocumentImageUpload(
  documentId: string,
  fileId: string,
  sizeBytes: number,
): Promise<DocumentImageConfirmResult> {
  try {
    const data = await apiPost<DocumentImageConfirmResponse>(
      `/documents/${documentId}/images/${fileId}/confirm`,
      { sizeBytes },
    );
    return { ok: true, data };
  } catch (e) {
    return { ok: false, message: (e as ApiError).message };
  }
}
