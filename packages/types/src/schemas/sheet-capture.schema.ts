import { z } from 'zod';
import {
  ASSESS_CAPTURE_MAX_IMAGE_BYTES,
  type AssessCaptureIdentityModel,
  type AssessCaptureResponse,
  type ScanUploadIntent,
  type SheetScanBatchStatus,
} from './sheet-scanning.schema';

// ── Captura remota con teléfono (E22-R) — contrato API ⇄ web ⇄ móvil ─────────
// Sesiones de emparejamiento QR PC→teléfono (CD-16..CD-23 en
// docs/e22-lector-contracts.md §11). El teléfono NUNCA tiene sesión de usuario:
// canjea el secreto del QR por un capture token acotado a un único lote.

export const CAPTURE_SESSION_STATUSES = [
  'pending',
  'active',
  'closed',
  'revoked',
  'expired',
] as const;
export type CaptureSessionStatus = (typeof CAPTURE_SESSION_STATUSES)[number];

export const CAPTURE_SESSION_TTL_MINUTES = 15;
export const CAPTURE_SESSION_MAX_REDEEMS = 3;
export const CAPTURE_SESSION_TOKEN_SCOPE = 'sheet-capture';
export const CAPTURE_SESSION_MAX_CAPTURES = 60;

const CAPTURE_MAX_BASE64_LENGTH = Math.ceil(ASSESS_CAPTURE_MAX_IMAGE_BYTES / 3) * 4;

// ── DTOs de entrada ──────────────────────────────────────────────────────────

export const createCaptureSessionSchema = z.object({
  printRunId: z.string().uuid(),
});

/** El secreto viaja en el fragment del QR (nunca en query/path) y se canjea una única vez por dispositivo. */
export const redeemCaptureSessionSchema = z.object({
  sessionId: z.string().uuid(),
  secret: z.string().min(32).max(200),
});

/** `printRunId` NO viene en el body: sale del capture token (jamás del cliente). */
export const captureAssessSchema = z.object({
  imageBase64: z.string().min(1).max(CAPTURE_MAX_BASE64_LENGTH),
});

export const captureIdentitySchema = z.object({
  printedSheetId: z.string().uuid().nullable(),
  pageIndex: z.number().int().min(0).nullable(),
  sheetSequence: z.number().int().min(0).nullable(),
  studentId: z.string().uuid().nullable(),
  studentName: z.string().max(200).nullable(),
  confidence: z.number().min(0).max(1),
});

/**
 * La identidad que acompaña al intent es la que devolvió el gate de assess y es
 * SOLO informativa (live view del PC). La resolución autoritativa ocurre en
 * /v1/read al procesar el lote: un token robado puede mentir la etiqueta, no
 * el resultado.
 */
export const captureUploadIntentSchema = z.object({
  fileName: z.string().min(1).max(300),
  mimeType: z.literal('image/jpeg'),
  sizeBytes: z
    .number()
    .int()
    .min(1)
    .max(ASSESS_CAPTURE_MAX_IMAGE_BYTES * 2),
  identity: captureIdentitySchema.nullable(),
});

export const captureConfirmFileSchema = z.object({
  sizeBytes: z.number().int().min(1),
});

export type CreateCaptureSessionDto = z.infer<typeof createCaptureSessionSchema>;
export type RedeemCaptureSessionDto = z.infer<typeof redeemCaptureSessionSchema>;
export type CaptureAssessDto = z.infer<typeof captureAssessSchema>;
export type CaptureUploadIntentDto = z.infer<typeof captureUploadIntentSchema>;
export type CaptureConfirmFileDto = z.infer<typeof captureConfirmFileSchema>;

// ── Models de respuesta ──────────────────────────────────────────────────────

/** El secreto en claro viaja UNA sola vez (creación → QR). Se persiste sólo su sha256. */
export type CreateCaptureSessionResponse = {
  sessionId: string;
  batchId: string;
  secret: string;
  expiresAt: string | Date;
};

export type CaptureSessionContextModel = {
  courseLabel: string | null;
  instrumentName: string | null;
  sheetCount: number;
};

export type RedeemCaptureSessionResponse = {
  token: string;
  expiresAt: string | Date;
  context: CaptureSessionContextModel;
  capturedCount: number;
};

/** Evidencia para el live view; se agrega al aceptar cada foto (upload-intent). */
export type CaptureSessionCapture = {
  fileId: string;
  fileName: string;
  identity: AssessCaptureIdentityModel | null;
  capturedAt: string;
};

export type CaptureSessionStatusModel = {
  id: string;
  status: CaptureSessionStatus;
  batchId: string;
  printRunId: string;
  expiresAt: string | Date;
  redeemCount: number;
  captures: CaptureSessionCapture[];
  context: CaptureSessionContextModel;
};

export type FinishCaptureSessionResponse = {
  batchId: string;
  batchStatus: SheetScanBatchStatus;
};

/**
 * Costura de red inyectable de la captura (CD-21): la MISMA UI de cámara corre
 * con la sesión autenticada del dashboard (proxy + cookie) o con el capture
 * token del teléfono (capture-proxy + Bearer). Las implementaciones viven en
 * apps/web; este tipo es el contrato congelado entre ambas.
 */
export type CaptureTransport = {
  assess(imageBase64: string): Promise<AssessCaptureResponse>;
  createUploadIntent(
    meta: Omit<CaptureUploadIntentDto, 'mimeType'>,
  ): Promise<ScanUploadIntent>;
  confirmFile(fileId: string, sizeBytes: number): Promise<void>;
};
