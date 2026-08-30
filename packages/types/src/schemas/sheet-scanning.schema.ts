import { z } from 'zod';
import type { AssessmentStatus } from '../enums';
import {
  captureProfileSchema,
  layoutSpecSchema,
  type CaptureProfile,
  type LayoutSpec,
} from './omr-layout.schema';
import type { MarkState, PageRejectReason } from './omr-scan.schema';

// ── Lector de marcas (E22) — contrato API ⇄ web del módulo sheet-scanning ────
// Response Models EXACTOS (lección S2: frontend y backend compilan contra el
// mismo Model o la integración revienta). Superficie REST completa en
// docs/e22-lector-contracts.md.

export const SHEET_SCAN_BATCH_STATUSES = [
  'pending',
  'processing',
  'needs_review',
  'confirmed',
  'failed',
  'rejected',
] as const;
export type SheetScanBatchStatus = (typeof SHEET_SCAN_BATCH_STATUSES)[number];

export const SHEET_SCAN_STATES = [
  'read',
  'quality_rejected',
  'identity_unresolved',
  'superseded',
] as const;
export type SheetScanState = (typeof SHEET_SCAN_STATES)[number];

// ── DTOs de entrada ──────────────────────────────────────────────────────────

export const deriveLayoutSchema = z.object({
  instrumentId: z.string().uuid(),
});

export const freezeLayoutSchema = z.object({
  spec: layoutSpecSchema,
});

export const createPrintRunSchema = z.object({
  layoutId: z.string().uuid(),
  classGroupId: z.string().uuid(),
  assessmentId: z.string().uuid().nullable().optional(),
  spareCount: z.number().int().min(0).max(20).default(2),
});

/**
 * Asociar (o cambiar) la evaluación de una tirada ya creada.
 * `PATCH /api/sheet-print-runs/:id`. Sólo se expone `assessmentId`: el curso, el
 * layout y las reservas quedan congelados con las hojas ya impresas y no pueden
 * cambiar sin reimprimir.
 */
export const updatePrintRunSchema = z.object({
  assessmentId: z.string().uuid(),
});

/** `GET /api/sheet-print-runs/assessment-options?instrumentId=…` */
export const printRunAssessmentOptionsQuerySchema = z.object({
  instrumentId: z.string().uuid(),
});

export const scanBatchSourceSchema = z.object({
  fileName: z.string().min(1).max(300),
  mimeType: z.string().min(1).max(150),
  sizeBytes: z.number().int().min(1),
});

export const createScanBatchSchema = z.object({
  printRunId: z.string().uuid(),
  captureProfile: captureProfileSchema,
  sources: z.array(scanBatchSourceSchema).min(1).max(60),
});

/** `reviewedValue: null` = el humano decidió "en blanco". La lectura de máquina nunca se sobrescribe (§8.3). */
export const reviewMarkSchema = z.object({
  reviewedValue: z.string().max(20).nullable(),
});

export const assignScanIdentitySchema = z.object({
  studentId: z.string().uuid(),
});

export const discardScanSchema = z.object({
  reason: z.string().min(1).max(500),
});

