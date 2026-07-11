'use server';

import { revalidatePath } from 'next/cache';
import { apiPost, apiPut, apiDelete } from '@/lib/api';
import type {
  InstrumentUploadUrlRequestDto,
  InstrumentUploadUrlResponse,
  ConfirmInstrumentAttachmentDto,
  InstrumentAttachmentModel,
} from '@soe/types';

type ApiError = Error & { status?: number };

// El flujo de subida del PDF del enunciado (TKT-15) es de 3 pasos con presigned
// URL de S3. Los pasos 1 (pedir URL) y 3 (confirmar) pasan por el backend con
// auth y viven como server actions. El paso 2 (PUT del archivo a S3) ocurre en
// el cliente, porque el archivo está en el navegador y no debe pasar por memoria
// del server (§11 seguridad).

export type EnunciadoUploadUrlResult =
  | { ok: true; data: InstrumentUploadUrlResponse }
  | { ok: false; message: string; storageUnavailable: boolean };

export type EnunciadoConfirmResult =
  | { ok: true; data: InstrumentAttachmentModel }
  | { ok: false; message: string };

export type EnunciadoDeleteResult = { ok: true } | { ok: false; message: string };

/** Paso 1: pedir la URL prefirmada de subida. */
export async function requestEnunciadoUploadUrl(
  instrumentId: string,
  input: InstrumentUploadUrlRequestDto,
): Promise<EnunciadoUploadUrlResult> {
  try {
    const data = await apiPost<InstrumentUploadUrlResponse>(
      `/instruments/${instrumentId}/enunciado-pdf/upload-url`,
      input,
    );
    return { ok: true, data };
  } catch (e) {
    const err = e as ApiError;
    // 503 → S3 no está configurado en este entorno.
    if (err.status === 503) {
      return {
        ok: false,
        storageUnavailable: true,
        message:
          'El almacenamiento de archivos no está configurado en este entorno. No es posible subir el PDF por ahora.',
      };
    }
    return { ok: false, storageUnavailable: false, message: err.message };
  }
}

/** Paso 3: confirmar la subida y persistir la metadata del adjunto. */
export async function confirmEnunciadoPdf(
  instrumentId: string,
  input: ConfirmInstrumentAttachmentDto,
): Promise<EnunciadoConfirmResult> {
  try {
    const data = await apiPut<InstrumentAttachmentModel>(
      `/instruments/${instrumentId}/enunciado-pdf`,
      input,
    );
    revalidatePath(`/banco-items/${instrumentId}`);
    return { ok: true, data };
  } catch (e) {
    const err = e as ApiError;
    return { ok: false, message: err.message };
  }
}

/** Elimina el PDF del enunciado del instrumento. */
export async function deleteEnunciadoPdf(
  instrumentId: string,
): Promise<EnunciadoDeleteResult> {
  try {
    await apiDelete(`/instruments/${instrumentId}/enunciado-pdf`);
    revalidatePath(`/banco-items/${instrumentId}`);
    return { ok: true };
  } catch (e) {
    const err = e as ApiError;
    return { ok: false, message: err.message };
  }
}
