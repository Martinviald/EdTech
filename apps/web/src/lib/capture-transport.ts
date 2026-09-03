import type {
  AssessCaptureResponse,
  CaptureTransport,
  FinishCaptureSessionResponse,
  RedeemCaptureSessionResponse,
  ScanUploadIntent,
} from '@soe/types';
import { apiClientPost } from '@/lib/api-client';
import { ApiConnectionError, ApiRequestError } from '@/lib/errors';

/**
 * Implementaciones del `CaptureTransport` congelado en `@soe/types` (CD-21):
 * la misma UI de cámara corre con la sesión autenticada del dashboard
 * (proxy genérico + cookie) o con el capture token del teléfono
 * (capture-proxy dedicado + Bearer). Ambas lanzan el mismo `ApiRequestError`
 * de `@/lib/errors` — una sola moneda de error en toda la app.
 */
export function createAuthenticatedCaptureTransport(printRunId: string): CaptureTransport {
  return {
    assess: (imageBase64) =>
      apiClientPost<AssessCaptureResponse>('/sheet-scan-batches/assess-capture', {
        printRunId,
        imageBase64,
      }),
    createUploadIntent: () => {
      throw new Error('createUploadIntent no está disponible en el flujo autenticado');
    },
    confirmFile: () => {
      throw new Error('confirmFile no está disponible en el flujo autenticado');
    },
  };
}

export function createCaptureTokenTransport(token: string): CaptureTransport {
  return {
    assess: (imageBase64) =>
      captureProxyPost<AssessCaptureResponse>('/assess', { imageBase64 }, token),
    createUploadIntent: (meta) =>
      captureProxyPost<ScanUploadIntent>(
        '/upload-intent',
        { ...meta, mimeType: 'image/jpeg' },
        token,
      ),
    confirmFile: (fileId, sizeBytes) =>
      captureProxyPost<void>(`/files/${fileId}/confirm`, { sizeBytes }, token),
  };
}

export function redeemCaptureSession(
  sessionId: string,
  secret: string,
): Promise<RedeemCaptureSessionResponse> {
  return captureProxyPost<RedeemCaptureSessionResponse>('/redeem', { sessionId, secret });
}

export function finishCaptureSession(token: string): Promise<FinishCaptureSessionResponse> {
  return captureProxyPost<FinishCaptureSessionResponse>('/finish', {}, token);
}

async function captureProxyPost<T>(path: string, body: unknown, token?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/capture-proxy${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiConnectionError();
  }

  if (!res.ok) {
    const parsed = await res.json().catch(() => ({}));
    throw new ApiRequestError(
      res.status,
      (parsed as { message?: string }).message ?? `API error ${res.status}`,
      parsed,
    );
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
