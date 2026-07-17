import { z } from 'zod';
import { INSTRUMENT_TYPES, type InstrumentType } from '../enums';

export const INSTRUMENT_STATUS = ['draft', 'published', 'archived'] as const;
export type InstrumentStatus = (typeof INSTRUMENT_STATUS)[number];

/**
 * Momento de aplicación del instrumento dentro del año escolar. Los valores son
 * los que traen los JSON oficiales de extracción DIA; la etiqueta que ve el
 * usuario vive en `INSTRUMENT_APPLICATION_PERIOD_LABELS` (el DIA llama
 * "monitoreo" a la aplicación `intermedio`).
 */
export const INSTRUMENT_APPLICATION_PERIODS = ['diagnostico', 'intermedio', 'cierre'] as const;
export type InstrumentApplicationPeriod = (typeof INSTRUMENT_APPLICATION_PERIODS)[number];

export const INSTRUMENT_APPLICATION_PERIOD_LABELS: Record<InstrumentApplicationPeriod, string> = {
  diagnostico: 'Diagnóstico',
  intermedio: 'Monitoreo',
  cierre: 'Cierre',
};

/** Narrowing de un texto libre (JSON de ingesta) al enum. Devuelve null si no calza. */
export function toApplicationPeriod(
  value: string | null | undefined,
): InstrumentApplicationPeriod | null {
  const normalized = value?.trim().toLowerCase();
  return INSTRUMENT_APPLICATION_PERIODS.find((p) => p === normalized) ?? null;
}

export const SECTION_TYPES = [
  'multiple_choice',
  'open_ended',
  'oral_reading',
  'oral_expression',
  'writing',
  'listening',
  'matching',
  'mixed',
] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

export const GRADING_SCALE_TYPES = [
  'linear_chilean',
  'percentage',
  'paes_scaled',
  'irt_based',
  'custom',
] as const;
export type GradingScaleType = (typeof GRADING_SCALE_TYPES)[number];

export const PASSAGE_FORMATS = ['plain', 'markdown', 'html'] as const;
export type PassageFormat = (typeof PASSAGE_FORMATS)[number];

export const ATTACHMENT_KINDS = ['image', 'audio', 'pdf', 'other'] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

const instrumentTypeSchema = z.enum(INSTRUMENT_TYPES);
const instrumentStatusSchema = z.enum(INSTRUMENT_STATUS);
const instrumentApplicationPeriodSchema = z.enum(INSTRUMENT_APPLICATION_PERIODS);
const sectionTypeSchema = z.enum(SECTION_TYPES);
const gradingScaleTypeSchema = z.enum(GRADING_SCALE_TYPES);

// ── Grading Scales ───────────────────────────────────────────────────────────

export const createGradingScaleSchema = z.object({
  name: z.string().min(2).max(200),
  type: gradingScaleTypeSchema,
  minGrade: z.coerce.number().min(0).max(100).default(1),
  maxGrade: z.coerce.number().min(1).max(100).default(7),
  passingGrade: z.coerce.number().min(0).max(100).default(4),
  passingThreshold: z.coerce.number().min(0).max(1).default(0.6),
  config: z.record(z.unknown()).optional(),
});

export const updateGradingScaleSchema = createGradingScaleSchema.partial();

export type CreateGradingScaleDto = z.infer<typeof createGradingScaleSchema>;
export type UpdateGradingScaleDto = z.infer<typeof updateGradingScaleSchema>;

// ── Section Passage / Attachments ────────────────────────────────────────────

export const sectionAttachmentInputSchema = z.object({
  kind: z.enum(ATTACHMENT_KINDS),
  order: z.number().int().min(0).default(0),
  storageKey: z.string().max(1024).optional(),
  url: z.string().url().optional(),
  fileName: z.string().max(300).optional(),
  mimeType: z.string().max(150).optional(),
  sizeBytes: z.number().int().min(0).optional(),
  note: z.string().max(2000).optional(),
  meta: z.record(z.unknown()).optional(),
});

export const passageSchema = z.object({
  title: z.string().max(300).optional(),
  text: z.string().min(1),
  format: z.enum(PASSAGE_FORMATS).default('plain'),
});

