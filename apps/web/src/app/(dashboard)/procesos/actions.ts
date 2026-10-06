'use server';

import { revalidatePath } from 'next/cache';
import type {
  CreateMeasurementProcessDto,
  LinkProcessAssessmentsDto,
  MeasurementProcessModel,
  UpdateMeasurementProcessDto,
} from '@soe/types';
import { apiDelete, apiPatch, apiPost } from '@/lib/api';

type ApiError = Error & { status?: number };

export type ProcessActionResult<T = MeasurementProcessModel> =
  | { ok: true; data: T }
  | { ok: false; message: string };

export async function createProcess(
  dto: CreateMeasurementProcessDto,
): Promise<ProcessActionResult> {
  try {
    const data = await apiPost<MeasurementProcessModel>('/measurement-processes', dto);
    revalidatePath('/procesos');
    return { ok: true, data };
  } catch (e) {
    return { ok: false, message: (e as ApiError).message };
  }
}

export async function updateProcess(
  processId: string,
  dto: UpdateMeasurementProcessDto,
): Promise<ProcessActionResult> {
  try {
    const data = await apiPatch<MeasurementProcessModel>(
      `/measurement-processes/${processId}`,
      dto,
    );
    revalidatePath('/procesos');
    revalidatePath(`/procesos/${processId}`);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, message: (e as ApiError).message };
  }
}

export async function deleteProcess(
  processId: string,
): Promise<ProcessActionResult<{ id: string; unlinked: number }>> {
  try {
    const data = await apiDelete<{ id: string; unlinked: number }>(
      `/measurement-processes/${processId}`,
    );
    revalidatePath('/procesos');
    return { ok: true, data };
  } catch (e) {
    return { ok: false, message: (e as ApiError).message };
  }
}

export async function linkProcessAssessments(
  processId: string,
  dto: LinkProcessAssessmentsDto,
): Promise<ProcessActionResult<{ processId: string; linked: number; unlinked: number }>> {
  try {
    const data = await apiPost<{ processId: string; linked: number; unlinked: number }>(
      `/measurement-processes/${processId}/assessments`,
      dto,
    );
    revalidatePath(`/procesos/${processId}`);
    revalidatePath(`/procesos/${processId}/rendicion`);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, message: (e as ApiError).message };
  }
}
