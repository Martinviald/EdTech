'use server';

import { apiPost } from '@/lib/api';
import type {
  DiaIngestionRequestDto,
  DiaPreviewResponse,
  DiaConfirmResponse,
} from '@soe/types';

type ApiError = Error & { status?: number; details?: unknown };

export type DiaPreviewActionResult =
  | { ok: true; data: DiaPreviewResponse }
  | { ok: false; message: string };

export type DiaConfirmActionResult =
  | { ok: true; data: DiaConfirmResponse }
  | { ok: false; message: string };

export async function previewDiaImport(
  data: unknown,
  metadata: DiaIngestionRequestDto,
): Promise<DiaPreviewActionResult> {
  try {
    const result = await apiPost<DiaPreviewResponse>('/dia-ingestion/preview', {
      data,
      metadata,
    });
    return { ok: true, data: result };
  } catch (e) {
    const err = e as ApiError;
    return { ok: false, message: err.message };
  }
}

export async function confirmDiaImport(
  data: unknown,
  metadata: DiaIngestionRequestDto,
): Promise<DiaConfirmActionResult> {
  try {
    const result = await apiPost<DiaConfirmResponse>('/dia-ingestion/confirm', {
      data,
      metadata,
    });
    return { ok: true, data: result };
  } catch (e) {
    const err = e as ApiError;
    return { ok: false, message: err.message };
  }
}
