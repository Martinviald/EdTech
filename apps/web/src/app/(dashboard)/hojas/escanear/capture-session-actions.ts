'use server';

import { apiPost } from '@/lib/api';
import { getDisplayMessage } from '@/lib/errors';
import type {
  CaptureSessionStatusModel,
  CreateCaptureSessionResponse,
  FinishCaptureSessionResponse,
} from '@soe/types';

export type CreateCaptureSessionResult =
  | { ok: true; data: CreateCaptureSessionResponse }
  | { ok: false; message: string };

export async function createCaptureSession(
  printRunId: string,
): Promise<CreateCaptureSessionResult> {
  try {
    const data = await apiPost<CreateCaptureSessionResponse>('/sheet-capture-sessions', {
      printRunId,
    });
    return { ok: true, data };
  } catch (e) {
    return {
      ok: false,
      message: getDisplayMessage(e, 'No se pudo generar el código para el teléfono'),
    };
  }
}

export type RevokeCaptureSessionResult =
  | { ok: true; data: CaptureSessionStatusModel }
  | { ok: false; message: string };

export async function revokeCaptureSession(
  sessionId: string,
): Promise<RevokeCaptureSessionResult> {
  try {
    const data = await apiPost<CaptureSessionStatusModel>(
      `/sheet-capture-sessions/${sessionId}/revoke`,
      {},
    );
    return { ok: true, data };
  } catch (e) {
    return { ok: false, message: getDisplayMessage(e, 'No se pudo revocar el código') };
  }
}

export type FinishCaptureSessionResult =
  | { ok: true; data: FinishCaptureSessionResponse }
  | { ok: false; message: string };

export async function finishCaptureSession(
  sessionId: string,
): Promise<FinishCaptureSessionResult> {
  try {
    const data = await apiPost<FinishCaptureSessionResponse>(
      `/sheet-capture-sessions/${sessionId}/finish`,
      {},
    );
    return { ok: true, data };
  } catch (e) {
    return {
      ok: false,
      message: getDisplayMessage(e, 'No se pudo cerrar la captura para procesar el lote'),
    };
  }
}