export type SectionAttachmentInputDto = z.infer<typeof sectionAttachmentInputSchema>;
export type PassageDto = z.infer<typeof passageSchema>;

// ── Instrument-level attachment / Enunciado PDF (TKT-15) ─────────────────────
// Un instrumento puede tener adjuntos a nivel de instrumento (no de sección). El
// caso principal es el PDF del enunciado / cuadernillo. La subida es en 2 pasos con
// presigned URL de S3 (el backend NO recibe el archivo en memoria):
//   1) POST /instruments/:id/enunciado-pdf/upload-url  → { storageKey, uploadUrl }
//   2) el cliente hace PUT del archivo directo a S3
//   3) PUT  /instruments/:id/enunciado-pdf             → confirma y persiste metadata

/** Paso 1: pedir la URL prefirmada de subida del PDF de enunciado. */
export const instrumentUploadUrlRequestSchema = z.object({
  fileName: z.string().min(1).max(300),
  mimeType: z.string().min(1).max(150).default('application/pdf'),
  sizeBytes: z.number().int().min(1).max(50 * 1024 * 1024).optional(),
});

/** Paso 3: confirmar la subida (persistir el adjunto) tras el PUT a S3. */
export const confirmInstrumentAttachmentSchema = z.object({
  storageKey: z.string().min(1).max(1024),
  fileName: z.string().min(1).max(300),
  mimeType: z.string().min(1).max(150).default('application/pdf'),
  sizeBytes: z.number().int().min(0).optional(),
  note: z.string().max(2000).optional(),
});

export type InstrumentUploadUrlRequestDto = z.infer<typeof instrumentUploadUrlRequestSchema>;
export type ConfirmInstrumentAttachmentDto = z.infer<typeof confirmInstrumentAttachmentSchema>;

/** Respuesta del paso 1: instrucciones para subir el archivo directo a S3. */
export type InstrumentUploadUrlResponse = {
  /** Clave de almacenamiento (S3 key) que luego se confirma en el paso 3. */
  storageKey: string;
  /** URL prefirmada a la que el cliente hace el PUT del archivo. */
  uploadUrl: string;
  /** Método HTTP para la subida (siempre PUT en el flujo presigned). */
  method: 'PUT';
  /** Headers que el cliente DEBE reenviar en el PUT (ej. Content-Type). */
  headers: Record<string, string>;
  /** Segundos de validez de la URL prefirmada. */
  expiresIn: number;
};

/** Adjunto a nivel de instrumento (API shape). */
export type InstrumentAttachmentModel = {
  id: string;
  instrumentId: string;
  kind: AttachmentKind;
  order: number;
  storageKey: string | null;
  url: string | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  note: string | null;
  meta: Record<string, unknown>;
  createdAt: string | Date;
  updatedAt: string | Date;
  /** URL prefirmada de descarga (solo presente al leer un adjunto puntual). */
  downloadUrl?: string;
  /**
   * URL prefirmada de previsualización (Content-Disposition: inline) para mostrar
   * el PDF embebido sin descargarlo. Solo presente al leer un adjunto puntual.
   */
  previewUrl?: string;
};

// ── Instrument Sections ──────────────────────────────────────────────────────

export const createInstrumentSectionSchema = z.object({
  name: z.string().min(1).max(200),
  type: sectionTypeSchema,
  order: z.number().int().min(0).default(0),
  maxPoints: z.coerce.number().min(0).optional(),
  timeLimitMin: z.number().int().min(0).optional(),
  instructions: z.string().max(2000).optional(),
  passage: passageSchema.optional(),
  attachments: z.array(sectionAttachmentInputSchema).optional(),
  config: z.record(z.unknown()).optional(),
});

export const updateInstrumentSectionSchema = createInstrumentSectionSchema.partial();

export type CreateInstrumentSectionDto = z.infer<typeof createInstrumentSectionSchema>;
export type UpdateInstrumentSectionDto = z.infer<typeof updateInstrumentSectionSchema>;

// ── Instruments ──────────────────────────────────────────────────────────────

