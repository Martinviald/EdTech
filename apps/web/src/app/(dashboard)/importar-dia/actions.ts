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

type BackendPreviewResponse = {
  items: Array<{
    position: number;
    type: string;
    skillName: string | null;
    oaCode: string | null;
    contentAxis: string | null;
    content: { stem?: string; alternatives?: unknown; correctKey?: string } & Record<string, unknown>;
  }>;
  errors: Array<{ position: number; message: string }>;
  summary: {
    totalItems: number;
    validItems: number;
    errorCount: number;
    matchedSkills: number;
    unmatchedSkills: string[];
  };
};

export async function previewDiaImport(
  data: unknown,
  metadata: DiaIngestionRequestDto,
): Promise<DiaPreviewActionResult> {
  try {
    const raw = await apiPost<BackendPreviewResponse>('/dia-ingestion/preview', {
      data,
      metadata,
    });

    const warnings: string[] = [];
    if (raw.summary?.unmatchedSkills?.length) {
      for (const skill of raw.summary.unmatchedSkills) {
        warnings.push(`Habilidad no encontrada en taxonomía: "${skill}"`);
      }
    }
    if (raw.errors?.length) {
      for (const err of raw.errors) {
        warnings.push(`Ítem #${err.position}: ${err.message}`);
      }
    }

    const items: DiaPreviewResponse['items'] = (raw.items ?? []).map((item) => ({
      position: item.position,
      type: item.type,
      correctKey: item.content?.correctKey ?? null,
      skill: item.skillName ?? null,
      oa: item.oaCode ?? null,
      content: item.content,
    }));

    return { ok: true, data: { items, warnings } };
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