export const sheetLayoutQuerySchema = z.object({
  instrumentId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const printRunQuerySchema = z.object({
  layoutId: z.string().uuid().optional(),
  instrumentId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const scanBatchQuerySchema = z.object({
  printRunId: z.string().uuid().optional(),
  status: z.enum(SHEET_SCAN_BATCH_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type DeriveLayoutDto = z.infer<typeof deriveLayoutSchema>;
export type FreezeLayoutDto = z.infer<typeof freezeLayoutSchema>;
export type CreatePrintRunDto = z.infer<typeof createPrintRunSchema>;
export type UpdatePrintRunDto = z.infer<typeof updatePrintRunSchema>;
export type PrintRunAssessmentOptionsQueryDto = z.infer<
  typeof printRunAssessmentOptionsQuerySchema
>;
export type CreateScanBatchDto = z.infer<typeof createScanBatchSchema>;
export type ReviewMarkDto = z.infer<typeof reviewMarkSchema>;
export type AssignScanIdentityDto = z.infer<typeof assignScanIdentitySchema>;
export type DiscardScanDto = z.infer<typeof discardScanSchema>;
export type SheetLayoutQueryDto = z.infer<typeof sheetLayoutQuerySchema>;
export type PrintRunQueryDto = z.infer<typeof printRunQuerySchema>;
export type ScanBatchQueryDto = z.infer<typeof scanBatchQuerySchema>;

// ── Models de respuesta ──────────────────────────────────────────────────────

export type LayoutExcludedItemModel = {
  itemId: string;
  printedNumber: string;
  reason: string;
};

/** La derivación es una PROPUESTA, no un hecho: declara qué ítems quedaron fuera y por qué (C11). */
export type LayoutDraftModel = {
  spec: LayoutSpec;
  excludedItems: LayoutExcludedItemModel[];
};

export type FreezeLayoutResponse = {
  layoutId: string;
  version: number;
  specHash: string;
};

export type SheetLayoutSummaryModel = {
  id: string;
  instrumentId: string;
  version: number;
  specHash: string;
  pageCount: number;
  fieldCount: number;
  createdById: string | null;
  createdAt: string | Date;
};

export type SheetLayoutModel = SheetLayoutSummaryModel & {
  spec: LayoutSpec;
};

/** Evaluación candidata a asociarse a una tirada (misma org, mismo instrumento). */
export type PrintRunAssessmentOption = {
  id: string;
  name: string | null;
  status: AssessmentStatus;
  administeredAt: string | Date | null;
  createdAt: string | Date;
};

export type PrintRunModel = {
  id: string;
  layoutId: string;
  layoutVersion: number;
  instrumentId: string;
  classGroupId: string | null;
  classGroupName: string | null;
  assessmentId: string | null;
  spareCount: number;
  sheetCount: number;
  pdfFileId: string | null;
  createdById: string | null;
  createdAt: string | Date;
};

export type ScanUploadIntent = {
  sourceIndex: number;
  fileId: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresIn: number;
};

export type CreateScanBatchResponse = {
  batchId: string;
  uploads: ScanUploadIntent[];
};

export type BatchCountersModel = {
  marks: Record<MarkState, number>;
  scans: Record<SheetScanState, number>;
  sheetsExpected: number;
  sheetsScanned: number;
};

export type BatchStatusModel = {
  id: string;
  printRunId: string;
  status: SheetScanBatchStatus;
  captureProfile: CaptureProfile;
  pagesTotal: number | null;
  pagesRead: number;
  reviewPending: number;
  failureReason: string | null;
  counters: BatchCountersModel;
  createdAt: string | Date;
  updatedAt: string | Date;
};

export type ReviewScanModel = {
  scanId: string;
  state: SheetScanState;
  rejectReason: PageRejectReason | null;
  sheetSequence: number | null;
  pageIndex: number;
  studentId: string | null;
  studentName: string | null;
  identityConfidence: number | null;
  thumbUrl: string | null;
};

export type ReviewMarkModel = {
  markId: string;
  scanId: string;
  studentName: string | null;
  printedNumber: string;
  state: MarkState;
  value: string | null;
  fill: number;
  threshold: number;
  margin: number;
  cropUrl: string | null;
  /** Alternativas del campo según el spec, para resolver con una tecla (C16). */
  options: string[];
  reviewedValue: string | null;
  reviewedById: string | null;
};

/** Orden por daño (C16): calidad primero (el profesor aún tiene las hojas), identidades después, marcas por margin ascendente. */
export type ReviewQueueModel = {
  batchId: string;
  qualityRejected: ReviewScanModel[];
  identityUnresolved: ReviewScanModel[];
  ambiguousMarks: ReviewMarkModel[];
};

export type ConfirmBatchResponse = {
  batchId: string;
  status: SheetScanBatchStatus;
  importJobId: string | null;
  summary: {
    sheetsPersisted: number;
    responsesPersisted: number;
    assumedPending: number;
  };
};