export const createInstrumentSchema = z.object({
  taxonomyId: z.string().uuid().optional(),
  name: z.string().min(2).max(300),
  shortName: z.string().max(50).optional(),
  type: instrumentTypeSchema,
  subjectId: z.string().uuid().optional(),
  gradeId: z.string().uuid().optional(),
  year: z.number().int().min(2020).max(2100).optional(),
  applicationPeriod: instrumentApplicationPeriodSchema.optional(),
  version: z.string().max(50).optional(),
  isOfficial: z.boolean().default(false),
  status: instrumentStatusSchema.default('draft'),
  gradingScaleId: z.string().uuid().optional(),
  config: z.record(z.unknown()).optional(),
  sections: z.array(createInstrumentSectionSchema).optional(),
});

export const updateInstrumentSchema = createInstrumentSchema
  .omit({ sections: true })
  .partial();

export const listInstrumentsQuerySchema = z.object({
  type: instrumentTypeSchema.optional(),
  subjectId: z.string().uuid().optional(),
  gradeId: z.string().uuid().optional(),
  year: z.coerce.number().int().optional(),
  applicationPeriod: instrumentApplicationPeriodSchema.optional(),
  status: instrumentStatusSchema.optional(),
  isOfficial: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateInstrumentDto = z.infer<typeof createInstrumentSchema>;
export type UpdateInstrumentDto = z.infer<typeof updateInstrumentSchema>;
export type ListInstrumentsQueryDto = z.infer<typeof listInstrumentsQuerySchema>;

// ── Response Models (API shape) ──────────────────────────────────────────────

export type SectionAttachmentModel = {
  id: string;
  sectionId: string;
  kind: AttachmentKind;
  order: number;
  storageKey: string | null;
  url: string | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  note: string | null;
  meta: Record<string, unknown>;
  createdAt: string | Date;
  updatedAt: string | Date;
};

/**
 * Figura (ilustración) de una sección/pasaje, con URLs prefirmadas.
 *
 * Espejo de `ItemFigureModel`: la BDD guarda la storage key y las URLs se firman en cada
 * request (una presigned persistida caducaría). Se sirve por la ruta estable
 * `/instrumentos/secciones/{id}/imagen`.
 */
export type SectionFigureModel = {
  id: string;
  sectionId: string;
  storageKey: string | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  /** URL prefirmada de descarga (fuerza descarga). */
  downloadUrl?: string;
  /** URL prefirmada de previsualización (Content-Disposition: inline). */
  previewUrl?: string;
};

export type InstrumentSectionModel = {
  id: string;
  instrumentId: string;
  name: string;
  type: SectionType;
  order: number;
  maxPoints: string | null;
  timeLimitMin: number | null;
  instructions: string | null;
  passageTitle: string | null;
  passageText: string | null;
  passageFormat: PassageFormat | null;
  config: Record<string, unknown>;
  attachments?: SectionAttachmentModel[];
};

export type InstrumentModel = {
  id: string;
  orgId: string | null;
  taxonomyId: string | null;
  name: string;
  shortName: string | null;
  type: InstrumentType;
  subjectId: string | null;
  gradeId: string | null;
  year: number | null;
  applicationPeriod: InstrumentApplicationPeriod | null;
  version: string | null;
  isOfficial: boolean;
  status: InstrumentStatus;
  gradingScaleId: string | null;
  config: Record<string, unknown>;
  createdById: string | null;
  deletedAt: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  sections?: InstrumentSectionModel[];
  /**
   * PDF del enunciado / cuadernillo del instrumento (TKT-15), si existe.
   * `null` cuando el instrumento aún no tiene un PDF de enunciado asociado.
   * Presente en la respuesta de detalle (`GET /instruments/:id`).
   */
  enunciadoPdf?: InstrumentAttachmentModel | null;
};

/**
 * Facetas para poblar los filtros del banco de instrumentos sin ofrecer opciones
 * vacías: sólo trae los años que tienen al menos un instrumento visible.
 */
export type InstrumentFacetsModel = {
  years: number[];
};

export type GradingScaleModel = {
  id: string;
  orgId: string | null;
  name: string;
  type: GradingScaleType;
  minGrade: string;
  maxGrade: string;
  passingGrade: string;
  passingThreshold: string;
  config: Record<string, unknown>;
  createdAt: string | Date;
};
