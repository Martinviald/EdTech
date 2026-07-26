'use server';

import { apiPost, apiPostFormData } from '@/lib/api';
import type {
  SpecTableUploadResponse,
  SpecTableLinkResponse,
  SpecTableMappingDto,
} from '@soe/types';

type ApiError = Error & { status?: number; details?: unknown };

export type SpecTableUploadActionResult =
  | { ok: true; data: SpecTableUploadResponse }
  | { ok: false; message: string };

export type SpecTableLinkActionResult =
  | { ok: true; data: SpecTableLinkResponse }
  | { ok: false; message: string };

export async function uploadSpecTable(
  formData: FormData,
): Promise<SpecTableUploadActionResult> {
  try {
    const data = await apiPostFormData<SpecTableUploadResponse>(
      '/spec-tables/upload',
      formData,
    );
    return { ok: true, data };
  } catch (e) {
    const err = e as ApiError;
    return { ok: false, message: err.message };
  }
}

export async function linkSpecTable(
  mapping: SpecTableMappingDto,
): Promise<SpecTableLinkActionResult> {
  try {
    const data = await apiPost<SpecTableLinkResponse>('/spec-tables/link', mapping);
    return { ok: true, data };
  } catch (e) {
    const err = e as ApiError;
    return { ok: false, message: err.message };
  }
}
