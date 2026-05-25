'use server';

import { apiPostFormData } from '@/lib/api';
import type {
  StudentImportCommitResponse,
  StudentImportPreviewResponse,
} from '@soe/types';

type ApiError = Error & { status?: number; details?: unknown };

export type PreviewActionResult =
  | { ok: true; data: StudentImportPreviewResponse }
  | { ok: false; message: string; details?: unknown };

export type CommitActionResult =
  | { ok: true; data: StudentImportCommitResponse }
  | { ok: false; message: string; status?: number; details?: unknown };

export async function previewImportAction(formData: FormData): Promise<PreviewActionResult> {
  try {
    const data = await apiPostFormData<StudentImportPreviewResponse>(
      '/students/import/preview',
      formData,
    );
    return { ok: true, data };
  } catch (e) {
    const err = e as ApiError;
    return { ok: false, message: err.message, details: err.details };
  }
}

export async function commitImportAction(formData: FormData): Promise<CommitActionResult> {
  try {
    const data = await apiPostFormData<StudentImportCommitResponse>(
      '/students/import/commit',
      formData,
    );
    return { ok: true, data };
  } catch (e) {
    const err = e as ApiError;
    return { ok: false, message: err.message, status: err.status, details: err.details };
  }
}
