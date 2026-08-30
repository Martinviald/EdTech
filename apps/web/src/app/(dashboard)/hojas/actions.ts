'use server';

<<<<<<< HEAD
import { cookies } from 'next/headers';
import { apiPatch, apiPost } from '@/lib/api';
=======
import { apiGetBinary, apiPost } from '@/lib/api';
>>>>>>> 31fb615 (feat(e22): V2-B4 — apiGetBinary server-only y migración de la descarga del PDF de tiradas)
import { getDisplayMessage } from '@/lib/errors';
import type {
  CreatePrintRunDto,
  FreezeLayoutResponse,
  LayoutSpec,
  PrintRunModel,
} from '@soe/types';

export type FreezeLayoutResult =
  | { ok: true; data: FreezeLayoutResponse }
  | { ok: false; message: string };

export async function freezeLayout(spec: LayoutSpec): Promise<FreezeLayoutResult> {
  try {
    const data = await apiPost<FreezeLayoutResponse>('/sheet-layouts', { spec });
    return { ok: true, data };
  } catch (e) {
    return { ok: false, message: getDisplayMessage(e, 'No se pudo congelar el layout') };
  }
}

export type CreatePrintRunResult =
  | { ok: true; data: PrintRunModel }
  | { ok: false; message: string };

export async function createPrintRun(dto: CreatePrintRunDto): Promise<CreatePrintRunResult> {
  try {
    const data = await apiPost<PrintRunModel>('/sheet-print-runs', dto);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, message: getDisplayMessage(e, 'No se pudo crear la tirada') };
  }
}

/**
 * Asocia (o cambia) la evaluación de una tirada ya creada
 * (`PATCH /sheet-print-runs/:id`). Sin esto, las tiradas creadas antes del
 * selector de evaluación quedaban sin destino y su lote nunca podía confirmarse.
 */
export async function updatePrintRunAssessment(
  runId: string,
  assessmentId: string,
): Promise<CreatePrintRunResult> {
  try {
    const data = await apiPatch<PrintRunModel>(`/sheet-print-runs/${runId}`, { assessmentId });
    return { ok: true, data };
  } catch (e) {
    return { ok: false, message: getDisplayMessage(e, 'No se pudo asociar la evaluación') };
  }
}

/**
 * Crea la evaluación del instrumento de la tirada y la asocia en un solo paso
 * (`PATCH /sheet-print-runs/:id` con `createAssessment`). Es la salida del caso
 * sin escapatoria: instrumento sin ninguna evaluación + tirada ya creada, donde
 * el autocreado de #158 (que sólo corre al crear la tirada) no llega.
 */
export async function createPrintRunAssessment(runId: string): Promise<CreatePrintRunResult> {
  try {
    const data = await apiPatch<PrintRunModel>(`/sheet-print-runs/${runId}`, {
      createAssessment: true,
    });
    return { ok: true, data };
  } catch (e) {
    return { ok: false, message: getDisplayMessage(e, 'No se pudo crear la evaluación') };
  }
}

export type DownloadPdfResult =
  | { ok: true; base64: string; fileName: string }
  | { ok: false; message: string };

/**
 * Descarga del PDF de una tirada (`GET /sheet-print-runs/:id/pdf`,
 * `application/pdf`) vía `apiGetBinary` (lib/api.ts). Los bytes cruzan el
 * boundary de la server action como base64 y el cliente arma el Blob.
 */
export async function downloadPrintRunPdf(runId: string): Promise<DownloadPdfResult> {
  try {
    const { bytes, filename } = await apiGetBinary(`/sheet-print-runs/${runId}/pdf`);
    return {
      ok: true,
      base64: Buffer.from(bytes).toString('base64'),
      fileName: filename ?? `hojas-de-respuesta-${runId.slice(0, 8)}.pdf`,
    };
  } catch (e) {
    return { ok: false, message: getDisplayMessage(e, 'No se pudo generar el PDF') };
  }
}
