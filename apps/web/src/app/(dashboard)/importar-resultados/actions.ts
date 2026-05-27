'use server';

import { apiGet, apiPost, apiPostFormData } from '@/lib/api';
import type {
  AnswerSheetUploadResponse,
  AnswerSheetPreviewResponse,
  AnswerSheetConfirmResponse,
  AnswerSheetConfirmRequestDto,
  AnswerSheetTemplate,
  ImportJobModel,
} from '@soe/types';

type ApiError = Error & { status?: number; details?: unknown };

export type UploadActionResult =
  | { ok: true; data: AnswerSheetUploadResponse }
  | { ok: false; message: string };

export type PreviewActionResult =
  | { ok: true; data: AnswerSheetPreviewResponse }
  | { ok: false; message: string };

export type ConfirmActionResult =
  | { ok: true; data: AnswerSheetConfirmResponse }
  | { ok: false; message: string };

export type JobActionResult =
  | { ok: true; data: ImportJobModel }
  | { ok: false; message: string };

export type TemplatesActionResult =
  | { ok: true; data: AnswerSheetTemplate[] }
  | { ok: false; message: string };

export async function uploadAnswerSheetAction(
  formData: FormData,
): Promise<UploadActionResult> {
  try {
    const data = await apiPostFormData<AnswerSheetUploadResponse>(
      '/answer-sheets/upload',
      formData,
    );
    return { ok: true, data };
  } catch (e) {
    const err = e as ApiError;
    return { ok: false, message: err.message };
  }
}

export async function previewAnswerSheetAction(
  previewToken: string,
): Promise<PreviewActionResult> {
  try {
    const data = await apiPost<AnswerSheetPreviewResponse>('/answer-sheets/preview', {
      previewToken,
    });
    return { ok: true, data };
  } catch (e) {
    const err = e as ApiError;
    return { ok: false, message: err.message };
  }
}

export async function confirmAnswerSheetAction(
  body: AnswerSheetConfirmRequestDto,
): Promise<ConfirmActionResult> {
  try {
    const data = await apiPost<AnswerSheetConfirmResponse>('/answer-sheets/confirm', body);
    return { ok: true, data };
  } catch (e) {
    const err = e as ApiError;
    return { ok: false, message: err.message };
  }
}

export async function getImportJobAction(jobId: string): Promise<JobActionResult> {
  try {
    const data = await apiGet<ImportJobModel>(`/answer-sheets/jobs/${jobId}`);
    return { ok: true, data };
  } catch (e) {
    const err = e as ApiError;
    return { ok: false, message: err.message };
  }
}

export async function listTemplatesAction(): Promise<TemplatesActionResult> {
  try {
    const data = await apiGet<AnswerSheetTemplate[]>('/answer-sheets/templates');
    return { ok: true, data };
  } catch (e) {
    const err = e as ApiError;
    return { ok: false, message: err.message };
  }
}
