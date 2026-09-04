'use server';

import { apiPost } from '@/lib/api';
import { getDisplayMessage } from '@/lib/errors';
import type {
  BatchStatusModel,
  CreateScanBatchDto,
  CreateScanBatchResponse,
} from '@soe/types';

export type CreateScanBatchResult =
  | { ok: true; data: CreateScanBatchResponse }
  | { ok: false; message: string };

export async function createScanBatch(dto: CreateScanBatchDto): Promise<CreateScanBatchResult> {
  try {
    const data = await apiPost<CreateScanBatchResponse>('/sheet-scan-batches', dto);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, message: getDisplayMessage(e, 'No se pudo crear el lote de escaneo') };
  }
}

export type ConfirmScanFileResult = { ok: true } | { ok: false; message: string };

export async function confirmScanFile(
  fileId: string,
  sizeBytes: number,
): Promise<ConfirmScanFileResult> {
  try {
    await apiPost(`/files/${fileId}/confirm`, { sizeBytes });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: getDisplayMessage(e, 'No se pudo confirmar el archivo subido') };
  }
}

export type StartScanBatchResult =
  | { ok: true; data: BatchStatusModel }
  | { ok: false; message: string };

export async function startScanBatch(batchId: string): Promise<StartScanBatchResult> {
  try {
    const data = await apiPost<BatchStatusModel>(`/sheet-scan-batches/${batchId}/start`, {});
    return { ok: true, data };
  } catch (e) {
    return { ok: false, message: getDisplayMessage(e, 'No se pudo iniciar el procesamiento') };
  }
}
