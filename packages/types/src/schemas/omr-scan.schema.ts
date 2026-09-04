import { z } from 'zod';
import { captureProfileSchema, layoutSpecSchema, SHEET_IDENTITY_MODES } from './omr-layout.schema';

// ── Lector de marcas (E22) — ScanResult, la salida del servicio de visión ────
// Contrato HTTP `POST /v1/read` del servicio Python (sin estado, sin DB, sin
// conocimiento de tenants: una función pura sobre (imagen, spec)). El QualityGate
// corre DENTRO del servicio y su veredicto es parte de la respuesta: un 200 con
// quality.ok === false es una respuesta correcta, nunca una inferencia del caller.
// Ver docs/diseno-lector-de-marcas/03-contratos.md §3.3–3.4 y
// docs/e22-lector-contracts.md (enmiendas CD-1..CD-3).

export const MARK_STATES = ['marked', 'blank', 'multiple', 'ambiguous'] as const;
export type MarkState = (typeof MARK_STATES)[number];

/**
 * `blank` = el alumno NO marcó, con separación clara. Una página que no llegó a
 * escanearse no produce `blank`: no produce nada y el escaneo queda incompleto (G3).
 * `margin = |fill − threshold| / threshold` ordena la cola: lo más dudoso primero.
 * CD-1: la evidencia visual viaja INLINE (base64) sólo para marcas que van a la
 * cola (multiple/ambiguous) — el servicio queda sin credenciales de escritura.
 */
export const markReadingSchema = z.object({
  fieldId: z.string(),
  printedNumber: z.string(),
  state: z.enum(MARK_STATES),
  value: z.string().nullable(),
  fill: z.number().min(0).max(1),
  threshold: z.number().min(0).max(1),
  margin: z.number(),
  cropJpegBase64: z.string().nullable(),
});

export const PAGE_REJECT_REASONS = [
  'blurry',
  'glare',
  'fiducials_missing',
  'cropped',
  'no_separable_marks',
] as const;
export type PageRejectReason = (typeof PAGE_REJECT_REASONS)[number];

export const MARKS_READABILITY = ['readable', 'likely_blank', 'unreadable'] as const;
export type MarksReadability = (typeof MARKS_READABILITY)[number];

export const pageQualitySchema = z.object({
  ok: z.boolean(),
  sharpness: z.number().min(0).max(1),
  glare: z.number().min(0).max(1),
  fiducialsFound: z.number().int().min(0).max(4),
  rejectReason: z.enum(PAGE_REJECT_REASONS).nullable(),
  /**
   * La página se leyó reintentando con la iluminación aplanada: el primer pase
   * se rechazó por `no_separable_marks` y el segundo, sobre la captura sin
   * gradiente de luz, sí quedó legible. Es evidencia para auditar después qué
   * lecturas dependieron del reintento; no cambia cómo se interpreta el resto
   * de `quality`. Optional sin default: los payloads previos siguen validando
   * sin cambios (mismo criterio que `qrRaw`).
   */
  illuminationFlattened: z.boolean().optional(),
  /**
   * Por qué las marcas de la página no se pudieron leer, cuando `rejectReason`
   * es `no_separable_marks`. `likely_blank` = ninguna burbuja llega a tinta
   * real: la hoja parece sin responder y repetir la foto NO sirve.
   * `unreadable` = hay tinta pero desparramada (sombra, luz despareja) y
   * repetir la foto sí puede servir. `readable` = las marcas se separan.
   *
   * El umbral que las separa (`BLANK_SHEET_MAX_FILL` en el servicio) está
   * PENDIENTE DE CALIBRACIÓN con fotos reales de hojas sin marcar; ante la duda
   * clasifica como `unreadable`. Optional sin default: sólo lo emiten las
   * páginas que llegaron a muestrear marcas.
   */
  marksReadability: z.enum(MARKS_READABILITY).optional(),
});

export const scannedPageIdentitySchema = z.object({
  mode: z.enum(SHEET_IDENTITY_MODES),
  /** Payload crudo del QR (`academos:v1:...`) o null si no se pudo decodificar. Lo interpreta el backend, nunca el servicio. */
  raw: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  /**
   * CD-15: payload del QR de esquina (`academos:v1:...`) o null si es ilegible.
   * En modo `qr` duplica `raw`; en modo `rut_bubbles` `raw` lleva los dígitos
   * RUT leídos y este campo lleva el QR que identifica la copia física.
   * Optional sin default: los payloads del MVP siguen validando sin cambios.
   */
  qrRaw: z.string().nullable().optional(),
});

/**
 * `pageIndex` = posición dentro del ARCHIVO fuente (orden del PDF / orden de las
 * fotos). El pageIndex LÓGICO de la hoja viaja dentro del QR (CD-2).
 * `imageSha256` = hash del bitmap rasterizado de la página; es la pieza de la
 * idempotencia D13 (printedSheetId, pageIndex, imageHash) (CD-3).
 * `pageThumbJpegBase64` sólo viene cuando la página necesita revisión humana
 * (calidad rechazada o identidad sin resolver) — CD-1.
 */
export const scannedPageSchema = z.object({
  pageIndex: z.number().int().min(0),
  imageSha256: z.string().length(64),
  quality: pageQualitySchema,
  identity: scannedPageIdentitySchema,
  marks: z.array(markReadingSchema),
  pageThumbJpegBase64: z.string().nullable(),
});

export const scanResultSchema = z.object({
  pages: z.array(scannedPageSchema),
});

export type MarkReading = z.infer<typeof markReadingSchema>;
export type PageQuality = z.infer<typeof pageQualitySchema>;
export type ScannedPage = z.infer<typeof scannedPageSchema>;
export type ScanResult = z.infer<typeof scanResultSchema>;

/** Un archivo fuente por llamada: un PDF multipágina O una lista ordenada de fotos (CD-2). */
export const omrReadSourceSchema = z
  .object({
    kind: z.enum(['pdf', 'images']),
    pdfUrl: z.string().url().nullable(),
    imageUrls: z.array(z.string().url()).nullable(),
  })
  .refine((s) => (s.kind === 'pdf' ? s.pdfUrl !== null : (s.imageUrls?.length ?? 0) > 0), {
    message: 'pdf requiere pdfUrl; images requiere imageUrls no vacío',
  });

export const omrReadRequestSchema = z.object({
  layoutSpec: layoutSpecSchema,
  captureProfile: captureProfileSchema,
  source: omrReadSourceSchema,
});

export type OmrReadSource = z.infer<typeof omrReadSourceSchema>;
export type OmrReadRequest = z.infer<typeof omrReadRequestSchema>;

export const omrAssessRequestSchema = z.object({
  layoutSpec: layoutSpecSchema,
  captureProfile: captureProfileSchema,
  imageBase64: z.string().min(1),
});

export const omrAssessResultSchema = z.object({
  imageSha256: z.string().length(64),
  quality: pageQualitySchema,
  identity: scannedPageIdentitySchema,
});

export type OmrAssessRequest = z.infer<typeof omrAssessRequestSchema>;
export type OmrAssessResult = z.infer<typeof omrAssessResultSchema>;
